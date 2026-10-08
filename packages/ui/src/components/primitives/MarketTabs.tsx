import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { BilingualLabel } from './BilingualLabel';
export type StockMarket = 'CN' | 'HK' | 'US';
/** Same keyboard-accessible market control across discovery, watchlists and research. */
export function MarketTabs({ value, onChange, includeAll = false, includeSG = false, disabled = false }: { value: string; onChange: (value: string) => void; includeAll?: boolean; includeSG?: boolean; disabled?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const markets = [...(includeAll ? ['ALL'] : []), 'CN', 'HK', 'US', ...(includeSG ? ['SG'] : [])];
  return <div className="felix-market-tabs felix-stock-market-tabs" role="tablist" aria-label={t('navigation.marketTabs')}>
    {markets.map((market, index) => <button key={market} id={`${id}-${market}`} type="button" role="tab" disabled={disabled} aria-selected={market === value} tabIndex={market === value ? 0 : -1} aria-label={t(market === 'ALL' ? 'navigation.allMarkets' : `navigation.market${market}`)} onClick={() => onChange(market)} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = markets[event.key === 'Home' ? 0 : event.key === 'End' ? markets.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : markets.length - 1)) % markets.length]!;
      onChange(next); document.getElementById(`${id}-${next}`)?.focus();
    }}><BilingualLabel>{t(market === 'ALL' ? 'navigation.allMarkets' : `navigation.market${market}`)}</BilingualLabel></button>)}
  </div>;
}
