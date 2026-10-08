import { afterEach, expect, test, spyOn } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { JsonFileStore } from '@finagent/shared';
import { createWebApplication, type ServerOptions } from './app.ts';

const apps: Array<Awaited<ReturnType<typeof createWebApplication>>> = [];
const roots: string[] = [];
afterEach(() => { globalThis.fetch = originalFetch; });
const originalFetch = globalThis.fetch;
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const path of roots.splice(0)) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep + 'felix-web-test-')) throw new Error('Unexpected cleanup path');
    await rm(path, { recursive: true, force: true });
  }
});
async function setup(options: Partial<ServerOptions> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'felix-web-test-'));
  roots.push(dataDir);
  const app = await createWebApplication({ dataDir, ...options });
  apps.push(app);
  return { app, dataDir };
}
function visitor(app: Awaited<ReturnType<typeof createWebApplication>>) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    set cookie(value: string) { cookie = value; },
    async rpc(method: string, ...args: unknown[]) {
      const response = await app.fetch(new Request('http://localhost/api/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ method, args }),
      }));
      cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
      return { status: response.status, ...await response.json() } as { status: number; ok: boolean; data: any; error: { code: string } };
    },
  };
}
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (done(value)) return value;
    await Bun.sleep(20);
  }
  throw new Error('Job did not settle');
}

test('web bootstrap labels demo mode and validates untrusted requests', async () => {
  const { app } = await setup();
  const user = visitor(app);
  const result = await user.rpc('bootstrap');
  expect(result.data.deployment.notice).toContain('填写自己的模型密钥');
  expect(user.cookie).toMatch(/^felix_visitor=[a-f0-9]{32}\.[a-f0-9]{64}$/);
  expect((await user.rpc('market.getQuote', '../../secret')).error.code).toBe('INVALID_ARGUMENT');
  expect((await user.rpc('kernel.createSession', 'x'.repeat(121))).ok).toBe(false);
  expect((await user.rpc('llm.setCredential', 'server', 'never-accepted')).error.code).toBe('INVALID_ARGUMENT');
  expect((await app.fetch(new Request('http://localhost/api/rpc', {
    method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}',
  }))).status).toBe(403);
});

test('assistant portfolio scope resolves only owner imports and rejects client-supplied holdings', async () => {
  const { app } = await setup();
  const owner = visitor(app), other = visitor(app);
  const parsed = await owner.rpc('portfolioImport.parse', { source: 'paste', text: 'AAPL.US 12 180.5' });
  expect((await owner.rpc('portfolioImport.confirm', { draft: parsed.data, name: '我的真实记录' })).ok).toBe(true);
  for (const [user, isOwner] of [[owner, true], [other, false]] as const) {
    const session = (await user.rpc('kernel.createSession', '关注对象测试')).data;
    expect((await user.rpc('kernel.startRun', session.id, '我的持仓', {
      focusObjects: [{ kind: 'portfolio' }], focusData: { manualPortfolios: [{ name: '伪造的数据', holdings: [{ symbol: 'MSFT.US', quantity: 999 }] }] },
    })).ok).toBe(true);
    await eventually(() => user.rpc('kernel.listRuns', session.id), (result) => result.data[0]?.status === 'completed');
    const messages = (await user.rpc('kernel.getMessages', session.id)).data;
    const answer = messages.at(-1).content;
    expect(answer).not.toContain('伪造的数据');
    expect(answer).not.toContain('109,210');
    if (isOwner) { expect(answer).toContain('我的真实记录'); expect(answer).toContain('成本价 180.5'); }
    else { expect(answer).toContain('尚未读取到你的实际持仓'); expect(answer).not.toContain('我的真实记录'); }
  }
});

test('limit-up ladder RPC is typed, sample marked, bounded to a validated date and never changes watchlists', async () => {
  const { app } = await setup(); const user = visitor(app);
  const before = await user.rpc('workspace.get');
  const ladder = await user.rpc('market.getLimitUpLadder', '2026-10-08');
  expect(ladder.ok).toBe(true); expect(ladder.data.source).toBe('demo');
  expect(ladder.data.stocks.every((stock: { symbol: string; boards: number }) => /\.(SH|SZ)$/.test(stock.symbol) && stock.boards >= 1)).toBe(true);
  expect((await user.rpc('market.getLimitUpLadder', 'not-a-date')).ok).toBe(false);
  expect((await user.rpc('market.getLimitUpLadder', '2026-02-29')).ok).toBe(false);
  expect((await user.rpc('workspace.get')).data.watchlist).toEqual(before.data.watchlist);
});

test('signed visitor identity isolates session, messages, runs, and research', async () => {
  const { app } = await setup();
  const owner = visitor(app), other = visitor(app);
  const created = await owner.rpc('kernel.createSession', 'Private session');
  expect((await other.rpc('kernel.hydrate')).data.sessions).toEqual([]);
  for (const method of ['kernel.getMessages', 'kernel.deleteSession', 'kernel.startRun']) {
    expect((await other.rpc(method, created.data.id, 'AAPL.US')).error.code).toBe('SESSION_NOT_FOUND');
  }
  other.cookie = owner.cookie.slice(0, -1) + (owner.cookie.at(-1) === '0' ? '1' : '0');
  expect((await other.rpc('kernel.hydrate')).data.sessions).toEqual([]);
  const research = await owner.rpc('research.start', { symbol: 'AAPL.US', strategyId: 'technical' });
  expect(research.ok).toBe(true);
  expect((await other.rpc('research.getRun', { runId: research.data.id })).data).toBeNull();
  await eventually(() => owner.rpc('research.getRun', { runId: research.data.id }), (r) => Boolean(r.data.reportId));
  expect((await other.rpc('research.listReports', {})).data).toEqual([]);
});

test('demo chat emits agent/SSE events and persists across server restart', async () => {
  const { app, dataDir } = await setup();
  const user = visitor(app);
  const created = await user.rpc('kernel.createSession', '行情研究');
  const stream = await app.fetch(new Request('http://localhost/api/events', { headers: { Cookie: user.cookie } }));
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: connected');
  const started = await user.rpc('kernel.startRun', created.data.id, '查询 AAPL.US 的行情');
  expect(started.ok).toBe(true);
  let events = '';
  while (!events.includes('run_completed')) events += new TextDecoder().decode((await reader.read()).value);
  expect(events).toContain('event: agent');
  expect(events).toContain('event: stream');
  const messages = await eventually(() => user.rpc('kernel.getMessages', created.data.id), (r) => r.data.length === 2);
  expect(messages.data[1].content).toContain('AAPL');
  await reader.cancel();
  const replay = await app.fetch(new Request('http://localhost/api/events', { headers: { Cookie: user.cookie, 'Last-Event-ID': '1' } }));
  const replayReader = replay.body!.getReader();
  await replayReader.read();
  expect(new TextDecoder().decode((await replayReader.read()).value)).toContain('event:');
  await replayReader.cancel();
  await app.close();
  const restored = await createWebApplication({ dataDir }); apps.push(restored);
  const again = visitor(restored); again.cookie = user.cookie;
  expect((await again.rpc('kernel.hydrate')).data.sessions[0].id).toBe(created.data.id);
  expect((await again.rpc('kernel.getMessages', created.data.id)).data).toEqual(messages.data);
});

test('daily run budget persists and applies across new visitor cookies', async () => {
  const { app, dataDir } = await setup({ dailyRunLimit: 1 });
  const user = visitor(app), second = visitor(app);
  const first = await user.rpc('kernel.createSession');
  expect((await user.rpc('kernel.startRun', first.data.id, '查询 AAPL.US 的行情')).ok).toBe(true);
  await eventually(() => user.rpc('kernel.getMessages', first.data.id), (r) => r.data.length === 2);
  const other = await second.rpc('kernel.createSession');
  const blocked = await second.rpc('kernel.startRun', other.data.id, '查询 AAPL.US 的行情');
  expect(blocked.status).toBe(429);
  expect(blocked.error.code).toBe('DAILY_RUN_LIMIT');
  await app.close();
  const restored = await createWebApplication({ dataDir, dailyRunLimit: 1 }); apps.push(restored);
  const again = visitor(restored);
  expect((await again.rpc('research.start', { symbol: 'AAPL.US' })).error.code).toBe('DAILY_RUN_LIMIT');
});

test('demo research report, diff, comparison, and explicit live-mode failure', async () => {
  const { app } = await setup();
  const user = visitor(app);
  expect((await user.rpc('market.getQuote', 'AAPL.US')).data.symbol).toBe('AAPL.US');
  expect((await user.rpc('market.getKline', { symbol: 'AAPL.US', limit: 30 })).data.length).toBeGreaterThan(0);
  expect((await user.rpc('compare.build', ['AAPL.US', 'MSFT.US'])).ok).toBe(true);
  for (let i = 0; i < 2; i++) {
    const started = await user.rpc('research.start', { symbol: 'AAPL.US', strategyId: 'technical' });
    const finished = await eventually(() => user.rpc('research.getRun', { runId: started.data.id }), (r) => Boolean(r.data.reportId));
    const report = await user.rpc('research.getReport', { reportId: finished.data.reportId });
    expect(report.data.symbol).toBe('AAPL.US');
    expect(report.data.sections.length).toBeGreaterThan(0);
  }
  expect((await user.rpc('research.getDiff', { symbol: 'AAPL.US' })).data.currentReportId).toBeTruthy();
  const live = visitor((await setup({ demoData: false })).app);
  expect((await live.rpc('market.getQuote', 'AAPL.US')).ok).toBe(false);
  expect((await live.rpc('market.getPortfolio')).ok).toBe(false);
});

test('production requires HTTPS and emits Secure HttpOnly cookies', async () => {
  const { app: initial, dataDir } = await setup();
  await initial.close();
  await expect(createWebApplication({ dataDir, production: true })).rejects.toThrow('HTTPS');
  const app = await createWebApplication({ dataDir, production: true, publicOrigin: 'https://felix.example.com' }); apps.push(app);
  const response = await app.fetch(new Request('https://felix.example.com/api/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://felix.example.com' }, body: '{"method":"bootstrap"}',
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax');
  expect(response.headers.get('set-cookie')).toContain('Secure');
});


test('BYOK credentials are isolated, encrypted, retained across restart, and removable', async () => {
  const { app, dataDir } = await setup();
  const user = visitor(app), other = visitor(app);
  const secret = 'test-only-visitor-key-not-for-use';
  expect((await user.rpc('llm.setCredential', 'deepseek', secret)).ok).toBe(true);
  expect((await user.rpc('llm.getState')).data.model.provider).toBe('deepseek');
  expect((await other.rpc('llm.getState')).data.model).toBeUndefined();
  expect((await other.rpc('llm.listCredentials')).data.every((item: any) => !item.configured)).toBe(true);
  for (const method of ['llm.getState', 'llm.listModels', 'llm.getProviders', 'llm.listCredentials', 'diagnostics.collect']) expect(JSON.stringify(await user.rpc(method))).not.toContain(secret);
  const visitorId = user.cookie.split('=')[1].split('.')[0];
  const sealed = JSON.stringify(await new JsonFileStore(join(dataDir, 'visitors', visitorId)).read('model-vault.json', null));
  expect(sealed).not.toContain(secret);
  expect(JSON.parse(sealed).tag).toHaveLength(32);
  await app.close(); apps.splice(apps.indexOf(app), 1);
  const restarted = await createWebApplication({ dataDir }); apps.push(restarted);
  const restored = visitor(restarted); restored.cookie = user.cookie;
  expect((await restored.rpc('llm.getState')).data.model.provider).toBe('deepseek');
  expect((await restored.rpc('llm.removeCredential', 'deepseek')).ok).toBe(true);
  expect((await restored.rpc('llm.getState')).data.model).toBeUndefined();
  expect((await restored.rpc('llm.listCredentials')).data.every((item: any) => !item.configured)).toBe(true);
});

test('a model run uses the current visitor key, never another visitor credential', async () => {
  const sent: string[] = [];
  spyOn(globalThis, 'fetch').mockImplementation((async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers).get('authorization') ?? '');
    return new Response('data: '+JSON.stringify({ choices: [{ delta: { content: '仅供研究的测试回答。' } }] })+'\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch);
  const { app } = await setup(); const user = visitor(app), other = visitor(app);
  await user.rpc('llm.setCredential', 'deepseek', 'test-user-one-key');
  await other.rpc('llm.setCredential', 'deepseek', 'test-user-two-key');
  const session = (await user.rpc('kernel.createSession', 'Own key')).data;
  const started = await user.rpc('kernel.startRun', session.id, '研究 AAPL.US'); expect(started.ok).toBe(true);
  await eventually(() => user.rpc('kernel.listRuns', session.id), (result) => result.data.some((run: any) => run.status === 'completed'));
  expect(sent).toEqual(['Bearer test-user-one-key']);
  expect(JSON.stringify(await user.rpc('kernel.getMessages', session.id))).not.toContain('test-user-one-key');
});

test('custom model endpoints reject private, unapproved and credential-bearing URLs', async () => {
  const { app } = await setup(); const user = visitor(app);
  for (const baseUrl of ['http://localhost:3000/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/v1', 'https://unapproved.example/v1', 'https://user:password@api.deepseek.com/v1', 'https://api.deepseek.com/v1?key=hidden', 'https://api.deepseek.com:8443/v1']) {
    const result = await user.rpc('llm.setCustomProvider', { name: 'custom-test', displayName: 'Custom test', baseUrl, apiKey: 'dummy-test-key', models: [{ id: 'test-model', name: 'Test model' }] });
    expect(result.ok).toBe(false);
  }
  expect((await user.rpc('llm.setCustomProvider', { name: 'custom-test', displayName: 'Custom test', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'dummy-test-key', models: [{ id: 'deepseek-chat', name: 'Chat' }] })).ok).toBe(true);
  expect((await user.rpc('llm.setModel', 'custom-test', 'deepseek-chat')).ok).toBe(true);
  expect((await user.rpc('llm.removeCustomProvider', 'custom-test')).ok).toBe(true);
  expect((await user.rpc('llm.listModels')).data.some((model: any) => model.provider === 'custom-test')).toBe(false);
});

test('complete web domains persist visitor theses, imports, rules and skill preferences', async () => {
  const { app } = await setup(); const user = visitor(app), other = visitor(app);
  const started = await user.rpc('research.start', { symbol: 'AAPL.US', strategyId: 'technical' });
  expect(started.ok).toBe(true);
  await eventually(() => user.rpc('research.getRun', { runId: started.data.id }), (r) => !!r.data?.reportId);
  const thesis = await user.rpc('thesis.saveFromReport', 'AAPL.US'); expect(thesis.ok).toBe(true);
  expect((await user.rpc('thesis.list')).data).toHaveLength(1);
  expect((await other.rpc('thesis.list')).data).toEqual([]);
  expect((await other.rpc('thesis.update', thesis.data)).ok).toBe(false);
  expect((await user.rpc('outcome.listOpinions', {})).data).toHaveLength(1);
  expect((await user.rpc('performance.skill', { horizon: '1m' })).ok).toBe(true);
  const parsed = await user.rpc('portfolioImport.parse', { source: 'csv', text: 'symbol,quantity,cost_price,currency\nAAPL.US,10,100,USD' }); expect(parsed.ok).toBe(true);
  expect((await other.rpc('portfolioImport.confirm', { draft: parsed.data, name: 'Imported' })).ok).toBe(false);
  expect((await user.rpc('portfolioImport.confirm', { draft: parsed.data, name: 'Imported' })).ok).toBe(true);
  expect((await user.rpc('portfolioImport.listManual')).data).toHaveLength(1);
  expect((await other.rpc('portfolioImport.listManual')).data).toEqual([]);
  const skills = await user.rpc('skills.list'); expect(skills.data.length).toBeGreaterThan(0);
  expect((await user.rpc('skills.setEnabled', skills.data[0].id, false)).ok).toBe(true);
  expect((await user.rpc('skills.list')).data[0].enabled).toBe(false);
  expect((await user.rpc('skills.readResource', skills.data[0].id, '../../.cookie-signing-key')).ok).toBe(false);
  expect((await user.rpc('automation.listRules')).data).toHaveLength(5);
  for (const method of ['alerts.loadRules', 'alerts.listEvents', 'evaluation.listExperiments', 'evaluation.listBaselines', 'evaluation.listFeedback', 'connections.list', 'connections.coverage', 'health.check', 'diagnostics.collect']) expect((await user.rpc(method)).ok).toBe(true);
  expect((await user.rpc('connections.setConfig', 'massive', { apiKey: 'dummy-market-key' })).ok).toBe(true);
  expect(JSON.stringify(await user.rpc('connections.list'))).not.toContain('dummy-market-key');
  expect((await other.rpc('connections.list')).data[0].configured).toBe(false);
});


test('model thesis reviews cannot change persisted identity or select a storage path', async () => {
  const { app } = await setup(); const user = visitor(app);
  const started = await user.rpc('research.start', { symbol: 'AAPL.US', strategyId: 'technical' });
  await eventually(() => user.rpc('research.getRun', { runId: started.data.id }), (result) => !!result.data?.reportId);
  const thesis = (await user.rpc('thesis.saveFromReport', 'AAPL.US')).data;
  await eventually(() => user.rpc('llm.setCredential', 'deepseek', 'test-review-only-key'), (result) => result.ok);
  expect((await user.rpc('llm.getState')).data.model.provider).toBe('deepseek');
  const answer = JSON.stringify({ kind: 'unchanged', summary: 'Test review', updatedThesis: { ...thesis, id: '../../model-vault', symbol: 'MSFT.US', createdAt: 0 } });
  spyOn(globalThis, 'fetch').mockImplementation((async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch);
  const reviewed = await user.rpc('thesis.reEvaluate', 'AAPL.US');
  expect(reviewed.ok).toBe(true);
  expect(reviewed.data.thesis.id).toBe(thesis.id);
  expect(reviewed.data.thesis.symbol).toBe(thesis.symbol);
  expect(reviewed.data.thesis.createdAt).toBe(thesis.createdAt);
  expect((await user.rpc('thesis.list')).data).toHaveLength(1);
  expect((await user.rpc('llm.listCredentials')).data.some((credential: any) => credential.configured)).toBe(true);
});
