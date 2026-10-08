import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AlertRule, AutomationRule, CapabilityRegistry, ThesisImpactEvaluator, PortfolioImportDraft, ResearchReport, ScreeningQuery } from '@finagent/core';
import { STRATEGY_IDS } from '@finagent/core';
import { SkillHub, skillCapabilityMap } from '@finagent/skill-hub';
import {
  JsonFileStore, MarketDataService, CapabilityExecutor, ThesisRepository, ThesisImpactRepository,
  ThesisService, createLocalThesisEvaluator, thesisSchema, ScreeningService, ScreeningRunRepository,
  PulseService, PortfolioRiskService, AlertRuleRepository, AlertEventLog, AlertEngine,
  OutcomeRepository, OutcomeService, PerformanceService, computeSkillCalibrations, computeStrategyCalibrations,
  AutomationRuleRepository, AutomationRunRepository, runAutomation, buildBrief, ResearchDiffRepository,
  ManualPortfolioRepository, parseImportText, createDraft, draftToPortfolioInput, validateDraft,
  EvaluationStore, sanitizeSettings, createCodeError, computeSkillReadiness, buildDiff,
} from '@finagent/shared';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const symbol = z.string().regex(/^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/);
const horizon = z.object({ horizon: z.enum(['1w', '1m', '3m']) });
const automationTypes = ['watchlist-daily-review', 'portfolio-daily-brief', 'weekly-thesis-review', 'pre-earnings-research', 'post-earnings-research'] as const;
const automationSchema = z.object({ id, type: z.enum(automationTypes), enabled: z.boolean(), hour: z.number().min(0).max(23.99).optional(), days: z.array(z.number().int().min(0).max(6)).max(7).optional(), symbols: z.array(symbol).max(40).optional(), strategyId: z.enum(STRATEGY_IDS as [string, ...string[]]).optional(), notify: z.enum(['material-only', 'all']), createdAt: z.number().finite().nonnegative() });
const importRow = z.object({ symbol: z.union([symbol, z.literal('')]), name: z.string().max(160).optional(), quantity: z.number().finite().nonnegative().optional(), costPrice: z.number().finite().nonnegative().optional(), currency: z.string().max(10).optional(), account: z.string().max(160).optional(), confidence: z.number().min(0).max(1), issues: z.array(z.string().max(500)).max(20) });
const draftSchema = z.object({ id, source: z.enum(['csv', 'paste', 'screenshot']), rows: z.array(importRow).min(1).max(200), importedAt: z.number().finite(), warnings: z.array(z.string().max(500)).max(100) });
const alertBase = z.object({ id, enabled: z.boolean(), cooldownMinutes: z.number().min(1).max(10080), createdAt: z.number().finite(), lastCheckedAt: z.number().finite().optional(), lastTriggeredAt: z.number().finite().optional(), label: z.string().max(160).optional() });
const symbolBase = alertBase.extend({ symbol });
const alertSchema = z.discriminatedUnion('type', [
  symbolBase.extend({ type: z.literal('price_above'), targetPrice: z.number().finite().nonnegative() }),
  symbolBase.extend({ type: z.literal('price_below'), targetPrice: z.number().finite().nonnegative() }),
  symbolBase.extend({ type: z.literal('new_news') }), symbolBase.extend({ type: z.literal('rating_change') }), symbolBase.extend({ type: z.literal('dividend') }),
  symbolBase.extend({ type: z.literal('earnings'), horizonDays: z.number().int().min(1).max(365) }),
  symbolBase.extend({ type: z.literal('position_weight'), minWeight: z.number().min(0).max(100).optional(), maxWeight: z.number().min(0).max(100).optional() }),
  alertBase.extend({ type: z.literal('portfolio_drawdown'), threshold: z.number().min(0).max(100) }),
]);

/** Same domain services as Electron, with a separate repository for each visitor. */
export class VisitorServices {
  readonly theses: ThesisRepository;
  readonly thesis: ThesisService;
  readonly screening: ScreeningService;
  readonly pulse: PulseService;
  readonly risk: PortfolioRiskService;
  readonly opinions: OutcomeRepository;
  readonly outcomes: OutcomeService;
  readonly performance: PerformanceService;
  readonly alerts: AlertRuleRepository;
  readonly alertEvents: AlertEventLog;
  readonly alertEngine: AlertEngine;
  readonly automation: AutomationRuleRepository;
  readonly automationRuns: AutomationRunRepository;
  readonly diffs: ResearchDiffRepository;
  readonly portfolios: ManualPortfolioRepository;
  readonly evaluation: EvaluationStore;
  readonly skills: SkillHub;
  private readonly drafts = new Set<string>();
  private mutations: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: JsonFileStore, root: string, private readonly registry: CapabilityRegistry,
    private readonly market: MarketDataService, private readonly reports: (symbol?: string) => Promise<ResearchReport[]>,
    private readonly startResearch: (symbol: string, strategyId?: string) => Promise<unknown>,
    publish: (channel: string, event: unknown) => void, skillsDir?: string, evaluator?: ThesisImpactEvaluator) {
    const executor = new CapabilityExecutor();
    this.theses = new ThesisRepository({ storageDir: join(root, 'thesis') });
    this.thesis = new ThesisService({ registry, repository: this.theses, impactRepository: new ThesisImpactRepository({ storageDir: join(root, 'thesis') }), evaluator: evaluator ?? createLocalThesisEvaluator(), executor });
    this.screening = new ScreeningService({ registry, executor, repository: new ScreeningRunRepository(store) });
    this.pulse = new PulseService({ registry, screening: this.screening, executor });
    this.risk = new PortfolioRiskService({ registry, executor });
    this.opinions = new OutcomeRepository(store); this.outcomes = new OutcomeService({ repository: this.opinions });
    this.performance = new PerformanceService(this.opinions);
    this.alerts = new AlertRuleRepository(store); this.alertEvents = new AlertEventLog(store);
    this.alertEngine = new AlertEngine({ registry, repository: this.alerts, eventLog: this.alertEvents, onTrigger: (event) => publish('alert', event) });
    this.automation = new AutomationRuleRepository(store); this.automationRuns = new AutomationRunRepository(store);
    this.diffs = new ResearchDiffRepository(store); this.portfolios = new ManualPortfolioRepository(store);
    this.evaluation = new EvaluationStore(store);
    this.skills = new SkillHub({
      skillsDirectory: skillsDir ?? resolve(import.meta.dirname, '../../../skills'), stateFile: join(root, 'skills-state.json'),
      stateStorage: { read: () => store.read('skills-state.json', { enabled: {} }), write: (state) => store.write('skills-state.json', state) },
    });
  }
  async initialize() {
    await this.skills.loadSkills();
    if (!(await this.automation.list()).length) for (const type of automationTypes) await this.automation.save({ id: type, type, enabled: false, hour: 16, days: [1, 2, 3, 4, 5], symbols: undefined, strategyId: type === 'weekly-thesis-review' ? 'risk-review' : 'comprehensive', notify: 'material-only', createdAt: Date.now() });
    this.alertEngine.start();
  }
  async onReport(report: ResearchReport) {
    await this.outcomes.createOpinionFromReport(report);
    const prior = (await this.reports(report.symbol)).filter((item) => item.id !== report.id)[0];
    if (prior) await this.diffs.save(buildDiff(prior, report));
  }
  async close() { this.alertEngine.stop(); await this.mutations; }
  private async latestReport(value: unknown) { return (await this.reports(symbol.parse(value)))[0]; }
  dispatch(method: string, args: unknown[]): Promise<unknown> {
    // Read/modify/write repositories are serialized to prevent concurrent tab updates losing data.
    const work = this.mutations.then(() => this.execute(method, args));
    this.mutations = work.catch(() => undefined);
    return work;
  }
  private async execute(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'thesis.list': return args[0] ? this.theses.getBySymbol(symbol.parse(args[0])) : this.theses.list();
      case 'thesis.getReport': return this.latestReport(args[0]);
      case 'thesis.saveFromReport': { const report = await this.latestReport(args[0]); if (!report) throw createCodeError('REPORT_NOT_FOUND', '请先完成研究报告。'); return this.thesis.saveFromReport(report); }
      case 'thesis.reEvaluate': return this.thesis.reEvaluate(symbol.parse(args[0]));
      case 'thesis.listImpacts': return this.thesis.listImpacts(symbol.parse(args[0]));
      case 'thesis.update': {
        const value = thesisSchema.parse(args[0]); id.parse(value.id);
        if (!(await this.theses.get(value.id))) throw createCodeError('THESIS_NOT_FOUND', 'Thesis not found');
        return this.thesis.updateThesis(value);
      }
      case 'screening.run': {
        const query = z.object({ strategy: z.string().max(40), universe: z.array(symbol).max(40).optional(), market: z.enum(['US', 'HK', 'SG', 'SH', 'SZ']).optional(), filters: z.record(z.union([z.string().max(80), z.number().finite(), z.boolean()])).optional(), limit: z.number().int().min(1).max(40) }).parse(args[0]);
        return this.screening.runScreening(query as ScreeningQuery);
      }
      case 'screening.listRuns': return this.screening.listRuns();
      case 'screening.getRun': return this.screening.getRun(z.object({ runId: id }).parse(args[0]).runId);
      case 'pulse.snapshot': return this.pulse.snapshot(z.object({ watchlist: z.array(z.object({ symbol, lastPrice: z.number().finite().nonnegative().optional() })).max(40), market: z.enum(['US', 'HK', 'SG']).optional() }).parse(args[0]));
      case 'portfolioRisk.analyze': {
        const input = z.object({ accountId: z.string().max(140).optional() }).parse(args[0] ?? {});
        if (!input.accountId) return this.risk.analyze();
        if (input.accountId.startsWith('manual:')) {
          const portfolio = await this.portfolios.get(id.parse(input.accountId.slice(7)));
          if (!portfolio) throw createCodeError('PORTFOLIO_NOT_FOUND', '组合不存在。');
          return this.risk.analyze(undefined, { holdings: portfolio.holdings, accounts: [], baseCurrency: portfolio.currency, fetchedAt: portfolio.updatedAt });
        }
        const portfolio = await this.market.getPortfolio();
        if (!portfolio.accounts.some((account) => account.id === input.accountId)) throw createCodeError('PORTFOLIO_NOT_FOUND', '组合不存在。');
        return this.risk.analyze(undefined, { ...portfolio, holdings: portfolio.holdings.filter((holding) => holding.symbol.split('.').at(-1) === portfolio.accounts.find((account) => account.id === input.accountId)?.market) });
      }
      case 'outcome.listOpinions': return this.opinions.listOpinions(z.object({ symbol: symbol.optional() }).parse(args[0] ?? {}).symbol);
      case 'outcome.listOutcomes': return this.opinions.listOutcomes(z.object({ symbol: symbol.optional() }).parse(args[0] ?? {}).symbol);
      case 'outcome.evaluateDue': return this.outcomes.evaluateDue(Date.now(), async (symbol) => { try { return await this.market.getKline({ symbol, period: '1d', limit: 200 }); } catch { return null; } });
      case 'performance.skill': return this.performance.skillPerformance(horizon.parse(args[0]).horizon);
      case 'performance.strategy': return this.performance.strategyPerformance(horizon.parse(args[0]).horizon);
      case 'performance.calibration': return computeSkillCalibrations(await this.opinions.listOpinions(), await this.opinions.listOutcomes(), horizon.parse(args[0]).horizon);
      case 'performance.strategyCalibration': return computeStrategyCalibrations(await this.opinions.listOpinions(), await this.opinions.listOutcomes(), horizon.parse(args[0]).horizon);
      case 'alerts.loadRules': return this.alerts.list();
      case 'alerts.saveRules': { const rules = z.array(alertSchema).max(50).parse(args[0]); await this.store.write('alerts.json', rules); return; }
      case 'alerts.listEvents': return this.alertEvents.list();
      case 'automation.listRules': return this.automation.list();
      case 'automation.listRuns': return this.automationRuns.list();
      case 'automation.saveRule': {
        const rule = automationSchema.parse(args[0]) as AutomationRule;
        if (!(await this.automation.get(rule.id))) throw createCodeError('INVALID_ARGUMENT', 'Unknown automation rule');
        return this.automation.save(rule);
      }
      case 'automation.removeRule': return this.automation.remove(id.parse(args[0]));
      case 'automation.runRule': {
        const rule = await this.automation.get(z.object({ ruleId: id }).parse(args[0]).ruleId);
        if (!rule) throw createCodeError('INVALID_ARGUMENT', 'Unknown automation rule');
        const result = await runAutomation(rule, { registry: this.registry, diffRepo: this.diffs, researchStart: this.startResearch, watchlistSymbols: async () => rule.symbols ?? (await this.store.read('workspace.json', { watchlist: ['AAPL.US', 'TSLA.US', 'NVDA.US'] })).watchlist, portfolioSymbols: async () => (await this.market.getPortfolio()).holdings.map((holding) => holding.symbol), thesisSymbols: async () => (await this.theses.list()).map((thesis) => thesis.symbol), locale: 'zh-CN' });
        await this.automationRuns.record(result); return result;
      }
      case 'automation.buildBrief': return buildBrief({ runs: await this.automationRuns.list(), alerts: await this.alertEvents.list(), diffs: await this.diffs.list(), portfolio: [], movers: [] });
      case 'portfolioImport.parse': {
        const input = z.object({ source: z.enum(['csv', 'paste']), text: z.string().min(1).max(48000) }).parse(args[0]);
        const draft = createDraft(input.source, parseImportText(input.source, input.text));
        if (draft.rows.length > 200 || this.drafts.size >= 20) throw createCodeError('IMPORT_LIMIT', '最多导入 200 行。');
        this.drafts.add(draft.id); return draft;
      }
      case 'portfolioImport.confirm': {
        const input = z.object({ draft: draftSchema, name: z.string().trim().min(1).max(160) }).parse(args[0]);
        if (!this.drafts.has(input.draft.id) || validateDraft(input.draft).length) throw createCodeError('INVALID_DRAFT', '请重新解析并检查导入内容。');
        const result = await this.portfolios.create(draftToPortfolioInput(input.draft, input.name)); this.drafts.delete(input.draft.id); return result;
      }
      case 'portfolioImport.listManual': return this.portfolios.list();
      case 'skills.list': {
        const metadata = new Map(this.skills.listSkillMetadata().map((item) => [item.id, item]));
        return this.skills.listSkills().map((skill) => ({ id: skill.id, name: skill.name, enabled: skill.metadata.enabled, keywords: skill.trigger.keywords, description: metadata.get(skill.id)?.description ?? '', riskLevel: metadata.get(skill.id)?.riskLevel, tier: metadata.get(skill.id)?.tier, version: metadata.get(skill.id)?.version, author: metadata.get(skill.id)?.author }));
      }
      case 'skills.setEnabled': return this.skills.setEnabled(id.parse(args[0]), z.boolean().parse(args[1]));
      case 'skills.listResources': return this.skills.listSkillResources(id.parse(args[0]));
      case 'skills.readResource': return this.skills.readSkillResource(id.parse(args[0]), z.string().max(300).parse(args[1]));
      case 'skills.readiness': return Object.entries(skillCapabilityMap).map(([skillId, requirements]) => computeSkillReadiness(skillId, requirements, this.registry));
      case 'evaluation.getSettings': return { settings: await this.evaluation.getSettings(), connection: { status: 'missing_credential', message: '网页版评测记录保存在访客工作区。' }, langfuse: { status: 'missing_credential', message: '未连接' } };
      case 'evaluation.status': { const settings = await this.evaluation.getSettings(); return { backend: 'local', tracingEnabled: false, privacyLevel: settings.privacyLevel, project: settings.langsmithProject }; }
      case 'evaluation.setSettings': {
        const input = z.object({ privacyLevel: z.enum(['minimal', 'standard', 'full']).optional(), langsmithProject: z.string().max(128).optional(), tracingEnabled: z.literal(false).optional(), langfuseTracingEnabled: z.literal(false).optional(), onlineEvaluationEnabled: z.literal(false).optional(), langsmithEndpoint: z.string().max(512).optional(), langfuseHost: z.string().max(512).optional() }).parse(args[0]);
        return this.evaluation.saveSettings(sanitizeSettings({ ...await this.evaluation.getSettings(), ...input, updatedAt: Date.now() }));
      }
      case 'evaluation.listExperiments': return this.evaluation.listExperiments();
      case 'evaluation.getExperiment': { const experimentId = id.parse(args[0]); const experiment = await this.evaluation.getExperiment(experimentId); return experiment ? { experiment, runs: await this.evaluation.listRuns(experimentId), results: await this.evaluation.listResults(experimentId) } : undefined; }
      case 'evaluation.getCase': { const caseId = id.parse(args[0]); return (await this.evaluation.listDatasets()).flatMap((dataset) => dataset.cases).find((entry) => entry.id === caseId); }
      case 'evaluation.listBaselines': return this.evaluation.listBaselines();
      case 'evaluation.listFeedback': return this.evaluation.listFeedback();
      case 'evaluation.submitFeedback': { const input = z.object({ caseId: id, verdict: z.enum(['good', 'bad']), note: z.string().max(2000).optional() }).parse(args[0]); await this.evaluation.addFeedback({ ...input, id: randomUUID(), createdAt: Date.now() }); return; }
      case 'evaluation.getTraceLink': return this.evaluation.lookupTraceLink(z.object({ runId: id }).parse(args[0]).runId);
      default: throw createCodeError('WEB_METHOD_UNAVAILABLE', '此集成需要桌面版的本地运行环境或尚未连接。');
    }
  }
}
