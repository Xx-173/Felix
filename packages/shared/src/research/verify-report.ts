import type { ResearchClaimVerification, ResearchReport } from '@finagent/core';
import type { RunOutcome } from '../capabilities/executor.ts';
import { createCodeError } from '../agent/errors.ts';
import type { ClaimVerifier } from './claim-verifier.ts';

export const REPORT_VERIFIER_VERSION = 'research-claims/v1';
export interface ReportVerificationOptions {
  verifier?: ClaimVerifier;
  previous?: ResearchClaimVerification[];
  signal?: AbortSignal;
  maxModelCalls?: number;
  timeoutMs?: number;
  beforeModelCall?: () => Promise<void>;
  onClaim?: (claim: ResearchClaimVerification) => Promise<void>;
}

/** Source snapshots are capability results, never generated summaries/reasons. */
export async function verifyReport(
  report: ResearchReport,
  outcomes: RunOutcome[],
  options: ReportVerificationOptions = {},
): Promise<ResearchClaimVerification[]> {
  const sources = outcomes.filter((o) => o.record.status === 'success' && o.result).map((o) => ({
    id: o.record.id,
    capabilityId: o.record.capabilityId,
    content: JSON.stringify({ capabilityId: o.record.capabilityId, provenance: o.result!.provenance, data: o.result!.data }),
  }));
  const claims = [
    { claimId: 'summary', claimText: report.summary, sources },
    ...report.sections.map((s) => ({ claimId: `section:${s.key}`, claimText: s.summary,
      sources: sources.filter((source) => source.capabilityId === s.key) })),
    ...(['bullCase', 'bearCase', 'catalysts', 'risks'] as const).flatMap((key) =>
      report[key].map((claimText, index) => ({ claimId: `${key}:${index}`, claimText, sources }))),
  ].filter((claim) => claim.claimText.trim());
  const results: ResearchClaimVerification[] = [];
  let calls = 0;
  for (const claim of claims) {
    if (options.signal?.aborted) throw createCodeError('RESEARCH_CANCELLED', 'Research cancelled.');
    const saved = options.previous?.find((p) => p.claimId === claim.claimId && p.claimText === claim.claimText);
    if (saved) { results.push(saved); continue; }
    let result: ResearchClaimVerification = {
      claimId: claim.claimId, claimText: claim.claimText, evidenceIds: [],
      status: 'not_checked', reason: 'No claim verifier configured.', verifierVersion: REPORT_VERIFIER_VERSION,
    };
    if (claim.sources.length === 0) {
      result = { ...result, status: 'insufficient_evidence', reason: 'No successful source result exists for this claim.' };
    } else if (options.verifier && calls >= (options.maxModelCalls ?? 12)) {
      result.reason = 'Report verification call limit reached.';
    } else if (options.verifier) {
      // Charge durably before dispatch; a crash never refunds an attempted call.
      await options.beforeModelCall?.();
      calls += 1;
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let onAbort: () => void = () => undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Verification interrupted.'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      try {
        const checked = await Promise.race([options.verifier.verify({
          claimId: claim.claimId, claimText: claim.claimText,
          evidence: claim.sources.map(({ id, content }) => ({ id, content })),
        }, signal), aborted]);
        const validIds = new Set(claim.sources.map((source) => source.id));
        const valid = checked.claimId === claim.claimId &&
          ['supported', 'contradicted', 'insufficient_evidence'].includes(checked.status) &&
          checked.evidenceIds.every((id) => validIds.has(id)) &&
          (checked.status === 'insufficient_evidence' || checked.evidenceIds.length > 0);
        result = valid ? { ...checked, claimText: claim.claimText } : {
          ...result, status: 'insufficient_evidence', reason: 'Verifier returned an invalid claim or source reference.',
        };
      } catch {
        result = { ...result, status: 'insufficient_evidence', reason: 'Claim verification failed or timed out.' };
      } finally { signal.removeEventListener('abort', onAbort); }
      if (options.signal?.aborted) throw createCodeError('RESEARCH_CANCELLED', 'Research cancelled.');
    }
    await options.onClaim?.(result);
    results.push(result);
  }
  return results;
}
