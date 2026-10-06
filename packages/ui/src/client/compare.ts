import type { Comparison } from '@finagent/core';
import { unwrapIpcResult } from './unwrap';
import type { FinagentClient } from '../client';

/**
 * Defensive compare client. The channel (`window.electronAPI.compare.build`)
 * answers with the `{ ok, data | error }` envelope; the loader unwraps it and
 * degrades to `null` when the channel is absent or fails.
 */

interface CompareElectronApi {
  compare?: {
    build?: (symbols: string[]) => Promise<unknown>;
  };
}

export async function loadComparison(symbols: string[], client?: FinagentClient): Promise<Comparison | null> {
  try {
    const api = (window as { electronAPI?: CompareElectronApi }).electronAPI;
    const loader = client?.compare?.build ?? api?.compare?.build;
    if (typeof loader !== 'function') return null;
    return unwrapIpcResult<Comparison>(await loader(symbols));
  } catch {
    return null;
  }
}
