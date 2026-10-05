import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ResearchReport } from '@finagent/core';
import { installHappyDom } from '../../test/setupHappyDom';
import { TestI18n } from '../../test/testI18n';

let restore: () => void;
let ClaimVerification: typeof import('./ClaimVerification')['ClaimVerification'];
beforeAll(async () => { restore = installHappyDom().restore; ({ ClaimVerification } = await import('./ClaimVerification')); });
afterAll(() => restore());

it('shows unsupported and unchecked claims separately and treats legacy reports as unverified', async () => {
  const report: ResearchReport = { id: 'r1', symbol: 'AAPL.US', generatedAt: 1, summary: 'Research', stance: 'neutral',
    confidence: 0.8, sections: [], bullCase: [], bearCase: [], catalysts: [], risks: [], capabilityRuns: [], runStatus: 'completed',
    claimVerification: ['supported', 'contradicted', 'insufficient_evidence', 'not_checked'].map((status, i) => ({
      claimId: String(i), claimText: `Claim ${i}`, status: status as 'supported' | 'contradicted' | 'insufficient_evidence' | 'not_checked',
      evidenceIds: [], reason: '', verifierVersion: 'test',
    })),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TestI18n><ClaimVerification report={report} /></TestI18n>));
    expect(container.textContent).toContain('1 of 4 claims supported');
    expect(container.querySelectorAll('[data-verification-status]')).toHaveLength(4);
    expect(container.textContent).toContain('not a calibrated probability');
    await act(async () => root.render(<TestI18n><ClaimVerification report={{ ...report, claimVerification: undefined }} /></TestI18n>));
    expect(container.textContent).toContain('have not been verified');
    expect(container.textContent).not.toContain('claims supported');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
