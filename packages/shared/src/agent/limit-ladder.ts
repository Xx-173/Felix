import type { LimitLadderSnapshot, LimitLadderStock } from '@finagent/core';

export function validateLadderDate(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('Invalid ladder date');
  return date;
}

/** Upstream supplies the actual consecutive-limit count; never infer it from a 10% gain. */
export function parseLimitLadder(payload: unknown, date: string, now = Date.now()): LimitLadderSnapshot {
  validateLadderDate(date);
  const data = (payload as { data?: { pool?: unknown } } | null)?.data;
  if (!data || !Array.isArray(data.pool)) throw new Error('涨停股池在此日期不可用（Limit-up pool unavailable for this date）。');
  const stocks = new Map<string, LimitLadderStock>();
  for (const value of data.pool.slice(0, 2000)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const code = typeof row.c === 'string' ? row.c : '';
    if (!/^\d{6}$/.test(code) || !/^[036]/.test(code) || typeof row.n !== 'string' || !row.n.trim()) continue;
    if (typeof row.lbc !== 'number' || !Number.isInteger(row.lbc) || row.lbc < 1 || row.lbc > 100 || typeof row.p !== 'number' || !Number.isFinite(row.p) || row.p <= 0 || typeof row.zdp !== 'number' || !Number.isFinite(row.zdp)) continue;
    const symbol = `${code}.${code.startsWith('6') ? 'SH' : 'SZ'}`;
    stocks.set(symbol, { symbol, name: row.n.slice(0, 100), boards: row.lbc, price: row.p / 1000, changePercent: row.zdp, ...(typeof row.hybk === 'string' ? { industry: row.hybk.slice(0, 100) } : {}), ...(typeof row.zbc === 'number' && Number.isInteger(row.zbc) && row.zbc >= 0 ? { brokenCount: row.zbc } : {}) });
  }
  if (data.pool.length && !stocks.size) throw new Error('涨停股池格式已变化（Limit-up pool format changed）。');
  return { date, fetchedAt: now, source: 'eastmoney', stocks: [...stocks.values()].sort((a, b) => b.boards - a.boards || a.symbol.localeCompare(b.symbol)) };
}

export async function fetchLimitLadder(date: string): Promise<LimitLadderSnapshot> {
  validateLadderDate(date);
  const url = new URL('https://push2ex.eastmoney.com/getTopicZTPool');
  url.search = new URLSearchParams({ ut: '7eea3edcaed734bea9cbfc24409ed989', dpt: 'wz.ztzt', Pageindex: '0', pagesize: '2000', sort: 'fbt:asc', date: date.replaceAll('-', '') }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new Error(`涨停数据请求失败（Limit-up request failed）：HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error('Limit-up response too large');
  return parseLimitLadder(JSON.parse(body), date);
}
