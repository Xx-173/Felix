import type { FinagentClient } from '../client';
import type { InvestmentThesis, ResearchReport, ThesisImpact } from '@finagent/core';
import { unwrapIpcResult } from './unwrap';

/**
 * Defensive thesis client. The channel (`window.electronAPI.thesis.*`) answers
 * with the `{ ok, data | error }` envelope; every loader unwraps it and
 * degrades to an empty/null result so the panels render their graceful
 * "no thesis"/"no report" states instead of crashing.
 */

interface ThesisElectronApi {
  thesis?: {
    list?: (symbol?: string) => Promise<unknown>;
    getReport?: (symbol: string) => Promise<unknown>;
    saveFromReport?: (symbol: string) => Promise<unknown>;
    reEvaluate?: (symbol: string) => Promise<unknown>;
    update?: (thesis: InvestmentThesis) => Promise<unknown>;
    listImpacts?: (symbol: string) => Promise<unknown>;
  };
}

function thesisApi(client?: FinagentClient): ThesisElectronApi['thesis'] | undefined {
  if (client) return client.thesis;
  return (window as { electronAPI?: ThesisElectronApi }).electronAPI?.thesis;
}

export async function loadTheses(symbol?: string, client?: FinagentClient): Promise<InvestmentThesis[]> {
  try {
    const loader = thesisApi(client)?.list;
    if (typeof loader !== 'function') return [];
    return unwrapIpcResult<InvestmentThesis[]>(await loader(symbol)) ?? [];
  } catch {
    return [];
  }
}

export async function loadResearchReport(symbol: string, client?: FinagentClient): Promise<ResearchReport | null> {
  try {
    const loader = thesisApi(client)?.getReport;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<ResearchReport | null>(await loader(symbol));
  } catch {
    return null;
  }
}

export async function saveThesisFromReport(symbol: string, client?: FinagentClient): Promise<InvestmentThesis | null> {
  try {
    const loader = thesisApi(client)?.saveFromReport;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<InvestmentThesis>(await loader(symbol));
  } catch {
    return null;
  }
}

export async function reEvaluateThesis(symbol: string, client?: FinagentClient): Promise<ThesisImpact | null> {
  try {
    const loader = thesisApi(client)?.reEvaluate;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<ThesisImpact>(await loader(symbol));
  } catch {
    return null;
  }
}

export async function updateThesis(thesis: InvestmentThesis, client?: FinagentClient): Promise<InvestmentThesis | null> {
  try {
    const loader = thesisApi(client)?.update;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<InvestmentThesis>(await loader(thesis));
  } catch {
    return null;
  }
}

export async function loadImpacts(symbol: string, client?: FinagentClient): Promise<ThesisImpact[]> {
  try {
    const loader = thesisApi(client)?.listImpacts;
    if (typeof loader !== 'function') return [];
    return unwrapIpcResult<ThesisImpact[]>(await loader(symbol)) ?? [];
  } catch {
    return [];
  }
}
