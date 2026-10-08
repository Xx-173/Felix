import { describe, expect, it } from 'bun:test';
import { withDemoDataFallback } from './demo-market-data';
import type { MarketDataFetchers } from './market-data-service';

type DemoFetchers = Pick<MarketDataFetchers, 'getQuote' | 'getKline'>;

describe('built-in demo price history', () => {
  it('ends at the displayed quote and keeps consecutive prices coherent across a long history', async () => {
    const market = withDemoDataFallback({}) as DemoFetchers;
    for (const symbol of ['AAPL.US', 'NVDA.US', 'TSLA.US', '0700.HK', 'SPX.US', '000001.SH', 'HSI.HK']) {
      const quote = await market.getQuote(symbol);
      const bars = await market.getKline({ symbol, period: '1d', limit: 300 });
      expect(bars).toHaveLength(300);
      expect(bars.at(-1)).toMatchObject({ open: quote.open, high: quote.high, low: quote.low, close: quote.lastPrice, volume: quote.volume });
      expect(bars.at(-2)!.close).toBe(quote.prevClose);
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]!;
        expect(bar.low).toBeGreaterThan(0);
        expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
        expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
        if (i > 0) {
          expect(bar.timestamp - bars[i - 1]!.timestamp).toBe(86400);
          expect(Math.abs(bar.close / bars[i - 1]!.close - 1)).toBeLessThan(0.06);
        }
      }
    }
  });

  it('is deterministic and leaves live provider candles untouched', async () => {
    const fallback = withDemoDataFallback({}) as DemoFetchers;
    const request = { symbol: 'AAPL.US', period: '1d', limit: 30 } as const;
    expect(await fallback.getKline(request)).toEqual(await fallback.getKline(request));
    const liveBars = [{ symbol: 'AAPL.US', timestamp: 1700000000, open: 1, high: 2, low: 1, close: 2, volume: 30 }];
    const live = withDemoDataFallback<Pick<MarketDataFetchers, 'getKline'>>({ getKline: async () => liveBars });
    expect(await live.getKline(request)).toBe(liveBars);
  });
});
