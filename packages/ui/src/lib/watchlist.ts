import { MAX_WATCHLIST_SYMBOLS, type Quote } from '@finagent/core';

export const WATCHLIST_SYMBOL_PATTERN = /^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/;
export function watchlistMarket(symbol: string): string {
  const suffix = symbol.split('.').at(-1) ?? '';
  return ['SH', 'SZ', 'HAS'].includes(suffix) ? 'CN' : suffix;
}
export function formatMarketPrice(value: number, symbol: string, currency?: string): string {
  const unit = currency || ({ US: 'USD', HK: 'HKD', CN: 'CNY', SG: 'SGD' } as Record<string, string>)[watchlistMarket(symbol)];
  const prefix = ({ USD: '$', HKD: 'HK$', CNY: '¥', SGD: 'S$' } as Record<string, string>)[unit ?? ''] ?? `${unit ?? ''} `;
  return `${prefix}${value.toFixed(2)}`;
}

export interface WatchlistImportRow { input: string; symbol: string; status: 'new' | 'existing' | 'duplicate' | 'invalid' | 'limit' }
/** Fully qualified codes only: ambiguous bare codes never silently change market. */
export function previewWatchlistImport(text: string, existing: readonly string[]): WatchlistImportRow[] {
  const seen = new Set<string>();
  let free = MAX_WATCHLIST_SYMBOLS - existing.length;
  return text.trim().split(/[\s,;，；]+/).filter(Boolean).map((input) => {
    const symbol = input.replace(/^["']|["']$/g, '').toUpperCase();
    let status: WatchlistImportRow['status'];
    if (!WATCHLIST_SYMBOL_PATTERN.test(symbol)) status = 'invalid';
    else if (seen.has(symbol)) status = 'duplicate';
    else if (existing.includes(symbol)) status = 'existing';
    else if (free <= 0) status = 'limit';
    else { status = 'new'; free--; }
    seen.add(symbol);
    return { input, symbol, status };
  });
}

/** Timestamp age is described neutrally: an old closing quote may be correct. */
export function quoteDisplayState(quote: Quote | null, error: string | null, now = Date.now()) {
  if (!quote) return error ? 'unavailable' : 'loading';
  if (quote.source === 'demo') return 'demo';
  if (error) return 'refreshFailed';
  if (quote.provenance?.stale) return 'stale';
  if (quote.provenance?.delayed) return 'delayed';
  if (!Number.isFinite(quote.timestamp) || quote.timestamp <= 0) return 'unknownTime';
  if (now - quote.timestamp * 1000 > 15 * 60 * 1000) return 'older';
  return 'available';
}
