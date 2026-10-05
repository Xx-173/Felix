import { describe, expect, it } from 'bun:test';
import type { ResearchReport } from '@finagent/core';
import { verifyReport } from './verify-report.ts';
import { createClaimVerifier, CLAIM_VERIFIER_VERSION, type ClaimVerifier, type ClaimVerificationInput } from './claim-verifier.ts';
import type { RunOutcome } from '../capabilities/executor.ts';
import { ResearchRunner } from './runner.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';
import { createCapabilityRegistry } from '../capabilities/index.ts';
import { fakeCap } from './test-helpers.ts';

const report: ResearchReport = {
  id: 'report-r1', symbol: 'AAPL.US', generatedAt: 1, summary: 'Price is 200.', stance: 'neutral', confidence: 0.6,
  sections: [{ key: 'market.quote', title: 'Quote', summary: 'Price is 200.', verdict: 'neutral', evidence: [] }],
  bullCase: ['Price will double because of demand.'], bearCase: [], catalysts: [], risks: [], capabilityRuns: [], runStatus: 'completed',
};
const sources: RunOutcome[] = [{
  record: { id: 'source-1', capabilityId: 'market.quote', startedAt: 1, finishedAt: 2, durationMs: 1, status: 'success' },
  result: { data: { lastPrice: 200 }, provenance: { provider: 'fixture', fetchedAt: 1, stale: false }, summary: 'Generated summaries are not evidence.' },
}];
const supported: ClaimVerifier = { async verify(input) {
  return { claimId: input.claimId, status: 'supported', evidenceIds: input.evidence.map((e) => e.id), reason: 'Directly supported.', verifierVersion: CLAIM_VERIFIER_VERSION };
} };

describe('research report claim verification', () => {
  it('does not claim support when a verifier is absent or the source failed', async () => {
    const unchecked = await verifyReport(report, sources);
    expect(unchecked.every((c) => c.status === 'not_checked')).toBe(true);
    const failed = await verifyReport(report, [{ ...sources[0], record: { ...sources[0].record, status: 'failed' } }], { verifier: supported });
    expect(failed.every((c) => c.status === 'insufficient_evidence')).toBe(true);
  });

  it('uses source data rather than synthesis and checks causal claims separately', async () => {
    const inputs: ClaimVerificationInput[] = [];
    const judge = createClaimVerifier({ provider: 'fixture', model: 'independent-judge', async complete(_system, user) {
      const input = JSON.parse(user);
      return JSON.stringify({ status: input.claim.includes('because') ? 'insufficient_evidence' : 'supported', reason: 'Source comparison.' });
    } });
    const verifier: ClaimVerifier = { async verify(input, signal) { inputs.push(input); return judge.verify(input, signal); } };
    const claims = await verifyReport(report, sources, { verifier });
    expect(claims.map((c) => c.status)).toEqual(['supported', 'supported', 'insufficient_evidence']);
    expect(inputs[0].evidence[0].content).toContain('"lastPrice":200');
    expect(inputs[0].evidence[0].content).not.toContain('Generated summaries');
    expect(claims[0].evidenceIds).toEqual(['source-1']);
  });

  it('keeps calls bounded and reuses durably saved claim results after recovery', async () => {
    let charged = 0;
    const claims = await verifyReport(report, sources, { verifier: supported, maxModelCalls: 1,
      beforeModelCall: async () => { charged += 1; } });
    expect(charged).toBe(1);
    expect(claims.map((c) => c.status)).toEqual(['supported', 'not_checked', 'not_checked']);
    let called = false;
    const recovered = await verifyReport(report, sources, { previous: claims,
      verifier: { async verify() { called = true; throw new Error('must not call'); } } });
    expect(recovered).toEqual(claims);
    expect(called).toBe(false);
  });

  it('rejects invented evidence ids and times out a verifier that ignores cancellation', async () => {
    const invalid = await verifyReport(report, sources, { verifier: { async verify(input) {
      return { claimId: input.claimId, status: 'supported', evidenceIds: ['invented'], reason: 'Wrong source.', verifierVersion: CLAIM_VERIFIER_VERSION };
    } } });
    expect(invalid.every((c) => c.status === 'insufficient_evidence')).toBe(true);
    const stalled = await verifyReport(report, sources, { verifier: { verify: () => new Promise(() => undefined) }, timeoutMs: 10 });
    expect(stalled.every((c) => c.status === 'insufficient_evidence')).toBe(true);
  });

  it('propagates user cancellation instead of publishing a verified report', async () => {
    const controller = new AbortController();
    const promise = verifyReport(report, sources, { signal: controller.signal, verifier: { verify: () => new Promise(() => undefined) } });
    controller.abort();
    await expect(promise).rejects.toThrow('Research cancelled');
  });

  it('attaches verification results to reports through the actual runner', async () => {
    const runner = new ResearchRunner({ registry: createCapabilityRegistry([fakeCap('market.quote')]),
      synthesizer: new LocalResearchSynthesizer(), claimVerifier: supported });
    const result = await runner.run({ symbol: 'NVDA.US', runId: 'r1' });
    expect(result.report?.claimVerification?.find((c) => c.claimId === 'section:market.quote')?.status).toBe('supported');
    expect(result.report?.claimVerification?.every((c) => c.evidenceIds.every((id) =>
      result.report!.capabilityRuns.some((r) => r.runId === id)))).toBe(true);
  });
});
