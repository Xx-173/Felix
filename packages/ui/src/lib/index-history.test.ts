import { describe, expect, it } from 'bun:test';
import type { Kline } from '@finagent/core';
import { defaultIndexRange, filterIndexHistory, indexRangeBounds, prepareIndexHistory } from './index-history';

const row = (date: string, overrides: Partial<Kline> = {}): Kline => ({ symbol: '000001.SH', timestamp: Date.parse(date) / 1000, open: 100, high: 105, low: 95, close: 102, volume: 1000, ...overrides });
describe('index history', () => {
  it('keeps both boundary days and excludes the following day', () => {
    const { bars } = prepareIndexHistory([row('2026-10-01T00:00:00Z'), row('2026-10-02T23:59:59Z'), row('2026-10-03T00:00:00Z')], '000001.SH');
    expect(filterIndexHistory(bars, '2026-10-01', '2026-10-02')).toHaveLength(2);
    expect(indexRangeBounds('2026-10-03', '2026-10-01')).toBeNull();
    expect(indexRangeBounds('', '2026-10-01')).toBeNull();
    expect(indexRangeBounds('2026-02-30', '2026-03-01')).toBeNull();
    expect(indexRangeBounds('2028-02-29', '2028-02-29')).not.toBeNull();
  });
  it('rejects foreign symbols and invalid candles, and sorts unique dates', () => {
    const result = prepareIndexHistory([row('2026-10-02'), row('2026-10-01'), row('2026-10-01'), row('2026-10-03', { symbol: 'AAPL.US' }), row('2026-10-04', { close: NaN }), row('2026-10-05', { high: 90 })], '000001.SH');
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0]!.timestamp).toBeLessThan(result.bars[1]!.timestamp);
  });
  it('keeps sample candles separate from provider candles', () => {
    const demo = row('2026-10-01', { source: 'demo', providerName: 'Built-in sample' });
    const live = row('2026-10-02', { source: 'provider', providerName: 'Fixture' });
    expect(prepareIndexHistory([demo], '000001.SH').isDemo).toBe(true);
    const result = prepareIndexHistory([demo, live], '000001.SH');
    expect(result.bars).toHaveLength(1);
    expect(result.isDemo).toBe(false);
    expect(result.providers).toEqual(['Fixture']);
  });
  it('defaults to a six month interval', () => {
    expect(defaultIndexRange(new Date('2026-10-08T12:00:00Z'))).toEqual({ start: '2026-04-08', end: '2026-10-08' });
    expect(defaultIndexRange(new Date('2026-08-31T12:00:00Z'))).toEqual({ start: '2026-02-28', end: '2026-08-31' });
  });
});
