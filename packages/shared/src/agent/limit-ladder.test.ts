import { expect, test, spyOn } from 'bun:test';
import { parseLimitLadder, validateLadderDate } from './limit-ladder.ts';
import { MarketDataService } from './market-data-service.ts';

test('limit-up tiers use validated provider counts, prices and distinct A-share symbols', () => {
  const rows = [
    { c: '600825', n: 'Stock A', lbc: 7, p: 12300, zdp: 10.02, hybk: 'Media' },
    { c: '000678', n: 'Stock B', lbc: 4, p: 6200, zdp: 9.96, zbc: 1 },
    { c: '600825', n: 'Stock A', lbc: 7, p: 12300, zdp: 10.02 },
    { c: 'AAPL.US', n: 'Invalid', lbc: 9, p: 12000, zdp: 20 },
    { c: '000001', n: 'Invalid', lbc: 1.5, p: 12000, zdp: 10 },
    { c: '000002', n: 'Invalid', lbc: 0, p: 12000, zdp: 10 },
  ];
  const result = parseLimitLadder({ data: { pool: rows } }, '2026-10-08', 123);
  expect(result.source).toBe('eastmoney');
  expect(result.fetchedAt).toBe(123);
  expect(result.stocks.map((stock) => [stock.symbol, stock.boards, stock.price])).toEqual([['600825.SH', 7, 12.3], ['000678.SZ', 4, 6.2]]);
  expect(result.stocks[1]?.brokenCount).toBe(1);
});

test('missing provider data is unavailable, an actual empty pool is empty, malformed payloads never become zero stocks', () => {
  expect(() => parseLimitLadder({ data: null }, '2026-10-08')).toThrow('unavailable');
  expect(parseLimitLadder({ data: { pool: [] } }, '2026-10-08').stocks).toEqual([]);
  expect(() => parseLimitLadder({ data: { pool: [{ c: 'invalid' }] } }, '2026-10-08')).toThrow('format changed');
  for (const date of ['2026-02-29', '', '2026-10-08&url=x']) expect(() => validateLadderDate(date)).toThrow();
  expect(validateLadderDate('2024-02-29')).toBe('2024-02-29');
});

test('explicit online lookup uses a fixed provider, caches by mode and never masks failure with sample data', async () => {
  const spy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (url: Parameters<typeof fetch>[0]) => {
    expect(new URL(String(url)).hostname).toBe('push2ex.eastmoney.com');
    return new Response(JSON.stringify({ data: { pool: [{ c: '600825', n: 'Stock', lbc: 3, p: 12000, zdp: 10 }] } }));
  }, { preconnect: () => {} }));
  try {
    const service = new MarketDataService({ fetchers: { getLimitUpLadder: async (date) => ({ date, source: 'demo', stocks: [], fetchedAt: 1 }) } });
    expect((await service.getLimitUpLadder('2026-10-08')).source).toBe('demo');
    expect(spy).toHaveBeenCalledTimes(0);
    const results = await Promise.all([service.getLimitUpLadder('2026-10-08', 'live'), service.getLimitUpLadder('2026-10-08', 'live')]);
    expect(results.every((result) => result.source === 'eastmoney' && result.stocks[0]?.boards === 3)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockImplementation(Object.assign(async () => { throw new Error('Provider offline'); }, { preconnect: () => {} }));
    await expect(service.getLimitUpLadder('2026-10-07', 'live')).rejects.toThrow('Provider offline');
    expect(() => service.getLimitUpLadder('2026-02-29', 'live')).toThrow('Invalid ladder date');
    expect(spy).toHaveBeenCalledTimes(2);
  } finally { spy.mockRestore(); }
});
