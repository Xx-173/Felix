import type { Quote } from '@finagent/core';
import { watchlistMarket } from './watchlist';

export type DashboardMarket = 'CN' | 'HK' | 'US';
export const DASHBOARD_INDICES: Record<DashboardMarket, { symbol: string; key: string }[]> = {
  CN: [{ symbol: '000001.SH', key: 'indexShanghai' }, { symbol: '399001.SZ', key: 'indexShenzhen' }, { symbol: '399006.SZ', key: 'indexChinext' }, { symbol: '000680.SH', key: 'indexStar' }],
  HK: [{ symbol: 'HSI.HK', key: 'indexHangSeng' }, { symbol: 'HSTECH.HK', key: 'indexHangSengTech' }, { symbol: 'HSCEI.HK', key: 'indexChinaEnterprises' }],
  US: [{ symbol: 'SPX.US', key: 'indexSP500' }, { symbol: 'NDX.US', key: 'indexNasdaq100' }, { symbol: 'DJI.US', key: 'indexDow' }, { symbol: 'RUT.US', key: 'indexRussell' }],
};
export const CHANGE_BUCKETS = [Number.NEGATIVE_INFINITY, -5, -3, -1, 0, 1, 3, 5, Number.POSITIVE_INFINITY];
export const CHANGE_BUCKET_LABELS = ['< −5%', '−5 ~ −3%', '−3 ~ −1%', '−1 ~ 0%', '0 ~ 1%', '1 ~ 3%', '3 ~ 5%', '≥ 5%'];

/** Sample quotes never dilute real observations. Counts describe ONLY the supplied universe. */
export function summarizeQuotes(quotes: readonly Quote[], market?: DashboardMarket) {
  const valid = quotes.filter((quote) => (!market || watchlistMarket(quote.symbol) === market)
    && Number.isFinite(quote.changePercent) && Number.isFinite(quote.lastPrice) && quote.lastPrice > 0);
  const real = valid.filter((quote) => quote.source !== 'demo');
  const observations = real.length ? real : valid;
  const changes = observations.map((quote) => quote.changePercent).sort((a, b) => a - b);
  const count = changes.length;
  const rising = changes.filter((change) => change > 0).length;
  const falling = changes.filter((change) => change < 0).length;
  const bins = CHANGE_BUCKET_LABELS.map((_, index) => changes.filter((change) => change >= CHANGE_BUCKETS[index]! && change < CHANGE_BUCKETS[index + 1]!).length);
  const middle = Math.floor(count / 2);
  return {
    observations, count, rising, falling, flat: count - rising - falling, bins,
    isDemo: count > 0 && real.length === 0,
    average: count ? changes.reduce((sum, value) => sum + value, 0) / count : null,
    median: count ? count % 2 ? changes[middle]! : (changes[middle - 1]! + changes[middle]!) / 2 : null,
    risingRatio: count ? rising / count * 100 : null,
    strong: changes.filter((change) => change >= 3).length,
    weak: changes.filter((change) => change <= -3).length,
  };
}

export function clampFloatingPosition(position: { x: number; y: number }, width: number, height: number) {
  return { x: Math.max(8, Math.min(position.x, Math.max(8, width - 64))), y: Math.max(8, Math.min(position.y, Math.max(8, height - 64))) };
}
