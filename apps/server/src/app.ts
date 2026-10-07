import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { AgentEvent, AppPreferencesSnapshot, KlineRequest, LocalePreference, StrategyId } from '@finagent/core';
import { STRATEGY_IDS } from '@finagent/core';
import { resolveLocale } from '@finagent/i18n';
import {
  AgentKernel, JsonFileStore, MarketDataService, FinanceToolRegistry, ProviderRouter,
  MassiveFinancialDataProvider, createRouterFetchers, createFullRegistry,
  ResearchService, ResearchReportRepository, LocalResearchSynthesizer,
  withDemoDataFallback, buildComparison, createCodeError, runDue, createAgentEvaluator, createLocalThesisEvaluator, parseImpactJson,
} from '@finagent/shared';
import { VisitorServices } from './visitor-services.ts';
import { ModelRuntime } from './model-runtime.ts';
import { VisitorModels } from './visitor-models.ts';
import { WorkspaceDatabase, type DatabaseOptions } from './database.ts';
import { lockDataDirectory } from './data-lock.ts';
import { Accounts } from './accounts.ts';
import { registerJsonStoreBackend } from '@finagent/shared';
import { isIP } from 'node:net';
import { WorkQueue } from './queue.ts';
import { buildDiff } from '../../../packages/shared/src/research-diff/diff-service.ts';
import { reportToMarkdown, reportToShareCard, redactForShare } from '../../../packages/shared/src/export/index.ts';

export interface ServerOptions {
  dataDir: string;
  database?: DatabaseOptions;
  staticDir?: string;
  secret?: string;
  publicOrigin?: string;
  production?: boolean;
  demoData?: boolean;
  modelAllowedHosts?: string[];
  skillsDir?: string;
  inviteCode?: string;
  proxySecret?: string;
  schedulerIntervalMs?: number;
  maxVisitors?: number;
  concurrency?: number;
  dailyRunLimit?: number;
  visitorDailyRunLimit?: number;
}
interface Visitor {
  id: string;
  kernel: AgentKernel;
  models: VisitorModels;
  services: VisitorServices;
  market: MarketDataService;
  registry: ReturnType<typeof createFullRegistry>;
  tools: FinanceToolRegistry;
  financial: MassiveFinancialDataProvider;
  research: ResearchService;
  store: JsonFileStore;
  preferences: AppPreferencesSnapshot;
  lastUsed: number;
  streams: Set<ReadableStreamDefaultController<Uint8Array>>;
  events: Array<{ id: number; channel: string; data: unknown }>;
  sequence: number;
  eventBytes: number;
  cleanups: Set<() => void>;
  subscriptions: Array<() => void>;
}
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/);
const textSchema = z.string().trim().min(1).max(12000);
const localeSchema = z.enum(['system', 'zh-CN', 'en-US']);
const encoder = new TextEncoder();
const terminal = new Set(['completed', 'partial', 'failed', 'cancelled', 'interrupted']);
const sleep = () => new Promise<void>((done) => setTimeout(done, 25));

export async function createWebApplication(options: ServerOptions) {
  const dataDir = resolve(options.dataDir);
  await mkdir(dataDir, { recursive: true });
  let secret = options.secret;
  if (!secret) {
    const keyFile = join(dataDir, '.cookie-signing-key');
    try { secret = await readFile(keyFile, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const generated = randomBytes(32).toString('hex');
      try { await writeFile(keyFile, generated, { flag: 'wx', mode: 0o600 }); secret = generated; }
      catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
        secret = await readFile(keyFile, 'utf8');
      }
    }
  }
  if (secret.length < 32) throw new Error('FELIX_COOKIE_SECRET must contain at least 32 characters.');
  if (options.production && !options.publicOrigin?.startsWith('https://')) {
    throw new Error('Production requires an HTTPS FELIX_PUBLIC_ORIGIN.');
  }
  const unlock = await lockDataDirectory(dataDir);
  let database: WorkspaceDatabase;
  try { database = await WorkspaceDatabase.open(dataDir, options.database); } catch (error) { await unlock(); throw error; }
  let unregisterStorage: () => void;
  try { await database.migrateFiles(); unregisterStorage = registerJsonStoreBackend(dataDir, database); }
  catch (error) { await database.close(); await unlock(); throw error; }
  const accounts = new Accounts(database, options.inviteCode);
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : undefined;
  const demo = options.demoData ?? true;
  const queue = new WorkQueue(options.concurrency ?? 2);
  const visitors = new Map<string, Visitor>();
  const initializing = new Map<string, Promise<Visitor>>();
  const rates = new Map<string, { count: number; resetAt: number }>();
  const workspaceRates = new Map<string, { count: number; resetAt: number }>();
  let closed = false;
  let allocations: Promise<unknown> = Promise.resolve();
  const quotaStore = new JsonFileStore(dataDir);
  let quotas = await quotaStore.read('daily-runs.json', { day: '', total: 0, visitors: {} as Record<string, number> });
  let quotaWrites: Promise<unknown> = Promise.resolve();
  function reserveRun(visitorId: string) {
    const work = quotaWrites.then(async () => {
      const day = new Date().toISOString().slice(0, 10);
      if (quotas.day !== day) quotas = { day, total: 0, visitors: {} };
      if (quotas.total >= (options.dailyRunLimit ?? 1000) || (quotas.visitors[visitorId] ?? 0) >= (options.visitorDailyRunLimit ?? 20)) {
        throw createCodeError('DAILY_RUN_LIMIT', '今日研究次数已用完，请明天再试。');
      }
      quotas.total++;
      quotas.visitors[visitorId] = (quotas.visitors[visitorId] ?? 0) + 1;
      await quotaStore.write('daily-runs.json', quotas);
    });
    quotaWrites = work.catch(() => undefined);
    return work;
  }

  const signature = (id: string) => createHmac('sha256', secret!).update(id).digest('hex');
  const notice = demo ? '示例行情（Sample data） · 在设置中填写自己的模型密钥后可启用 AI（Bring your own key in Settings）。' : '行情权限取决于供应商；AI 使用自己的模型密钥（Bring your own key）。';
  const deployment = { kind: 'web' as const, demoData: demo, notice };

  const cookieValue = (request: Request, name: string) => request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1);
  const visitorCookie = (id: string) => `felix_visitor=${id}.${signature(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${options.production ? '; Secure' : ''}`;
  const accountCookie = (token: string, clear = false) => `felix_account=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 2592000}${options.production ? '; Secure' : ''}`;
  async function identity(request: Request) {
    const sessionToken = cookieValue(request, 'felix_account');
    const user = await accounts.resolve(sessionToken);
    if (user) return { id: user.workspaceId, setCookie: undefined, user, sessionToken };
    const cookie = cookieValue(request, 'felix_visitor');
    if (cookie) {
      const [id, mac] = cookie.split('.');
      if (/^[a-f0-9]{32}$/.test(id ?? '') && /^[a-f0-9]{64}$/.test(mac ?? '') &&
        timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(id), 'hex')) && !await accounts.workspaceClaimed(id)) return { id, setCookie: undefined, user: undefined, sessionToken };
    }
    const id = randomBytes(16).toString('hex');
    return { id, setCookie: visitorCookie(id), user: undefined, sessionToken };
  }

  function clientAddress(request: Request, remoteAddress: string) {
    const supplied = request.headers.get('x-felix-proxy-token');
    const address = request.headers.get('x-felix-client-ip');
    if (options.proxySecret && supplied && address && isIP(address) &&
        timingSafeEqual(createHmac('sha256', options.proxySecret).update(supplied).digest(), createHmac('sha256', options.proxySecret).update(options.proxySecret).digest())) return address;
    return remoteAddress;
  }

  function publish(visitor: Visitor, channel: string, data: unknown) {
    const event = { id: ++visitor.sequence, channel, data };
    visitor.events.push(event);
    const bytes = encoder.encode(`id: ${event.id}\nevent: ${channel}\ndata: ${JSON.stringify(data)}\n\n`);
    visitor.eventBytes += bytes.length;
    while (visitor.events.length > 1000 || visitor.eventBytes > 2_000_000) {
      const removed = visitor.events.shift()!;
      visitor.eventBytes -= encoder.encode(`id: ${removed.id}\nevent: ${removed.channel}\ndata: ${JSON.stringify(removed.data)}\n\n`).length;
    }
    for (const stream of visitor.streams) {
      try { stream.enqueue(bytes); } catch { visitor.streams.delete(stream); }
    }
  }

  function closeStreams(id: string) {
    const visitor = visitors.get(id);
    if (!visitor) return;
    for (const stream of visitor.streams) { try { stream.close(); } catch {} }
    for (const cleanup of visitor.cleanups) cleanup();
    visitor.streams.clear();
  }

  async function evict(visitor: Visitor) {
    visitor.subscriptions.forEach((unsubscribe) => unsubscribe());
    for (const stream of visitor.streams) { try { stream.close(); } catch {} }
    for (const cleanup of visitor.cleanups) cleanup();
    visitor.streams.clear();
    await visitor.services.close();
    await visitor.kernel.dispose();
    visitors.delete(visitor.id);
  }

  async function getVisitor(id: string): Promise<Visitor> {
    const existing = visitors.get(id);
    if (existing) { existing.lastUsed = Date.now(); return existing; }
    const pending = initializing.get(id);
    if (pending) return pending;
    const work = allocations.then(async () => {
      if (closed) throw createCodeError('SERVER_STOPPING', 'Server is stopping.');
      if (visitors.size >= (options.maxVisitors ?? 32)) {
        const busy = queue.busyVisitors;
        const idle = [...visitors.values()].filter((visitor) => !busy.has(visitor.id)).sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (!idle) throw createCodeError('SERVER_BUSY', 'The server is busy. Try again shortly.');
        await evict(idle);
      }
      const root = join(dataDir, 'visitors', id);
      const store = new JsonFileStore(root);
      const preferences = await store.read<AppPreferencesSnapshot>('preferences.json', {
        preference: 'zh-CN' as const, effectiveLocale: 'zh-CN' as const, systemLocale: 'zh-CN',
      });
      let kernel: AgentKernel;
      let runtime: VisitorModels;
      const router = new ProviderRouter({ timeoutMs: 15000 });
      const financial = new MassiveFinancialDataProvider({ getApiKey: async () => runtime.marketKey() });
      router.register(financial); router.setRouting({ primary: 'massive' });
      const unavailable = async (): Promise<never> => { throw createCodeError('CAPABILITY_UNAVAILABLE', '请连接可用的数据源（Connect an available data provider）。'); };
      const publicFetchers = { ...createRouterFetchers(router), getPortfolio: unavailable, getAccountPositions: unavailable, getAssets: unavailable, getCashFlow: unavailable };
      const fetchers = demo ? withDemoDataFallback(publicFetchers) : publicFetchers;
      const registry = createFullRegistry(fetchers);
      const market = new MarketDataService({ fetchers: { ...fetchers, getLongBridgeStatus: async () => ({ installed: false, authed: false, available: false, status: 'not_installed' }) } });
      const tools = new FinanceToolRegistry(registry);
      runtime = new VisitorModels(store, secret!, id, tools, market, (sessionId) => kernel.sessions.listMessages(sessionId), options.modelAllowedHosts, demo);
      await runtime.load();
      kernel = new AgentKernel({
        storageDir: join(root, 'store'), piSessionDir: join(root, 'pi-sessions'),
        provider: 'local', runtime, marketData: market, registry: tools, demoData: demo,
        budgets: { ceiling: { wallClockMs: 150000, toolCalls: 12 } },
      });
      let services: VisitorServices;
      const research = new ResearchService({
        onReport: (report) => services.onReport(report),
        registry, synthesizer: runtime,
        repository: new ResearchReportRepository(new JsonFileStore(join(root, 'store'))),
        getIdentity: async () => ({ provider: runtime.state().runtimeProvider, model: runtime.state().model?.id ?? 'local', config: demo ? 'demo' : 'live' }),
        budgets: { ceiling: { wallClockMs: 150000, toolCalls: 24 } },
      });
      services = new VisitorServices(store, root, registry, market, (symbol) => research.listReports(symbol), async (symbol, strategy) => { await reserveRun(id); const run = await research.start(symbol, strategy as StrategyId | undefined, preferences.effectiveLocale); while (!terminal.has((await research.getRun(run.id))?.status ?? 'failed')) await sleep(); return run; }, (channel, event) => publish(visitors.get(id)!, channel, event), options.skillsDir, createAgentEvaluator(async (input, signal) => { const config = runtime.config(); if (!config) return createLocalThesisEvaluator().evaluate(input, signal);
        const result = parseImpactJson(await new ModelRuntime(config, tools, (sessionId) => kernel.sessions.listMessages(sessionId)).completeText('Return only JSON {kind: unchanged/strengthened/weakened/invalidated, summary: string, updatedThesis: complete thesis with existing id/symbol/evidenceRefs/timestamps and editable bullCase/bearCase/catalysts/risks}. Base the verdict on supplied facts. Preserve identity fields.', input, signal));
        // Model output cannot choose storage paths or change the original asset identity.
        return { ...result, updatedThesis: { ...result.updatedThesis, id: input.thesis.id, symbol: input.thesis.symbol, createdAt: input.thesis.createdAt, evidenceRefs: input.thesis.evidenceRefs } }; }));
      await services.initialize();
      runtime.skillPrompt = (content) => services.skills.findSkillsByKeyword(content).filter((skill) => skill.metadata.enabled).map((skill) => skill.prompt?.system ?? '').join('\n').slice(0, 16000);
      const visitor: Visitor = { id, kernel, models: runtime, services, market, registry, tools, financial, research, store, preferences, lastUsed: Date.now(), streams: new Set(), events: [], sequence: 0, eventBytes: 0, cleanups: new Set(), subscriptions: [] };
      visitor.subscriptions.push(kernel.runs.subscribe((event: AgentEvent) => publish(visitor, 'agent', event)),
        kernel.runs.subscribeStream((sessionId, event) => publish(visitor, 'stream', { sessionId, event })));
      visitors.set(id, visitor);
      return visitor;
    });
    allocations = work.catch(() => undefined);
    initializing.set(id, work);
    try { return await work; } finally { initializing.delete(id); }
  }

  async function session(visitor: Visitor, value: unknown) {
    const id = idSchema.parse(value);
    if (!await visitor.kernel.sessions.getSession(id)) throw createCodeError('SESSION_NOT_FOUND', 'Session not found.');
    return id;
  }

  async function dispatch(visitor: Visitor, method: string, args: unknown[], signal: AbortSignal) {
    const { kernel, market, registry, tools } = visitor;
    if (method.startsWith('llm.')) return visitor.models.dispatch(method.slice(4), args, queue.busyVisitors.has(visitor.id));
    switch (method) {
      case 'bootstrap': return { deployment, workspaceId: visitor.id, modelState: visitor.models.state() };
      case 'kernel.hydrate': return { sessions: await kernel.sessions.listSessions() };
      case 'kernel.createSession': {
        if ((await kernel.sessions.listSessions()).length >= 100) throw createCodeError('SESSION_LIMIT', 'This visitor has reached the session limit.');
        return kernel.sessions.createSession(z.string().trim().max(120).parse(args[0] ?? '新会话'));
      }
      case 'kernel.deleteSession': return kernel.deleteSession(await session(visitor, args[0]));
      case 'kernel.getMessages': return kernel.sessions.listMessages(await session(visitor, args[0]));
      case 'kernel.listRuns': return kernel.sessions.listRuns(await session(visitor, args[0]));
      case 'kernel.startRun': {
        const sessionId = await session(visitor, args[0]);
        if ((await kernel.sessions.listRuns(sessionId)).length >= 100) throw createCodeError('SESSION_LIMIT', 'This conversation has reached the run limit. Create a new conversation.');
        const content = textSchema.parse(args[1]);
        const context = args[2] === undefined ? undefined : z.object({ activeSymbol: symbolSchema.optional(), activeView: z.enum(['overview', 'chart', 'financials', 'news']).optional() }).parse(args[2]);
        return queue.submit(visitor.id,
          async () => { await session(visitor, sessionId); await reserveRun(visitor.id); return kernel.runs.startRun(sessionId, content, context, visitor.preferences.effectiveLocale); },
          async () => { while (kernel.runs.isRunning()) await sleep(); }, signal);
      }
      case 'kernel.cancelRun': return kernel.runs.cancelRun(await session(visitor, args[0]), idSchema.parse(args[1]));
      case 'kernel.streamReplay': {
        const input = z.object({ runId: idSchema, lastSequence: z.number().int().nonnegative() }).parse(args[0]);
        const runs = (await Promise.all((await kernel.sessions.listSessions()).map((item) => kernel.sessions.listRuns(item.id)))).flat();
        if (!runs.some((run) => run.id === input.runId)) throw createCodeError('RUN_NOT_FOUND', 'Run not found.');
        return kernel.runs.replayStream(input.runId, input.lastSequence);
      }
      case 'market.getQuote': return market.getQuote(symbolSchema.parse(args[0]));
      case 'market.getKline': {
        const input = z.object({ symbol: symbolSchema, period: z.string().regex(/^[a-zA-Z0-9]{1,12}$/).optional(), limit: z.number().int().min(1).max(500).optional() }).parse(args[0]);
        return market.getKline(input as KlineRequest);
      }
      case 'market.getStaticInfo': return market.getStaticInfo(symbolSchema.parse(args[0]));
      case 'market.getCalcIndex': return market.getCalcIndex(symbolSchema.parse(args[0]));
      case 'market.getIntraday': return market.getIntraday(symbolSchema.parse(args[0]));
      case 'market.getDepth': return market.getDepth(symbolSchema.parse(args[0]));
      case 'market.getTrades': return market.getTrades(symbolSchema.parse(args[0]), z.number().int().min(1).max(200).parse(args[1] ?? 20));
      case 'market.getCapitalFlow': return market.getCapitalFlow(symbolSchema.parse(args[0]));
      case 'market.getMarketTemperature': return market.getMarketTemperature(z.enum(['US', 'HK', 'SG', 'SH', 'SZ']).parse(args[0] ?? 'US'));
      case 'market.getFinancialReport': return market.getFinancialReport(symbolSchema.parse(args[0]), z.enum(['IS', 'BS', 'CF', 'ALL']).parse(args[1] ?? 'ALL'), args[2] === undefined ? undefined : z.string().max(40).parse(args[2]));
      case 'market.getInstitutionRating': return market.getInstitutionRating(symbolSchema.parse(args[0]));
      case 'market.getDividends': return market.getDividends(symbolSchema.parse(args[0]));
      case 'market.getEpsForecasts': return market.getEpsForecasts(symbolSchema.parse(args[0]));
      case 'market.getNews': return market.getNews(symbolSchema.parse(args[0]));
      case 'market.getMarketStatus': return market.getMarketStatus();
      case 'market.getPortfolio': return market.getPortfolio();
      case 'agent.getTools': return tools.getTools();
      case 'research.start': {
        const input = z.object({ symbol: symbolSchema, strategyId: z.string().refine((value) => STRATEGY_IDS.includes(value as StrategyId)).optional() }).parse(args[0]);
        return queue.submit(visitor.id,
          async () => { await reserveRun(visitor.id); return visitor.research.start(input.symbol, input.strategyId as StrategyId | undefined, visitor.preferences.effectiveLocale); },
          async (run) => { while (!terminal.has((await visitor.research.getRun(run.id))?.status ?? 'failed')) await sleep(); }, signal);
      }
      case 'research.listRuns': return visitor.research.listRuns();
      case 'research.getRun': return visitor.research.getRun(idSchema.parse(z.object({ runId: idSchema }).parse(args[0]).runId));
      case 'research.listReports': return visitor.research.listReports(z.object({ symbol: symbolSchema.optional() }).parse(args[0] ?? {}).symbol);
      case 'research.getReport': return visitor.research.getReport(z.object({ reportId: idSchema }).parse(args[0]).reportId);
      case 'research.cancel': return visitor.research.cancel(z.object({ runId: idSchema }).parse(args[0]).runId);
      case 'research.getDiff': {
        const reports = await visitor.research.listReports(z.object({ symbol: symbolSchema }).parse(args[0]).symbol);
        return reports.length >= 2 ? buildDiff(reports[1], reports[0]) : undefined;
      }
      case 'research.resume':
      case 'research.restart': {
        const runId = z.object({ runId: idSchema }).parse(args[0]).runId;
        return queue.submit(visitor.id, async () => {
          await reserveRun(visitor.id);
          return method === 'research.resume' ? visitor.research.resume(runId) : visitor.research.restart(runId);
        }, async (run) => { while (!terminal.has((await visitor.research.getRun(run.id))?.status ?? 'failed')) await sleep(); }, signal);
      }
      case 'research.discard': return visitor.research.discard(z.object({ runId: idSchema }).parse(args[0]).runId);
      case 'export.markdown':
      case 'export.shareCard': {
        const report = await visitor.research.getReport(z.object({ reportId: idSchema }).parse(args[0]).reportId);
        if (!report) throw createCodeError('RUN_NOT_FOUND', 'Report not found.');
        const safe = redactForShare(report);
        return method === 'export.markdown' ? reportToMarkdown(safe) : reportToShareCard(safe);
      }
      case 'compare.build': return buildComparison(z.array(symbolSchema).min(2).max(4).parse(args[0]), registry);
      case 'capabilities.list': return registry.list().map(({ id, name, description, category, riskLevel, auth, toolName }) => ({ id, name, description, category, riskLevel, auth, toolName }));
      case 'prefs.get': return visitor.preferences;
      case 'prefs.update': {
        const preference: LocalePreference = localeSchema.parse(args[0]);
        visitor.preferences = { preference, systemLocale: 'zh-CN', effectiveLocale: resolveLocale(preference, 'zh-CN') };
        await visitor.store.write('preferences.json', visitor.preferences);
        return visitor.preferences;
      }
      case 'workspace.get': return visitor.store.read('workspace.json', { watchlist: ['AAPL.US', 'TSLA.US', 'NVDA.US'] });
      case 'workspace.update': {
        const value = z.object({ watchlist: z.array(symbolSchema).max(40) }).parse(args[0]);
        const result = { watchlist: [...new Set(value.watchlist)] }; await visitor.store.write('workspace.json', result); return result;
      }
      case 'workspace.exportData': {
        const documents = (await database.documents(`visitors/${visitor.id}/`)).filter((row) => !row.key.endsWith('/model-vault.json') && !/credential|vault/i.test(row.key)).map((row) => ({ ...row, key: row.key.split('/').slice(2).join('/') }));
        return { version: 1, exportedAt: new Date().toISOString(), documents };
      }
      case 'onboarding.getCompleted': return true;
      case 'longbridge.getStatus': return market.getLongBridgeStatus();
      case 'onboarding.setCompleted': return;
      case 'about.get': return { version: '0.4.0-beta.2-web', channel: 'web', build: 'source' };
      case 'connections.list': return connectionEntries(visitor);
      case 'connections.coverage': return [{ providerId: 'massive', capabilities: visitor.financial.capabilities(), markets: ['US'] }];
      case 'connections.setConfig': {
        if (args[0] !== 'massive') throw createCodeError('DESKTOP_CONNECTION_REQUIRED', '长桥本地登录请使用桌面版（Use the desktop app for local Longbridge login）。');
        const config = z.object({ apiKey: z.string().trim().min(1).max(4096).optional(), enabled: z.boolean().optional(), endpoint: z.string().max(500).optional(), region: z.string().max(40).optional(), routingRole: z.enum(['primary', 'fallback']).optional() }).parse(args[1]);
        if (config.endpoint && !['https://api.massive.com', 'https://api.polygon.io'].includes(config.endpoint.replace(/\/$/, ''))) throw createCodeError('INVALID_ARGUMENT', 'Unsupported market endpoint');
        if (config.apiKey) await visitor.models.setMarketKey(config.apiKey);
        if (config.enabled === false) await visitor.models.setMarketKey();
        market.clear();
        const entries = await connectionEntries(visitor); publish(visitor, 'connections', entries); return entries.find((entry) => entry.providerId === 'massive');
      }
      case 'connections.disconnect': {
        if (args[0] === 'massive') { await visitor.models.setMarketKey(); market.clear(); }
        const entries = await connectionEntries(visitor); publish(visitor, 'connections', entries); return entries.find((entry) => entry.providerId === args[0]) ?? null;
      }
      case 'connections.cancelConnect': return;
      case 'connections.connect': {
        if (args[0] !== 'massive') throw createCodeError('DESKTOP_CONNECTION_REQUIRED', '长桥本地登录请使用桌面版（Use the desktop app for local Longbridge login）。');
        if (!visitor.models.marketKey()) throw createCodeError('MODEL_KEY_REQUIRED', '请先填写自己的行情密钥（Save your market API key first）。');
        return { status: 'connected' };
      }
      case 'connections.test': {
        if (args[0] !== 'massive') return { status: 'not-installed', lastCheck: Date.now(), message: '本地长桥集成需要桌面版（Desktop required）。' };
        const result = await visitor.financial.execute('market.quote', { symbol: 'AAPL.US' }, AbortSignal.timeout(15000));
        return { status: result.ok ? 'permission-limited' : 'error', lastCheck: Date.now(), diagnostic: result.ok ? 'healthy' : 'degraded', message: result.ok ? '连接可用；数据延迟及权限取决于订阅（Connected; subscription limits apply）。' : '连接失败，请检查密钥和行情权限（Check the key and data entitlement）。' };
      }
      case 'health.check': return {
        ai: { ok: true, ...(visitor.models.state().model ? {} : { mode: 'local' }), detail: visitor.models.state().model ? '已选择模型，请通过测试连接验证密钥（Model selected; use Test Connection to verify）。' : '本地规则分析（Local rule-based analysis）', error: null },
        marketData: { ok: demo || !!visitor.models.marketKey(), ...(demo ? { mode: 'demo' } : {}), detail: demo ? '示例行情（Sample data）' : '行情权限取决于供应商（Provider entitlement applies）', error: demo || visitor.models.marketKey() ? null : { code: 'MARKET_KEY_REQUIRED', message: '请配置行情密钥（Configure a market API key）。' } },
        skills: { ok: visitor.services.skills.listSkills().length > 0, detail: '已加载内置技能（Bundled skills loaded）', error: null },
        agentRuntime: { ok: true, detail: '网页研究运行时（Web research runtime）', error: null },
      };
      case 'diagnostics.collect': return diagnostics(visitor);
      case 'diagnostics.export': return JSON.stringify(await diagnostics(visitor), null, 2);
      case 'diagnostics.restartRuntime': {
        if (queue.busyVisitors.has(visitor.id)) throw createCodeError('RUN_ACTIVE', '请等待当前研究结束（Wait for the active run）。');
        return;
      }
      case 'market.getCalendarEvents': return market.getCalendarEvents(z.object({ eventType: z.enum(['financial', 'report', 'dividend', 'ipo', 'macrodata', 'closed']).default('financial'), symbols: z.array(symbolSchema).max(10).optional() }).parse(args[0] ?? {}));
      default: {
        if (['screening.run', 'pulse.snapshot', 'thesis.reEvaluate', 'portfolioRisk.analyze', 'automation.runRule', 'outcome.evaluateDue'].includes(method)) return queue.submit(visitor.id, async () => {
          if (method === 'thesis.reEvaluate' && visitor.models.state().model) await reserveRun(visitor.id);
          return visitor.services.dispatch(method, args);
        }, async () => {}, signal);
        return visitor.services.dispatch(method, args);
      }
    }
  }

  async function connectionEntries(visitor: Visitor) {
    const health = await visitor.financial.status();
    return [{ providerId: 'massive', kind: 'financial-data', name: 'Massive (Polygon.io)', status: health.status, health, coverage: { providerId: 'massive', capabilities: visitor.financial.capabilities(), markets: ['US'] }, configurable: true, configured: !!visitor.models.marketKey(), hasAccount: false, accountLabel: null, error: null },
      { providerId: 'longbridge', kind: 'financial-data', name: '长桥（Longbridge）', status: 'not-installed', health: null, coverage: null, configurable: false, configured: false, hasAccount: false, accountLabel: null, error: { code: 'DESKTOP_CONNECTION_REQUIRED', message: '本地 CLI 登录请使用桌面版（Local CLI login requires desktop）。' } }];
  }
  async function diagnostics(visitor: Visitor) {
    const model = visitor.models.state().model;
    return { collectedAt: new Date().toISOString(), app: { version: '0.4.0-beta.2-web', platform: { os: 'web', arch: 'browser', electron: null } }, runtime: { agent: { providerId: model ? 'web-api' : 'local', state: visitor.kernel.runs.isRunning() ? 'running' : 'idle' } }, providers: { llm: { id: model?.provider ?? null, model: model?.id ?? null }, financial: [{ id: 'massive', status: visitor.models.marketKey() ? 'configured' : 'not-connected', coverage: { capabilities: visitor.financial.capabilities(), markets: ['US'] } }], broker: { connected: false, accountCount: 0 }, longbridgeCliVersion: null }, skills: { loaded: visitor.services.skills.listSkills().length }, capabilities: { available: demo ? visitor.registry.list().map((entry) => entry.id) : visitor.models.marketKey() ? visitor.financial.capabilities() : [] }, resources: { dev: false, root: 'visitor-workspace' }, pi: { status: 'idle', command: null, cwd: null, extensions: [], providersConfigured: model ? [model.provider] : [], model: model?.id ?? null, lastExitCode: null, lastExitSignal: null, stderrTail: null, observabilityDegraded: false }, errors: (await database.jobErrors(visitor.id)).map((job) => ({ at: job.updated_at, source: 'scheduler', message: `后台任务${job.status === 'interrupted' ? '因重启中断' : '执行失败'}，可在自动研究页面手动重试（Scheduled job ${job.status}; retry manually）。`, stack: null })), redaction: { policy: 'No keys, account data or server paths', applied: true } };
  }

  let ticking = false;
  const automationTimer = setInterval(() => {
    if (ticking || closed) return;
    ticking = true;
    void (async () => {
      // Enabled durable rules are loaded after restart, even with no open browser.
      for (const id of await database.scheduledWorkspaceIds()) {
        if (queue.busyVisitors.has(id)) continue;
        const visitor = await getVisitor(id);
        const recent = await visitor.services.automationRuns.list();
        for (const rule of runDue(await visitor.services.automation.list())) {
          const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
          if (recent.some((run) => run.ruleId === rule.id && run.ranAt >= midnight.getTime())) continue;
          const day = `${midnight.getFullYear()}-${midnight.getMonth() + 1}-${midnight.getDate()}`;
          if (!await database.claimJob(id, rule.id, day)) continue;
          try {
            const result = await queue.submit(visitor.id, () => visitor.services.dispatch('automation.runRule', [{ ruleId: rule.id }]), async () => {}, new AbortController().signal) as { failures?: string[] };
            await database.finishJob(id, rule.id, day, result.failures?.length ? 'failed' : 'completed');
          } catch { await database.finishJob(id, rule.id, day, 'failed'); }
        }
      }
    })().catch(() => undefined).finally(() => { ticking = false; });
  }, options.schedulerIntervalMs ?? 60000);

  function originAllowed(request: Request) {
    if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
    const origin = request.headers.get('origin');
    if (!origin) return true;
    if (origin === publicOrigin || origin === new URL(request.url).origin) return true;
    return !options.production && ['http://localhost:5174', 'http://127.0.0.1:5174'].includes(origin);
  }

  const json = (value: unknown, status = 200, cookie?: string | string[]) => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const item of Array.isArray(cookie) ? cookie : cookie ? [cookie] : []) headers.append('Set-Cookie', item);
    return Response.json(value, { status, headers });
  };

  async function fetchRequest(request: Request, remoteAddress = 'local'): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      let ok = !closed;
      if (ok) try { await database.query('SELECT 1'); } catch { ok = false; }
      return json({ ok, service: 'felix-web', database: database.kind, demoData: demo, modelConfigured: false }, ok ? 200 : 503);
    }
    if (!url.pathname.startsWith('/api/')) {
      if (!options.staticDir || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
      const root = resolve(options.staticDir);
      const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
      if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
      const asset = Bun.file(file);
      if (!await asset.exists()) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : asset, { headers: {
        'Content-Type': asset.type,
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
      } });
    }
    if (closed) return json({ ok: false, error: { code: 'SERVER_STOPPING', message: 'Server is stopping.' } }, 503);
    if (!originAllowed(request)) return json({ ok: false, error: { code: 'ORIGIN_REJECTED', message: 'Cross-site requests are not allowed.' } }, 403);
    const now = Date.now();
    if (rates.size >= 2048) for (const [key, rate] of rates) if (rate.resetAt <= now) rates.delete(key);
    remoteAddress = clientAddress(request, remoteAddress);
    const rate = rates.get(remoteAddress);
    if (!rate && rates.size >= 2048) return json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, 429);
    if (rate && rate.resetAt > now && ++rate.count > 2000) return json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } }, 429);
    if (!rate || rate.resetAt <= now) rates.set(remoteAddress, { count: 1, resetAt: now + 60000 });
    let auth: Awaited<ReturnType<typeof identity>>;
    try { auth = await identity(request); }
    catch { return json({ ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: '数据服务暂不可用，请稍后重试（Storage unavailable; retry shortly）。' } }, 503); }
    for (const [id, value] of workspaceRates) if (value.resetAt <= now) workspaceRates.delete(id);
    const personalRate = workspaceRates.get(auth.id);
    if (personalRate && ++personalRate.count > 600) return json({ ok: false, error: { code: 'RATE_LIMITED', message: '个人请求过多，请稍后重试（Too many workspace requests）。' } }, 429, auth.setCookie);
    if (!personalRate) {
      if (workspaceRates.size >= 2048) return json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, 429, auth.setCookie);
      workspaceRates.set(auth.id, { count: 1, resetAt: now + 60000 });
    }
    try {
      if (url.pathname === '/api/auth' && request.method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw createCodeError('INVALID_ARGUMENT', 'JSON required');
        const input = z.object({ action: z.enum(['state', 'register', 'login', 'logout', 'changePassword', 'resetPassword', 'deleteAccount']), input: z.unknown().optional() }).parse(JSON.parse(await request.text().then((raw) => { if (Buffer.byteLength(raw) > 65536) throw createCodeError('INVALID_ARGUMENT', 'Request body is too large.'); return raw; })));
        if (input.action === 'state') return json({ ok: true, data: accounts.state(auth.user) }, 200, auth.setCookie);
        if (input.action === 'logout') {
          await accounts.logout(auth.sessionToken);
          closeStreams(auth.id);
          const id = randomBytes(16).toString('hex');
          return json({ ok: true, data: accounts.state() }, 200, [accountCookie('', true), visitorCookie(id)]);
        }
        if (['register', 'deleteAccount'].includes(input.action) && queue.busyVisitors.has(auth.id)) throw createCodeError('RUN_ACTIVE', '请等待当前研究结束（Wait for the active run）。');
        const result = await accounts.execute(input.action, input.input, auth.id, auth.user, remoteAddress);
        closeStreams(auth.id);
        if ('user' in result) closeStreams(result.user.workspaceId);
        if ('deleted' in result) {
          const visitor = visitors.get(auth.id);
          if (visitor) await evict(visitor);
          await accounts.delete(auth.user!, result.expectedPasswordHash);
          const root = join(dataDir, 'visitors', auth.id);
          if (!/^[a-f0-9]{32}$/.test(auth.id) || !resolve(root).startsWith(resolve(dataDir, 'visitors') + sep)) throw new Error('Invalid deletion boundary');
          await rm(root, { recursive: true, force: true });
          return json({ ok: true, data: { deleted: true } }, 200, [accountCookie('', true), visitorCookie(randomBytes(16).toString('hex'))]);
        }
        return json({ ok: true, data: { user: result.user, ...('recoveryCode' in result ? { recoveryCode: result.recoveryCode } : {}) } }, 200, [accountCookie(result.token), visitorCookie(result.user.workspaceId)]);
      }
      const visitor = await getVisitor(auth.id);
      if (url.pathname === '/api/events' && request.method === 'GET') {
        if (visitor.streams.size >= 4) throw createCodeError('STREAM_LIMIT', 'Too many open browser tabs.');
        let cleanup = () => {};
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            visitor.streams.add(controller);
            controller.enqueue(encoder.encode(`retry: 1500\nevent: connected\ndata: ${JSON.stringify({ workspaceId: visitor.id })}\n\n`));
            const previous = Number(request.headers.get('last-event-id'));
            if (previous > visitor.sequence || (previous > 0 && visitor.events[0]?.id > previous + 1)) {
              controller.enqueue(encoder.encode('event: reset\ndata: {}\n\n'));
            }
            if (previous > 0) for (const event of visitor.events.filter((item) => item.id > previous)) {
              controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.channel}\ndata: ${JSON.stringify(event.data)}\n\n`));
            }
            let heartbeatBusy = false;
            const heartbeat = setInterval(() => {
              if (heartbeatBusy) return;
              heartbeatBusy = true;
              void (async () => {
                if (auth.user && !await accounts.resolve(auth.sessionToken)) { cleanup(); controller.close(); return; }
                controller.enqueue(encoder.encode(': heartbeat\n\n'));
              })().catch(cleanup).finally(() => { heartbeatBusy = false; });
            }, 15000);
            cleanup = () => { clearInterval(heartbeat); visitor.streams.delete(controller); visitor.cleanups.delete(cleanup); request.signal.removeEventListener('abort', cleanup); };
            visitor.cleanups.add(cleanup);
            request.signal.addEventListener('abort', cleanup, { once: true });
          },
          cancel() { cleanup(); },
        });
        return new Response(body, { headers: {
          'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no', ...(auth.setCookie ? { 'Set-Cookie': auth.setCookie } : {}),
        } });
      }
      if (url.pathname !== '/api/rpc' || request.method !== 'POST') return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }, 404, auth.setCookie);
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw createCodeError('INVALID_ARGUMENT', 'JSON content type is required.');
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 65536) throw createCodeError('INVALID_ARGUMENT', 'Request body is too large.');
      const body = z.object({ method: z.string().max(80), args: z.array(z.unknown()).max(4).default([]) }).parse(JSON.parse(raw));
      const data = await dispatch(visitor, body.method, body.args, request.signal);
      return json({ ok: true, data: data ?? null }, 200, auth.setCookie);
    } catch (error) {
      const known = error instanceof Error && 'code' in error;
      const code = error instanceof z.ZodError || error instanceof SyntaxError ? 'INVALID_ARGUMENT'
        : known ? String(error.code) : 'INTERNAL_ERROR';
      const message = known ? (error as Error).message : code === 'INVALID_ARGUMENT' ? 'Invalid request parameters.' : 'The server could not complete the request.';
      // Raw providers/errors can contain credentials or local paths. Only explicitly safe errors are sent.
      const safeCodes = new Set(['SESSION_NOT_FOUND', 'SESSION_LIMIT', 'RUN_NOT_FOUND', 'QUEUE_FULL', 'SERVER_BUSY', 'STREAM_LIMIT', 'INVALID_ARGUMENT', 'WEB_METHOD_UNAVAILABLE', 'REQUEST_CANCELLED', 'RUN_IN_PROGRESS', 'DAILY_RUN_LIMIT', 'MODEL_ENDPOINT_NOT_ALLOWED', 'MODEL_KEY_REQUIRED', 'RUN_ACTIVE', 'REPORT_NOT_FOUND', 'THESIS_NOT_FOUND', 'IMPORT_LIMIT', 'INVALID_DRAFT', 'DESKTOP_CONNECTION_REQUIRED', 'AUTH_BUSY', 'AUTH_RATE_LIMIT', 'AUTH_ALREADY_SIGNED_IN', 'INVITE_REQUIRED', 'ACCOUNT_EXISTS', 'INVALID_CREDENTIALS', 'SIGN_IN_REQUIRED', 'PORTFOLIO_NOT_FOUND']);
      return json({ ok: false, error: { code, message: safeCodes.has(code) ? message : 'This operation is unavailable or failed. Check the server configuration.' } },
        ['QUEUE_FULL', 'SERVER_BUSY', 'DAILY_RUN_LIMIT', 'AUTH_BUSY', 'AUTH_RATE_LIMIT'].includes(code) ? 429 : code === 'INTERNAL_ERROR' ? 500 : 400, auth.setCookie);
    }
  }

  return {
    fetch: fetchRequest,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(automationTimer);
      while (ticking) await sleep();
      queue.close();
      await allocations;
      await quotaWrites;
      for (const visitor of visitors.values()) {
        for (const run of await visitor.research.listRuns()) if (!terminal.has(run.status)) await visitor.research.cancel(run.id).catch(() => undefined);
        await visitor.kernel.runtime.dispose();
        while (visitor.kernel.runs.isRunning()) await sleep();
        await evict(visitor);
      }
      unregisterStorage(); await database.close(); await unlock();
    },
  };
}
