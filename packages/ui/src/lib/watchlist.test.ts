import { describe, expect, it } from 'bun:test';
import type { Quote } from '@finagent/core';
import { formatMarketPrice, previewWatchlistImport, quoteDisplayState } from './watchlist';

describe('watchlist imports', () => {
  it('normalizes codes and previews duplicates, existing records and ambiguous input separately', () => {
    const rows = previewWatchlistImport('aapl.us, 0700.hk\n0700.HK；600519.SH\n600519\nBAD', ['AAPL.US']);
    expect(rows.map((row) => row.status)).toEqual(['existing', 'new', 'duplicate', 'new', 'invalid', 'invalid']);
    expect(rows[1]!.symbol).toBe('0700.HK');
  });
  it('does not exceed remaining capacity or let invalid rows consume it', () => {
    const existing = Array.from({ length: 39 }, (_, index) => `S${index}.US`);
    expect(previewWatchlistImport('bad; AAPL.US; MSFT.US; AAPL.US', existing).map((row) => row.status)).toEqual(['invalid', 'new', 'limit', 'duplicate']);
  });
  it('formats the market currency and honors a known instrument currency', () => {
    expect(formatMarketPrice(20, '0700.HK')).toBe('HK$20.00');
    expect(formatMarketPrice(20, '600519.SH')).toBe('¥20.00');
    expect(formatMarketPrice(20, 'X.HK', 'USD')).toBe('$20.00');
  });
});

describe('quote disclosure', () => {
  const quote = { symbol: 'AAPL.US', timestamp: 1000 } as Quote;
  it('distinguishes sample data, failure with last quote, delayed data and old timestamps', () => {
    expect(quoteDisplayState({ ...quote, source: 'demo' }, 'offline')).toBe('demo');
    expect(quoteDisplayState(quote, 'offline')).toBe('refreshFailed');
    expect(quoteDisplayState({ ...quote, provenance: { providerId: 'massive', providerName: 'Massive', fetchedAt: 1000, stale: false, delayed: true } }, null)).toBe('delayed');
    expect(quoteDisplayState(quote, null, 1_000_000 + 16 * 60 * 1000)).toBe('older');
    expect(quoteDisplayState(quote, null, 1_000_000)).toBe('available');
    expect(quoteDisplayState(null, 'offline')).toBe('unavailable');
  });
});
