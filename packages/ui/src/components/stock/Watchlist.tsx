import React, { useEffect, useReducer, useRef } from 'react';
import { CirclePlus, Search, X } from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  watchlistAtom,
  quoteCacheAtomFamily,
  watchlistLatestTimestampAtom,
  watchlistQuotesAreDemoAtom,
  watchlistHasDemoQuotesAtom,
  fetchQuoteAtom,
  addToWatchlistAtom,
  removeFromWatchlistAtom,
  activeSymbolAtom,
  activeViewAtom,
  navSectionAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { Input } from '../primitives/Input';
import { Button } from '../primitives/Button';
import { DataFreshness } from '../primitives/DataFreshness';
import { DemoBadge } from '../primitives/DemoBadge';
import { BilingualLabel } from '../primitives/BilingualLabel';

const SYMBOL_REGEX = /^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/;
const DASH = '\u2014';

const marketOf = (symbol: string): string => {
  const suffix = symbol.split('.').at(-1) ?? '';
  return ['SH', 'SZ', 'HAS'].includes(suffix) ? 'CN' : suffix;
};
const formatPrice = (value: number, symbol: string): string =>
  `${({ US: '$', HK: 'HK$', CN: '¥', SG: 'S$' } as Record<string, string>)[marketOf(symbol)] ?? ''}${value.toFixed(2)}`;
const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export const Watchlist: React.FC<{ showHeader?: boolean; fullPage?: boolean }> = ({ showHeader = true, fullPage = false }) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const watchlist = useAtomValue(watchlistAtom);
  const addSymbol = useSetAtom(addToWatchlistAtom);
  const removeSymbol = useSetAtom(removeFromWatchlistAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setActiveView = useSetAtom(activeViewAtom);
  const activeSymbol = useAtomValue(activeSymbolAtom);
  const setSection = useSetAtom(navSectionAtom);
  const [query, setQuery] = React.useState('');
  const [market, setMarket] = React.useState('ALL');
  const [sort, setSort] = React.useState('added');
  const latestTimestamp = useAtomValue(watchlistLatestTimestampAtom);
  const quotesAreDemo = useAtomValue(watchlistQuotesAreDemoAtom);
  const hasDemoQuotes = useAtomValue(watchlistHasDemoQuotesAtom);

  const [newSymbol, setNewSymbol] = React.useState('');
  const [error, setError] = React.useState('');

  // Local static-info name cache: symbol -> display name.
  const nameCache = useRef(new Map<string, string>());
  const inflight = useRef(new Set<string>());
  const [, force] = useReducer((x: number) => x + 1, 0);

  const resolveName = (symbol: string): string => {
    const cached = nameCache.current.get(symbol);
    if (cached !== undefined) return cached;
    if (!inflight.current.has(symbol)) {
      inflight.current.add(symbol);
      client.market
        .getStaticInfo(symbol)
        .then((res) => {
          nameCache.current.set(
            symbol,
            res.ok && res.data.name ? res.data.name : symbol
          );
        })
        .catch(() => {
          nameCache.current.set(symbol, symbol);
        })
        .finally(() => {
          inflight.current.delete(symbol);
          force();
        });
    }
    return symbol;
  };

  const handleAddSymbol = () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;

    if (!SYMBOL_REGEX.test(symbol)) {
      setError(t('navigation.watchlistInvalid'));
      return;
    }

    if (watchlist.includes(symbol)) {
      setError(t('navigation.watchlistDuplicate'));
      return;
    }

    addSymbol(symbol);
    setQuery('');
    setMarket('ALL');
    setNewSymbol('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddSymbol();
    }
  };

  const visible = watchlist.filter((symbol) => (market === 'ALL' || marketOf(symbol) === market)
    && (symbol + ' ' + (nameCache.current.get(symbol) ?? '')).toLowerCase().includes(query.trim().toLowerCase()));
  const ordered = sort === 'symbol' ? [...watchlist].sort() : watchlist;

  return (
    <div className={`felix-watchlist flex flex-col ${fullPage ? 'felix-watchlist-page' : 'h-full'}`}>
      <div className="felix-watchlist-header border-b mac-section-divider px-3 py-3">
        {showHeader && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-0.5">
            <span className="text-[11px] font-semibold uppercase text-foreground/42">
              {t('navigation.watchlist')}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              {hasDemoQuotes && <DemoBadge />}
              <DataFreshness
                providerName={quotesAreDemo ? t('demo.badge') : 'Longbridge'}
                updatedAtMs={
                  latestTimestamp ? latestTimestamp * 1000 : undefined
                }
                className="min-w-0 text-right leading-tight"
              />
            </span>
          </div>
        )}
        <div className="felix-watchlist-add flex gap-1.5">
          <Input
            value={newSymbol}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setNewSymbol(e.target.value.toUpperCase());
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder="AAPL.US"
            aria-label={t('navigation.watchlistAddSymbol')}
            error={error}
            className="h-8 flex-1 text-[12px]"
          />
          <Button size={fullPage ? 'sm' : 'icon'} onClick={handleAddSymbol} aria-label={t('navigation.watchlistAddSymbol')}>
            <CirclePlus className="h-4 w-4" strokeWidth={1.8} />
            {fullPage && <span>{t('navigation.watchlistAddSymbol')}</span>}
          </Button>
        </div>
      </div>

      {fullPage && <div className="felix-hub-toolbar">
        <label className="felix-hub-search"><Search size={16} /><input aria-label={t('navigation.watchlistSearch')} placeholder={t('navigation.watchlistSearch')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label={t('navigation.marketFilter')} value={market} onChange={(event) => setMarket(event.target.value)}>
          <option value="ALL">{t('navigation.allMarkets')}</option>
          {['US', 'HK', 'CN', 'SG'].map((value) => <option key={value} value={value}>{t('navigation.market' + value)}</option>)}
        </select>
        <select aria-label={t('navigation.symbolSort')} value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="added">{t('navigation.addedOrder')}</option><option value="symbol">{t('navigation.alphabetical')}</option>
        </select>
      </div>}
      {fullPage && <div className="felix-watchlist-columns" aria-hidden="true">
        {['symbolColumn', 'marketColumn', 'priceColumn', 'changeColumn', 'actionsColumn'].map((key) => <span key={key}><BilingualLabel stacked>{t('navigation.' + key)}</BilingualLabel></span>)}
      </div>}
      <div className="felix-watchlist-list flex-1 p-1.5">
        {/* Hidden rows still resolve names and refresh quotes for accurate search. */}
        {ordered.map((symbol) => (
          <WatchlistRow
            key={symbol}
            fullPage={fullPage}
            hidden={!visible.includes(symbol)}
            symbol={symbol}
            name={resolveName(symbol)}
            active={symbol === activeSymbol}
            onSelect={() => {
              setActiveSymbol(symbol);
              setActiveView('overview');
              if (fullPage) setSection('watchlist');
            }}
            onRemove={() => removeSymbol(symbol)}
          />
        ))}
        {watchlist.length > 0 && visible.length === 0 && <div className="felix-hub-empty">{t('navigation.noMatches')}</div>}
        {watchlist.length === 0 && (
          <div className="py-8 text-center text-[13px] text-foreground/44">
            <p>{t('navigation.watchlistEmpty')}</p>
            <p className="mt-1">{t('navigation.watchlistAddSymbols')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface WatchlistRowProps {
  fullPage: boolean;
  hidden: boolean;
  symbol: string;
  name: string;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

const WatchlistRow: React.FC<WatchlistRowProps> = ({
  symbol,
  fullPage,
  hidden,
  name,
  active,
  onSelect,
  onRemove,
}) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const cache = useAtomValue(quoteCacheAtomFamily(symbol));
  const fetchQuote = useSetAtom(fetchQuoteAtom);

  useEffect(() => {
    fetchQuote({ client, symbol });
    const interval = setInterval(() => fetchQuote({ client, symbol }), 30000);
    return () => clearInterval(interval);
  }, [client, symbol, fetchQuote]);

  const quote = cache.data;
  const loading = !quote && !cache.error;
  const changeColor = quote
    ? quote.change >= 0
      ? 'var(--positive)'
      : 'var(--negative)'
    : undefined;

  return (
    <div hidden={hidden} className={`felix-watchlist-row group ${active ? 'felix-watchlist-row--active' : ''}`}>
      <button type="button" aria-label={symbol} data-testid={`watchlist-row-${symbol}`} onClick={onSelect} className="felix-watchlist-open">
        <span className="felix-watchlist-identity"><strong>{symbol}</strong><span>{name}</span></span>
        {fullPage && <span className="felix-watchlist-market">{t("navigation.market" + marketOf(symbol))}</span>}
        <span className="felix-watchlist-price">{loading ? <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-foreground/10" /> : quote ? formatPrice(quote.lastPrice, symbol) : DASH}</span>
        <span className="felix-watchlist-change" style={{ color: changeColor }}>{quote ? formatPercent(quote.changePercent) : DASH}</span>
      </button>
      <button type="button" onClick={onRemove} className="felix-hub-remove" aria-label={t("navigation.watchlistRemoveSymbol", { symbol })}><X size={15} /></button>
    </div>
  );
};
