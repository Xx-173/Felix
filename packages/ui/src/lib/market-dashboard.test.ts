import { describe, expect, it } from 'bun:test';
import type { Quote } from '@finagent/core';
import { clampFloatingPosition, summarizeQuotes } from './market-dashboard';

const quote = (symbol: string, changePercent: number, source?: 'demo') => ({ symbol, changePercent, lastPrice: 100, ...(source ? { source } : {}) }) as Quote;
describe('market observation summaries', () => {
  it('scopes A shares across exchanges without including Hong Kong or US stocks', () => {
    const result = summarizeQuotes([quote('600519.SH', 4), quote('000001.SZ', -2), quote('AAPL.US', 8), quote('0700.HK', -9)], 'CN');
    expect(result.count).toBe(2);
    expect(result.average).toBe(1);
    expect(result.rising).toBe(1);
    expect(result.falling).toBe(1);
  });
  it('never merges samples into real market observations', () => {
    const result = summarizeQuotes([quote('AAPL.US', 2), quote('NVDA.US', 40, 'demo'), quote('BAD.US', NaN)]);
    expect(result.count).toBe(1);
    expect(result.average).toBe(2);
    expect(result.isDemo).toBe(false);
    expect(summarizeQuotes([quote('AAPL.US', 2, 'demo')]).isDemo).toBe(true);
  });
  it('keeps empty aggregates unknown and assigns threshold values to exactly one bin', () => {
    expect(summarizeQuotes([]).average).toBeNull();
    expect(summarizeQuotes([]).median).toBeNull();
    const result = summarizeQuotes([-5, -3, -1, 0, 1, 3, 5].map((value, index) => quote(`S${index}.US`, value)));
    expect(result.bins).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
    expect(result.median).toBe(0);
    expect(result.flat).toBe(1);
    expect(result.strong).toBe(2);
    expect(result.weak).toBe(2);
  });
});
it('keeps a saved floating button reachable after narrowing the viewport', () => {
  expect(clampFloatingPosition({ x: 1300, y: 900 }, 390, 844)).toEqual({ x: 326, y: 780 });
  expect(clampFloatingPosition({ x: -10, y: -10 }, 390, 844)).toEqual({ x: 8, y: 8 });
});
