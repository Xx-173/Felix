import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import { MarketDataService } from '../../../shared/src/agent/market-data-service';
import { withDemoDataFallback } from '../../../shared/src/agent/demo-market-data';
import { fallbackClient, type FinagentClient } from '../client';
import { demoQuote, demoPortfolioSnapshot } from '../demo/demoData';
import { fetchQuoteAtom, quoteCacheAtomFamily, watchlistAtom, watchlistHasDemoQuotesAtom } from './quoteAtoms';
import { fetchPortfolioAtom, portfolioCacheAtom } from './portfolioAtoms';

describe('sample provenance across the backend/renderer boundary', () => {
  it('keeps successful backend demo responses badged and clears the badge after recovery', async () => {
    let connected = false;
    const liveQuote = { ...demoQuote('AAPL.US')!, source: undefined };
    const livePortfolio = { ...demoPortfolioSnapshot(), source: undefined };
    const service = new MarketDataService({ fetchers: withDemoDataFallback({
      getQuote: async () => { if (!connected) throw new Error('offline'); return liveQuote; },
      getPortfolio: async () => { if (!connected) throw new Error('offline'); return livePortfolio; },
    }) });
    const client: FinagentClient = { ...fallbackClient, market: { ...fallbackClient.market,
      getQuote: async (symbol) => ({ ok: true, data: await service.getQuote(symbol) }),
      getPortfolio: async () => ({ ok: true, data: await service.getPortfolio() }),
    } };
    const store = createStore();
    await store.set(fetchQuoteAtom, { client, symbol: 'AAPL.US' });
    await store.set(fetchPortfolioAtom, client);
    expect(store.get(quoteCacheAtomFamily('AAPL.US')).isDemo).toBe(true);
    expect(store.get(portfolioCacheAtom).isDemo).toBe(true);
    expect(store.get(portfolioCacheAtom).data?.source).toBe('demo');

    connected = true;
    service.clear();
    await store.set(fetchQuoteAtom, { client, symbol: 'AAPL.US' });
    await store.set(fetchPortfolioAtom, client);
    expect(store.get(quoteCacheAtomFamily('AAPL.US')).isDemo).toBe(false);
    expect(store.get(portfolioCacheAtom).isDemo).toBe(false);
    expect(store.get(quoteCacheAtomFamily('AAPL.US')).data).toBe(liveQuote);
    expect(store.get(portfolioCacheAtom).data).toBe(livePortfolio);
  });

  it('discloses samples in a mixed watchlist', () => {
    const store = createStore();
    store.set(watchlistAtom, []);
    expect(store.get(watchlistHasDemoQuotesAtom)).toBe(false);
    store.set(watchlistAtom, ['AAPL.US', 'NVDA.US']);
    store.set(quoteCacheAtomFamily('AAPL.US'), {
      data: demoQuote('AAPL.US'), timestamp: 1, loading: false, error: null, isDemo: true,
    });
    store.set(quoteCacheAtomFamily('NVDA.US'), {
      data: { ...demoQuote('NVDA.US')!, source: undefined }, timestamp: 1, loading: false, error: null, isDemo: false,
    });
    expect(store.get(watchlistHasDemoQuotesAtom)).toBe(true);
  });
});
