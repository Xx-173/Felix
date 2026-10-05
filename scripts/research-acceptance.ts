/** Public-data-only acceptance of the durable research and verification pipeline. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FinanceCapability, ResearchSynthesis, ResearchSynthesizer } from '@finagent/core';
import { createCapabilityRegistry, createFullRegistry } from '../packages/shared/src/capabilities/index.ts';
import { ResearchService } from '../packages/shared/src/research/service.ts';
import { ResearchReportRepository } from '../packages/shared/src/research/repository.ts';
import { JsonFileStore } from '../packages/shared/src/storage/json-file-store.ts';
import { createClaimVerifier } from '../packages/shared/src/research/claim-verifier.ts';
import { parseSynthesisJson } from '../packages/shared/src/research/agent-synth.ts';
import { createJudgeClient, resolveJudgeConfigStatus, type JudgeClient } from '../packages/shared/src/evaluation/judge-client.ts';
import { reportToMarkdown } from '../packages/shared/src/export/markdown.ts';
import { buildSynthesisPrompt } from '../apps/electron/src/main/research-prompts.ts';

const usage = `Usage: bun scripts/research-acceptance.ts [--mode fixture|live] [--symbol NVDA.US] [--out directory]
Default: fixture, public data only, no network or credentials.
Live requires Longbridge CLI plus FINAGENT_ACCEPTANCE_AGENT_PROVIDER/MODEL/API_KEY
(optional BASE_URL), and a separate FINAGENT_JUDGE_PROVIDER/MODEL/API_KEY (optional BASE_URL).
Exit 0: acceptance criteria met; 1: quality failure; 2: setup/execution failure.
Outputs contain public source snapshots and report evidence, never keys or account holdings.`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); return 0; }
  let mode = 'fixture';
  let symbol = 'NVDA.US';
  let out: string | undefined;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    if (args[i] === '--mode') mode = value;
    else if (args[i] === '--symbol') symbol = value.trim().toUpperCase();
    else if (args[i] === '--out') out = value;
    else throw new Error(`Unknown flag ${args[i]}`);
  }
  if (!['fixture', 'live'].includes(mode)) throw new Error('Mode must be fixture or live.');
  if (!/^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/.test(symbol)) throw new Error('Invalid market symbol.');
  const output = resolve(out ?? join('artifacts', 'research-acceptance', `${mode}-${Date.now()}`));
  const captured: Array<{ capabilityId: string; data: unknown; provenance: unknown }> = [];
  let capabilities: FinanceCapability[];
  let synthesizer: ResearchSynthesizer;
  let judge: JudgeClient;
  let agentModel = 'scripted-fixture';

  if (mode === 'fixture') {
    const ids = ['company.profile', 'company.valuation', 'company.financials', 'company.dividends'];
    const schemas = createFullRegistry();
    capabilities = ids.map((id): FinanceCapability => ({
      id, name: id, description: 'Acceptance fixture', category: 'company', auth: 'public', riskLevel: 'read',
      toolName: id.replace('.', '_'), inputSchema: schemas.get(id)!.inputSchema,
      async execute() {
        return { data: { symbol, pe: 25, available: true }, provenance: { provider: 'fixture', fetchedAt: Date.now(), stale: false } };
      },
    }));
    synthesizer = { async synthesize(): Promise<ResearchSynthesis> {
      return { summary: 'The observed P/E is 25.', stance: 'neutral', confidence: 0.6,
        sections: ids.map((key) => ({ key, title: key, verdict: 'neutral', summary: 'The source contains data for this capability.' })),
        bullCase: ['The stock is guaranteed to double because of valuation.'], bearCase: [], catalysts: [], risks: [],
      };
    } };
    judge = { provider: 'fixture', model: 'scripted-verifier', async complete(_system, user) {
      const input = JSON.parse(user);
      return JSON.stringify({ status: input.claim.includes('guaranteed') ? 'insufficient_evidence' : 'supported', reason: 'Scripted fixture verdict, not measured model quality.' });
    } };
  } else {
    // Validate all explicit credentials before invoking any provider or model.
    const agentConfig = resolveJudgeConfigStatus({}, {
      provider: process.env.FINAGENT_ACCEPTANCE_AGENT_PROVIDER, model: process.env.FINAGENT_ACCEPTANCE_AGENT_MODEL,
      apiKey: process.env.FINAGENT_ACCEPTANCE_AGENT_API_KEY, baseUrl: process.env.FINAGENT_ACCEPTANCE_AGENT_BASE_URL,
    }).config;
    const judgeConfig = resolveJudgeConfigStatus(process.env).config;
    if (!agentConfig || !judgeConfig) throw new Error('Live acceptance requires explicit agent and judge configuration.');
    if (agentConfig.model === judgeConfig.model) throw new Error('Use a judge model different from the synthesis model.');
    const agent = createJudgeClient(agentConfig);
    judge = createJudgeClient(judgeConfig);
    agentModel = agent.model;
    // Account capabilities are removed before planning: no portfolio adapter is executed.
    capabilities = createFullRegistry().list().filter((cap) => cap.auth === 'public' && cap.riskLevel === 'read');
    synthesizer = { async synthesize(input, signal) {
      const timeout = AbortSignal.timeout(60_000);
      return parseSynthesisJson(await agent.complete('Use only supplied source data. Return strict JSON.',
        buildSynthesisPrompt(input) + '\nFor this focused acceptance run, use at most one point in each list.',
        signal ? AbortSignal.any([signal, timeout]) : timeout));
    } };
  }
  const registry = createCapabilityRegistry(capabilities.map((cap) => ({ ...cap, async execute(input, ctx) {
    const result = await cap.execute(input, ctx);
    captured.push({ capabilityId: cap.id, data: result.data, provenance: result.provenance });
    return result;
  } })));
  await mkdir(output, { recursive: true });
  const repository = new ResearchReportRepository(new JsonFileStore(join(output, 'store')));
  const service = new ResearchService({ registry, repository, synthesizer, claimVerifier: createClaimVerifier(judge),
    budgets: { defaults: { wallClockMs: 240_000, modelCalls: 13, toolCalls: 8 } },
    getIdentity: async () => ({ provider: mode, model: agentModel, config: `value/claim-verifier-v1/${judge.model}` }),
  });
  const run = await service.start(symbol, 'value', 'en-US');
  const deadline = Date.now() + 240_000;
  let terminal = await service.getRun(run.id);
  while (terminal && !['completed', 'partial', 'failed', 'interrupted', 'cancelled'].includes(terminal.status) && Date.now() < deadline) {
    await Bun.sleep(50);
    terminal = await service.getRun(run.id);
  }
  if (terminal && !['completed', 'partial', 'failed', 'interrupted', 'cancelled'].includes(terminal.status)) {
    await service.cancel(run.id);
  }
  const report = terminal?.reportId ? await repository.getReport(terminal.reportId) : undefined;
  const claims = report?.claimVerification ?? [];
  const passed = terminal?.status === 'completed' && claims.length > 0 && (mode === 'fixture'
    ? claims.some((c) => c.claimId === 'bullCase:0' && c.status === 'insufficient_evidence') &&
      claims.filter((c) => c.claimId !== 'bullCase:0').every((c) => c.status === 'supported')
    : claims.every((c) => c.status === 'supported'));
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ mode, symbol, agentModel, judgeModel: judge.model,
    passed, run: terminal, sourceSnapshots: captured, report,
    limitation: mode === 'fixture' ? 'Scripted regression acceptance; no real data or model quality measured.' : 'Tests research workflow with direct model calls; does not test Pi RPC or Electron IPC.',
  }, null, 2));
  if (report) await writeFile(join(output, 'report.md'), reportToMarkdown(report));
  console.log(`${mode} acceptance: ${passed ? 'PASS' : 'FAIL'}; artifact: ${join(output, 'acceptance.json')}`);
  return report ? (passed ? 0 : 1) : 2;
}

try { process.exitCode = await main(); }
catch { console.error('Research acceptance failed during setup/execution. Check configuration, CLI availability and output permissions. No credentials were printed.'); process.exitCode = 2; }
