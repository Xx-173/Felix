import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useFinagentClient } from '../../client';
import { watchlistMarket, WATCHLIST_SYMBOL_PATTERN } from '../../lib/watchlist';

export function ResearchStockPicker({ market, symbols, onSelect, disabled }: { market: string; symbols: string[]; onSelect: (symbol: string) => void; disabled: boolean }) {
  const { t } = useTranslation(), client = useFinagentClient();
  const [query, setQuery] = useState(''), [error, setError] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const key = symbols.join(',');
  useEffect(() => {
    let alive = true;
    setQuery(''); setError(''); setNames({});
    void Promise.allSettled(symbols.map(async (symbol) => {
      try { const result = await client.market.getStaticInfo(symbol); if (alive && result.ok) setNames((current) => ({ ...current, [symbol]: result.data.name })); } catch { /* Code search remains available. */ }
    }));
    return () => { alive = false; };
  }, [client, market, key]);
  const matches = symbols.filter((symbol) => `${symbol} ${names[symbol] ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const select = (symbol: string) => { setError(''); onSelect(symbol); setQuery(''); };
  const submit = () => {
    const value = query.trim().toUpperCase();
    if (!WATCHLIST_SYMBOL_PATTERN.test(value)) {
      if (query.trim() && matches.length === 1) { select(matches[0]!); return; }
      setError(t('research.symbolEntry.invalid')); return;
    }
    if (watchlistMarket(value) !== market) { setError(t('research.marketMismatch')); return; }
    select(value);
  };
  return <section className="felix-research-picker" data-testid="research-stock-picker">
    <div className="felix-research-search-form"><Search size={16} /><input data-testid="research-symbol-input" aria-label={t('research.workspace.searchPlaceholder')} placeholder={t('research.symbolEntry.placeholder')} value={query} disabled={disabled} onChange={(event) => { setQuery(event.target.value); setError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} /><button type="button" data-testid="research-symbol-submit" disabled={disabled} onClick={submit}>{t('research.selectStock')}</button></div>
    <p>{t('research.selectHint')}</p>
    {error && <p role="alert" className="text-negative">{error}</p>}
    <div className="felix-research-symbol-chips">{matches.map((symbol) => <button key={symbol} type="button" disabled={disabled} onClick={() => select(symbol)}><strong>{names[symbol] ?? symbol}</strong>{names[symbol] && names[symbol] !== symbol && <code>{symbol}</code>}</button>)}</div>
  </section>;
}
