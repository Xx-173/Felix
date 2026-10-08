import React, { useEffect, useReducer, useRef } from 'react';
import { CirclePlus, Folder, RefreshCw, Search, Upload, X, LayoutGrid, List } from 'lucide-react';
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { MAX_WATCHLIST_SYMBOLS } from '@finagent/core';
import { useTranslation } from 'react-i18next';
import {
  watchlistAtom,
  watchlistGroupsAtom,
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
import { formatMarketPrice, watchlistMarket, WATCHLIST_SYMBOL_PATTERN } from '../../lib/watchlist';
import { QuoteStatus } from './QuoteStatus';
import { WatchlistGroupsDialog } from './WatchlistGroupsDialog';
import { WatchlistImportDialog } from './WatchlistImportDialog';
import { Dialog } from '../primitives/Dialog';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { MarketTabs } from '../primitives/MarketTabs';
import { summarizeQuotes } from '../../lib/market-dashboard';

const DASH = '\u2014';

const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export const Watchlist: React.FC<{ showHeader?: boolean; fullPage?: boolean }> = ({ showHeader = true, fullPage = false }) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const watchlist = useAtomValue(watchlistAtom);
  const [groups, setGroups] = useAtom(watchlistGroupsAtom);
  const [groupId, setGroupId] = React.useState('ALL');
  const [groupEditor, setGroupEditor] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [display, setDisplay] = React.useState(() => readPersisted<string>('watchlistDisplay', 'table') === 'cards' ? 'cards' : 'table');
  const [refreshing, setRefreshing] = React.useState(false);
  const fetchQuote = useSetAtom(fetchQuoteAtom);
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
  const cacheAtom = React.useMemo(() => atom((get) => Object.fromEntries(watchlist.map((symbol) => [symbol, get(quoteCacheAtomFamily(symbol)).data]))), [watchlist]);
  const quotes = useAtomValue(cacheAtom);

  const [newSymbol, setNewSymbol] = React.useState('');
  const [error, setError] = React.useState('');
  const selectedGroup = groups.find((group) => group.id === groupId);
  useEffect(() => { if (!['ALL', 'NONE'].includes(groupId) && !selectedGroup) setGroupId('ALL'); }, [groupId, selectedGroup]);

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

    if (!WATCHLIST_SYMBOL_PATTERN.test(symbol)) {
      setError(t('navigation.watchlistInvalid'));
      return;
    }

    if (watchlist.includes(symbol)) {
      setError(t('navigation.watchlistDuplicate'));
      return;
    }
    if (watchlist.length >= MAX_WATCHLIST_SYMBOLS) { setError(t('navigation.watchlistLimit')); return; }

    addSymbol(symbol);
    if (selectedGroup) setGroups((current) => current.map((group) => group.id === selectedGroup.id ? { ...group, symbols: [...group.symbols, symbol] } : group));
    setQuery('');
    setMarket(watchlistMarket(symbol));
    setNewSymbol('');
    setError('');
    setAddOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddSymbol();
    }
  };

  const visible = watchlist.filter((symbol) => (market === 'ALL' || watchlistMarket(symbol) === market)
    && (groupId === 'ALL' || (groupId === 'NONE' ? !groups.some((group) => group.symbols.includes(symbol)) : selectedGroup?.symbols.includes(symbol)))
    && (symbol + ' ' + (nameCache.current.get(symbol) ?? '')).toLowerCase().includes(query.trim().toLowerCase()));
  const summary = summarizeQuotes(visible.flatMap((symbol) => quotes[symbol] ? [quotes[symbol]!] : []));
  const ordered = sort === 'symbol' ? [...watchlist].sort() : ['changeDesc', 'changeAsc', 'priceDesc'].includes(sort) ? [...watchlist].sort((a, b) => {
    const key = sort === 'priceDesc' ? 'lastPrice' : 'changePercent';
    const av = quotes[a]?.[key], bv = quotes[b]?.[key];
    if (av == null || !Number.isFinite(av)) return bv == null || !Number.isFinite(bv) ? 0 : 1;
    if (bv == null || !Number.isFinite(bv)) return -1;
    return sort === 'changeAsc' ? av - bv : bv - av;
  }) : watchlist;

  const addForm = <div className="felix-watchlist-add flex gap-1.5">
    <Input value={newSymbol} onChange={(event) => { setNewSymbol(event.target.value.toUpperCase()); setError(''); }} onKeyDown={handleKeyDown} placeholder="AAPL.US" aria-label={t('navigation.watchlistAddSymbol')} error={error} className="h-8 flex-1 text-[12px]" />
    <Button size={fullPage ? 'sm' : 'icon'} onClick={handleAddSymbol} aria-label={t(fullPage ? 'navigation.confirmAddSymbol' : 'navigation.watchlistAddSymbol')}><CirclePlus size={14} />{fullPage && t('navigation.confirmAddSymbol')}</Button>
  </div>;

  return (
    <div className={`felix-watchlist flex flex-col ${fullPage ? 'felix-watchlist-page' : 'h-full'}`} data-view={display}>
      {fullPage && <MarketTabs value={market} onChange={setMarket} includeAll includeSG={watchlist.some((symbol) => watchlistMarket(symbol) === 'SG')} />}
      {fullPage && <div className="felix-watchlist-groups" role="group" aria-label={t('navigation.groupFilter')}>
        <button type="button" aria-pressed={groupId === 'ALL'} onClick={() => setGroupId('ALL')}>{t('navigation.allGroups')} <small>{watchlist.length}</small></button>
        <button type="button" aria-pressed={groupId === 'NONE'} onClick={() => setGroupId('NONE')}>{t('navigation.ungrouped')}</button>
        {groups.map((group) => {
          const stats = summarizeQuotes(group.symbols.flatMap((symbol) => quotes[symbol] ? [quotes[symbol]!] : []));
          return <button key={group.id} type="button" aria-pressed={groupId === group.id} onClick={() => setGroupId(group.id)}><Folder size={13} />{group.name} <small>{group.symbols.length}</small>{stats.average !== null && <small style={{ color: stats.average >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{stats.isDemo ? '* ' : ''}{formatPercent(stats.average)}</small>}</button>;
        })}
        <button type="button" className="felix-manage-groups" onClick={() => setGroupEditor('')}><CirclePlus size={13} />{t('navigation.manageGroups')}</button>
      </div>}
      <div className="felix-watchlist-header border-b mac-section-divider px-3 py-3">
        {showHeader && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-0.5">
            <span className="text-[11px] font-semibold uppercase text-foreground/42">
              {t('navigation.watchlist')}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              {hasDemoQuotes && <DemoBadge />}
              <DataFreshness
                providerName={quotesAreDemo ? t('demo.badge') : t('navigation.listLatestQuote')}
                updatedAtMs={
                  latestTimestamp ? latestTimestamp * 1000 : undefined
                }
                className="min-w-0 text-right leading-tight"
              />
            </span>
          </div>
        )}
        {fullPage && <div className="felix-watchlist-actions">
          <span>{t('navigation.watchlistCapacity', { count: watchlist.length, max: MAX_WATCHLIST_SYMBOLS })}</span>
          <Button size="sm" onClick={() => setAddOpen(true)} aria-label={t('navigation.watchlistAddSymbol')}><CirclePlus size={14} /><BilingualLabel>{t('navigation.watchlistAddSymbol')}</BilingualLabel></Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload size={14} />{t('navigation.watchlistImport')}</Button>
          <Button size="sm" variant="outline" disabled={refreshing || visible.length === 0} onClick={async () => {
            setRefreshing(true);
            try {
              for (let offset = 0; offset < visible.length; offset += 4) {
                await Promise.all(visible.slice(offset, offset + 4).map((symbol) => fetchQuote({ client, symbol })));
              }
            } finally { setRefreshing(false); }
          }}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />{t('navigation.refreshQuotes')}</Button>
          <div className="felix-watchlist-view-toggle">
            <button type="button" aria-label={t('navigation.tableView')} title={t('navigation.tableView')} aria-pressed={display === 'table'} onClick={() => { setDisplay('table'); writePersisted('watchlistDisplay', 'table'); }}><List size={16} /></button>
            <button type="button" aria-label={t('navigation.cardView')} title={t('navigation.cardView')} aria-pressed={display === 'cards'} onClick={() => { setDisplay('cards'); writePersisted('watchlistDisplay', 'cards'); }}><LayoutGrid size={16} /></button>
          </div>
        </div>}
        {!fullPage && addForm}
      </div>
      {fullPage && <div className="felix-watchlist-summary" data-testid="watchlist-summary">
        {summary.isDemo && <DemoBadge />}
        <span>{t('navigation.validQuotes')} <strong>{summary.count} / {visible.length}</strong></span>
        <span>{t('navigation.risingList')} <strong style={{ color: 'var(--positive)' }}>{summary.count ? summary.rising : '—'}</strong></span>
        <span>{t('navigation.fallingList')} <strong style={{ color: 'var(--negative)' }}>{summary.count ? summary.falling : '—'}</strong></span>
        <span>{t('navigation.averageChange')} <strong>{summary.average === null ? '—' : formatPercent(summary.average)}</strong></span>
      </div>}
      {fullPage && <div className="felix-hub-toolbar">
        <label className="felix-hub-search"><Search size={16} /><input aria-label={t('navigation.watchlistSearch')} placeholder={t('navigation.watchlistSearch')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label={t('navigation.symbolSort')} value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="added">{t('navigation.addedOrder')}</option><option value="symbol">{t('navigation.alphabetical')}</option>
          <option value="changeDesc">{t('navigation.changeDescending')}</option><option value="changeAsc">{t('navigation.changeAscending')}</option><option value="priceDesc">{t('navigation.priceDescending')}</option>
        </select>
      </div>}
      {fullPage && <div className="felix-watchlist-columns" aria-hidden="true">
        {['symbolColumn', 'priceColumn', 'changeColumn', 'volumeColumn', 'highColumn', 'lowColumn', 'actionsColumn'].map((key) => <span key={key}><BilingualLabel stacked>{t('navigation.' + key)}</BilingualLabel></span>)}
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
            groups={groups.filter((group) => group.symbols.includes(symbol)).map((group) => group.name)}
            onGroups={() => setGroupEditor(symbol)}
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
      {groupEditor !== null && <WatchlistGroupsDialog symbol={groupEditor || undefined} onClose={() => setGroupEditor(null)} />}
      {importOpen && <WatchlistImportDialog groupId={selectedGroup?.id} onClose={() => setImportOpen(false)} />}
      {fullPage && <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={t('navigation.addSymbolTitle')}><p className="mb-4 text-xs text-foreground/60">{t('navigation.importInstructions')}</p>{addForm}</Dialog>}
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
  groups: string[];
  onGroups: () => void;
}

const WatchlistRow: React.FC<WatchlistRowProps> = ({
  symbol,
  fullPage,
  hidden,
  name,
  active,
  onSelect,
  onRemove,
  groups,
  onGroups,
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
      <div className="felix-watchlist-row-main">
      <button type="button" aria-label={symbol} data-testid={`watchlist-row-${symbol}`} onClick={onSelect} className="felix-watchlist-open">
        <span className="felix-watchlist-identity"><strong>{symbol} {fullPage && <small className="felix-watchlist-market"><BilingualLabel>{t('navigation.market' + watchlistMarket(symbol))}</BilingualLabel></small>}</strong><span>{name}</span></span>
        <span className="felix-watchlist-price">{loading ? <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-foreground/10" /> : quote ? formatMarketPrice(quote.lastPrice, symbol) : DASH}</span>
        <span className="felix-watchlist-change" style={{ color: changeColor }}>{quote ? formatPercent(quote.changePercent) : DASH}</span>
        {fullPage && <><span className="felix-watchlist-volume">{quote && Number.isFinite(quote.volume) ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(quote.volume) : DASH}</span><span className="felix-watchlist-range">{quote ? formatMarketPrice(quote.high, symbol) : DASH}</span><span className="felix-watchlist-range">{quote ? formatMarketPrice(quote.low, symbol) : DASH}</span></>}
      </button>
      {fullPage && <button type="button" className="felix-hub-remove" aria-label={t('navigation.groupMembershipFor', { symbol })} onClick={onGroups}><Folder size={15} /></button>}
      <button type="button" onClick={onRemove} className="felix-hub-remove" aria-label={t("navigation.watchlistRemoveSymbol", { symbol })}><X size={15} /></button>
      </div>
      {groups.length > 0 && <div className="felix-watchlist-memberships">{groups.map((name) => <span key={name}>{name}</span>)}</div>}
      {fullPage && <QuoteStatus quote={quote} error={cache.error} />}
    </div>
  );
};
