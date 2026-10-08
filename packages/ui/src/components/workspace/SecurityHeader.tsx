import React, { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { StaticInfo, MarketStatus } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom, quoteCacheAtomFamily, fetchQuoteAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { QuoteStatus } from '../stock/QuoteStatus';
import { formatMarketPrice } from '../../lib/watchlist';
const DASH = '\u2014';

const formatNumber = (value: number): string => value.toLocaleString();
const formatSigned = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

interface StatCellProps {
  label: string;
  value: string;
}

const StatCell: React.FC<StatCellProps> = ({ label, value }) => (
  <div className="min-w-0 border-l border-[var(--mac-border)] pl-3 first:border-l-0 first:pl-0">
    <div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/42">
      <BilingualLabel>{label}</BilingualLabel>
    </div>
    <div className="mt-1 truncate text-[12px] font-medium tabular-nums text-foreground/80">{value}</div>
  </div>
);

export const SecurityHeader: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const cache = useAtomValue(quoteCacheAtomFamily(symbol ?? ''));
  const fetchQuote = useSetAtom(fetchQuoteAtom);
  const quote = cache.data;
  const loading = cache.loading && !quote;
  const error = cache.error;
  const [info, setInfo] = useState<StaticInfo | null>(null);
  const [marketStatus, setMarketStatus] = useState<string | null>(null);

  useEffect(() => {
    setInfo(null); setMarketStatus(null);
    if (!symbol) return;
    let cancelled = false;
    void fetchQuote({ client, symbol });
    const interval = setInterval(() => void fetchQuote({ client, symbol }), 30000);
    void client.market.getStaticInfo(symbol).then((result) => { if (!cancelled && result.ok) setInfo(result.data); }).catch(() => undefined);
    const suffix = symbol.split(".").pop()?.toUpperCase();
    void client.market.getMarketStatus().then((result) => {
      if (!cancelled && result.ok) setMarketStatus(result.data.find((item: MarketStatus) => item.market.toUpperCase() === suffix)?.status ?? null);
    }).catch(() => undefined);
    return () => { cancelled = true; clearInterval(interval); };
  }, [client, symbol, fetchQuote]);

  if (!symbol) return null;

  if (error && !quote) {
    return (
      <div className="felix-security-header">
        <div
          className="text-[13px] font-semibold uppercase tracking-wide text-foreground/72"
          data-testid="security-header-symbol"
        >
          {symbol}
        </div>
        <div className="mt-1 text-[12px] text-foreground/54">
          {t('security.header.quoteUnavailable', { error })}
        </div>
      </div>
    );
  }

  if (loading || !quote) {
    return (
      <div className="felix-security-header">
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 animate-pulse rounded bg-foreground/10" />
          <div className="h-4 w-12 animate-pulse rounded bg-foreground/8" />
        </div>
        <div className="mt-2 h-8 w-40 animate-pulse rounded bg-foreground/10" />
      </div>
    );
  }

  const formatPrice = (value: number) => formatMarketPrice(value, symbol, info?.currency);
  const isPositive = quote.change >= 0;
  const changeColor = isPositive ? 'var(--positive)' : 'var(--negative)';
  const name = info?.name ?? symbol;

  const stats: StatCellProps[] = [
    { label: t('security.header.open'), value: formatPrice(quote.open) },
    { label: t('security.header.high'), value: formatPrice(quote.high) },
    { label: t('security.header.low'), value: formatPrice(quote.low) },
    { label: t('security.header.prevClose'), value: formatPrice(quote.prevClose) },
    { label: t('security.header.volume'), value: formatNumber(quote.volume) },
    { label: t('security.header.turnover'), value: DASH },
    { label: t('security.header.marketStatus'), value: marketStatus ?? DASH },
  ];

  return (
    <div className="felix-security-header">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-[15px] font-semibold text-foreground">{name}</div>
            <span
              className="rounded-full bg-[var(--mac-blue-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--mac-blue)]"
              data-testid="security-header-symbol"
            >
              {quote.symbol}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/42">
            {marketStatus ?? t('security.header.marketStatus')}
          </div>
        </div>

        <div className="flex items-end justify-between gap-5 lg:justify-end">
          <div className="flex flex-col items-start lg:items-end">
          <div
            className="text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-foreground"
          >
            {formatPrice(quote.lastPrice)}
          </div>
          <div
            className="mt-1 text-[13px] tabular-nums"
            style={{ color: changeColor }}
          >
            {formatSigned(quote.change)} ({formatPercent(quote.changePercent)})
          </div>
          <QuoteStatus quote={quote} error={error} />
          </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNavSection('research')}
            className="rounded-[9px] bg-[#0052ff] px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#0047d9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052ff]/40 active:scale-[0.98]"
            data-testid="deep-research-button"
          >
            {t('security.header.deepResearch')}
          </button>
        </div>
        </div>
      </div>
      <div className="felix-security-stats mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--mac-border)] pt-3 sm:grid-cols-4 xl:grid-cols-7">
        {stats.map((stat) => (
          <StatCell key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>
    </div>
  );
};
