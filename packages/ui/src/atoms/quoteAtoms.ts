import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { MAX_WATCHLIST_SYMBOLS, type Quote, type WatchlistGroup } from '@finagent/core';
import type { FinagentClient } from '../client';
import { demoQuote, hasDemoQuote } from '../demo/demoData';

const CACHE_TTL = 30 * 1000; // 30 seconds

interface QuoteCache {
  data: Quote | null;
  timestamp: number;
  loading: boolean;
  error: string | null;
  /** True when `data` is built-in sample data (no live provider available). */
  isDemo: boolean;
}

// Quote cache atom family
export const quoteCacheAtomFamily = atomFamily((symbol: string) =>
  atom<QuoteCache>({
    data: null,
    timestamp: 0,
    loading: false,
    error: null,
    isDemo: false,
  })
);

// Watchlist atoms
export const watchlistAtom = atom<string[]>(['AAPL.US', 'TSLA.US', 'NVDA.US']);
export const watchlistGroupsAtom = atom<WatchlistGroup[]>([]);

/** Newest quote timestamp (epoch seconds) across the watchlist, for the §34 freshness line. */
export const watchlistLatestTimestampAtom = atom<number | undefined>((get) => {
  const watchlist = get(watchlistAtom);
  let latest: number | undefined;
  for (const symbol of watchlist) {
    const cache = get(quoteCacheAtomFamily(symbol));
    const ts = cache.data?.timestamp;
    if (ts && (!latest || ts > latest)) latest = ts;
  }
  return latest;
});

// Add symbol to watchlist
export const addToWatchlistAtom = atom(
  null,
  (_get, set, symbol: string) => {
    set(watchlistAtom, (list) => {
      if (list.includes(symbol) || list.length >= MAX_WATCHLIST_SYMBOLS) return list;
      return [...list, symbol];
    });
  }
);

// Remove symbol from watchlist
export const removeFromWatchlistAtom = atom(
  null,
  (_get, set, symbol: string) => {
    set(watchlistAtom, (list) => list.filter((s) => s !== symbol));
    set(watchlistGroupsAtom, (groups) => groups.map((group) => ({ ...group, symbols: group.symbols.filter((s) => s !== symbol) })));
  }
);

// Fetch quote action
export const fetchQuoteAtom = atom(
  null,
  async (_get, set, input: { client: FinagentClient; symbol: string }) => {
    const { client, symbol } = input;
    if (_get(quoteCacheAtomFamily(symbol)).loading) return null;
    // Set loading state
    set(quoteCacheAtomFamily(symbol), (cache) => ({
      ...cache,
      loading: true,
      error: null,
    }));

    try {
      const result = await client.market.getQuote(symbol);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      const quote = result.data;

      set(quoteCacheAtomFamily(symbol), {
        data: quote,
        timestamp: Date.now(),
        loading: false,
        error: null,
        isDemo: quote.source === 'demo',
      });

      return quote;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch quote';
      // No live provider available: fall back to built-in sample data when we
      // have it, so the UI shows a populated (clearly badged) default instead
      // of an empty state. Unknown symbols keep the honest error path.
      const cached = _get(quoteCacheAtomFamily(symbol));
      // Preserve the last genuine quote on transient errors. Never replace a
      // user's real quote with a sample price merely because refresh failed.
      const previous = cached.data && !cached.isDemo ? cached.data : null;
      const demo = !previous && hasDemoQuote(symbol) ? demoQuote(symbol) : null;
      set(quoteCacheAtomFamily(symbol), (cache) => ({
        ...cache,
        data: previous ?? demo,
        isDemo: demo != null,
        timestamp: demo != null ? Date.now() : cache.timestamp,
        loading: false,
        error: errorMessage,
      }));
      return null;
    }
  }
);

// Check if quote cache is stale
export const isQuoteStaleAtom = atomFamily((symbol: string) =>
  atom((get) => {
    const cache = get(quoteCacheAtomFamily(symbol));
    if (!cache.data) return true;
    return Date.now() - cache.timestamp > CACHE_TTL;
  })
);

/**
 * True when every watchlist symbol currently renders sample data (the live
 * provider was unavailable for all of them). Drives the `DemoBadge` on the
 * watchlist/movers surfaces. Empty watchlist → false (nothing is demo).
 */
export const watchlistQuotesAreDemoAtom = atom<boolean>((get) => {
  const watchlist = get(watchlistAtom);
  if (watchlist.length === 0) return false;
  return watchlist.every((symbol) => {
    const cache = get(quoteCacheAtomFamily(symbol));
    return cache.data != null && cache.isDemo;
  });
});

/** Mixed watchlists still need to disclose the sample values they contain. */
export const watchlistHasDemoQuotesAtom = atom<boolean>((get) =>
  get(watchlistAtom).some((symbol) => {
    const cache = get(quoteCacheAtomFamily(symbol));
    return cache.data != null && cache.isDemo;
  })
);
