import type { Kline } from '@finagent/core';
import { normalizeKlines } from '../components/chart/klineAdapter';

export function defaultIndexRange(now = new Date()) {
  const start = new Date(now);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 6);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

export function indexRangeBounds(start: string, end: string) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 1000 : NaN;
  };
  const from = parse(start), to = parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && from <= to ? { from, until: to + 86400 } : null;
}

/** Use the requested index only; deduplicate and sort before rendering indicators. */
export function prepareIndexHistory(rows: Kline[], symbol: string) {
  const own = rows.filter((row) => row.symbol === symbol);
  const usable = own.some((row) => row.source !== 'demo') ? own.filter((row) => row.source !== 'demo') : own;
  const bars = normalizeKlines(usable).filter((bar) => bar.timestamp > 0 && bar.low > 0 && bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close));
  return {
    bars: [...new Map(bars.map((bar) => [bar.timestamp, bar])).values()].sort((a, b) => a.timestamp - b.timestamp),
    isDemo: usable.length > 0 && usable.every((row) => row.source === 'demo'),
    providers: [...new Set(usable.map((row) => row.providerName).filter((name): name is string => Boolean(name)))],
  };
}

export function filterIndexHistory(bars: ReturnType<typeof prepareIndexHistory>['bars'], start: string, end: string) {
  const bounds = indexRangeBounds(start, end);
  return bounds ? bars.filter((bar) => bar.timestamp >= bounds.from && bar.timestamp < bounds.until) : [];
}
