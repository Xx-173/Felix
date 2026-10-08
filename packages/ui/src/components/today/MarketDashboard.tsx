import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Gauge, RefreshCw, TrendingUp } from 'lucide-react';
import type { MarketStatus, MarketTemperature, Quote } from '@finagent/core';
import { activeIndexSymbolAtom, activeSymbolAtom, activeViewAtom, fetchQuoteAtom, navSectionAtom, quoteCacheAtomFamily, watchlistAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { DASHBOARD_INDICES, CHANGE_BUCKET_LABELS, summarizeQuotes, type DashboardMarket } from '../../lib/market-dashboard';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { formatMarketPrice, watchlistMarket } from '../../lib/watchlist';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { DemoBadge } from '../primitives/DemoBadge';
import { QuoteStatus } from '../stock/QuoteStatus';
import { TodayView } from './TodayView';

const percent = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const tone = (value?: number | null) => value == null || value === 0 ? 'var(--foreground-muted)' : value > 0 ? 'var(--positive)' : 'var(--negative)';

/** Indices are market-wide; breadth and rankings are explicitly the user's observed watchlist. */
export const MarketDashboard: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const watchlist = useAtomValue(watchlistAtom);
  const fetchQuote = useSetAtom(fetchQuoteAtom);
  const setSection = useSetAtom(navSectionAtom);
  const setSymbol = useSetAtom(activeSymbolAtom);
  const setIndex = useSetAtom(activeIndexSymbolAtom);
  const setView = useSetAtom(activeViewAtom);
  const [market, setMarket] = useState<DashboardMarket>(() => {
    const value = readPersisted<string>('dashboardMarket', 'CN');
    return value === 'HK' || value === 'US' ? value : 'CN';
  });
  const [personal, setPersonal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [temperature, setTemperature] = useState<MarketTemperature | null>(null);
  const [statuses, setStatuses] = useState<MarketStatus[]>([]);
  const generation = useRef(0);
  const symbols = watchlist.filter((symbol) => watchlistMarket(symbol) === market);
  const symbolKey = symbols.join('|');
  const quotesAtom = useMemo(() => atom((get) => symbolKey.split('|').filter(Boolean).map((symbol) => get(quoteCacheAtomFamily(symbol)).data).filter((quote): quote is Quote => Boolean(quote))), [symbolKey]);
  const stats = summarizeQuotes(useAtomValue(quotesAtom), market);
  const ordered = [...stats.observations].sort((a, b) => b.changePercent - a.changePercent);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    const context = Promise.allSettled([
      client.market.getMarketStatus(),
      client.market.getMarketTemperature?.(market) ?? Promise.resolve(null),
    ]);
    try {
      const requested = [...DASHBOARD_INDICES[market].map((index) => index.symbol), ...symbolKey.split('|').filter(Boolean)];
      for (let offset = 0; offset < requested.length; offset += 4) {
        if (request !== generation.current) return;
        await Promise.all(requested.slice(offset, offset + 4).map((symbol) => fetchQuote({ client, symbol })));
      }
      const [status, sentiment] = await context;
      if (request !== generation.current) return;
      if (status.status === 'fulfilled' && status.value.ok) setStatuses(status.value.data);
      const value = sentiment.status === 'fulfilled' && sentiment.value?.ok ? sentiment.value.data : null;
      const matchesMarket = value && (value.market === market || market === 'CN' && ['SH', 'SZ'].includes(value.market));
      setTemperature(matchesMarket && Number.isFinite(value.temperature) && value.temperature >= 0 && value.temperature <= 100 ? value : null);
    } finally { if (request === generation.current) setLoading(false); }
  }, [client, market, symbolKey, fetchQuote]);
  useEffect(() => {
    setTemperature(null); setStatuses([]);
    void refresh();
    const interval = setInterval(() => void refresh(), 30000);
    return () => { generation.current++; clearInterval(interval); };
  }, [refresh]);
  const openSymbol = (symbol: string) => { setSymbol(symbol); setView('chart'); setSection('watchlist'); };
  const marketStatus = statuses.filter((item) => item.market === market || market === 'CN' && ['SH', 'SZ'].includes(item.market));
  if (personal) return <div className="felix-personal-overview"><button type="button" className="felix-dashboard-back" onClick={() => setPersonal(false)}>{t('navigation.backDashboard')}</button><TodayView /></div>;
  return <main className="felix-market-dashboard" data-testid="market-dashboard" data-market={market}>
    <header className="felix-dashboard-header">
      <div className="felix-market-tabs" role="tablist" aria-label={t('navigation.marketTabs')}>
        {(['CN', 'HK', 'US'] as const).map((item, index, all) => <button key={item} id={`market-tab-${item}`} type="button" role="tab" aria-controls="market-content" aria-selected={item === market} tabIndex={item === market ? 0 : -1}
          onClick={() => { setMarket(item); writePersisted('dashboardMarket', item); }} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'CN' : event.key === 'End' ? 'US' : all[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]!;
            setMarket(next); writePersisted('dashboardMarket', next); document.getElementById(`market-tab-${next}`)?.focus();
          }} aria-label={t('navigation.market' + item)}><BilingualLabel>{t('navigation.market' + item)}</BilingualLabel></button>)}
      </div>
      <div className="felix-dashboard-tools"><button type="button" onClick={() => setPersonal(true)}>{t('navigation.personalOverview')}</button><button type="button" disabled={loading} aria-label={t('navigation.refreshDashboard')} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /><BilingualLabel>{t('navigation.refreshDashboard')}</BilingualLabel></button></div>
    </header>
    <section id="market-content" role="tabpanel" aria-labelledby={`market-tab-${market}`}>
      <div className="felix-dashboard-context"><span><Activity size={13} />{t('navigation.dashboardNotRealtime')}</span><span>{marketStatus.length ? marketStatus.map((item) => `${item.market}: ${item.status}`).join(' · ') : t('navigation.marketStatusUnknown')}</span></div>
      <div className="felix-dashboard-indices">{DASHBOARD_INDICES[market].map((index) => <IndexCard key={index.symbol} descriptor={index} onOpen={() => { setIndex(index.symbol); setSection('indices'); }} />)}</div>
      <div className="felix-dashboard-scope"><span>{t('navigation.observationScope', { count: stats.count, total: symbols.length })}</span>{stats.isDemo && <DemoBadge />}<button type="button" onClick={() => setSection('workspace')}>{t('navigation.manageWatchlist')} <ArrowUpRight size={13} /></button></div>
      <div className="felix-dashboard-metrics">
        <Metric title={t('navigation.observedBreadth')} value={stats.count ? `${stats.rising} / ${stats.flat} / ${stats.falling}` : '—'} hint={t('navigation.breadthOrder')} />
        <Metric title={t('navigation.strongWeak')} value={stats.count ? `${stats.strong} / ${stats.weak}` : '—'} hint={t('navigation.strongWeakThreshold')} />
        <Metric title={t('navigation.averageChange')} value={percent(stats.average)} color={tone(stats.average)} hint={t('navigation.equalWeight')} />
        <Metric title={t('navigation.medianChange')} value={percent(stats.median)} color={tone(stats.median)} hint={t('navigation.watchlistScope')} />
        <Metric title={t('navigation.marketBreadth')} value="—" hint={t('navigation.fullMarketUnavailable')} />
        <Metric title={t('navigation.marketTurnover')} value="—" hint={t('navigation.fullMarketUnavailable')} />
      </div>
      <div className="felix-dashboard-grid">
        <article className="felix-dashboard-card felix-breadth-card"><h2><BarChart3 size={16} /><BilingualLabel>{t('navigation.changeDistribution')}</BilingualLabel></h2>
          {stats.count ? <><div className="felix-distribution-bars" role="img" aria-label={t('navigation.distributionDescription', { count: stats.count })}>{stats.bins.map((count, index) => <div key={index}><span>{count}</span><i style={{ height: `${Math.max(3, count / Math.max(...stats.bins, 1) * 95)}px`, background: index < 4 ? 'var(--negative)' : 'var(--positive)' }} /><small>{CHANGE_BUCKET_LABELS[index]}</small></div>)}</div>
            <div className="felix-breadth-ratio"><span style={{ color: 'var(--positive)' }}>{t('navigation.risingCount', { count: stats.rising })}</span><strong>{stats.risingRatio?.toFixed(1)}%</strong><span style={{ color: 'var(--negative)' }}>{t('navigation.fallingCount', { count: stats.falling })}</span></div></> : <Empty text={t('navigation.addMarketSymbols')} />}
          <p className="felix-dashboard-footnote">{t('navigation.watchlistScope')}</p>
        </article>
        <article className="felix-dashboard-card"><h2><Gauge size={16} /><BilingualLabel>{t('navigation.marketSentiment')}</BilingualLabel></h2>
          {temperature ? <><div className="felix-sentiment-gauge" style={{ '--sentiment-angle': `${temperature.temperature * 3.6}deg` } as React.CSSProperties}><strong>{temperature.temperature.toFixed(0)}<small>/ 100</small></strong></div><p className="felix-dashboard-footnote">{t('navigation.providerSentiment')}</p><div className="felix-sentiment-details"><span>{t('navigation.valuationScore')}<strong>{Number.isFinite(temperature.valuation) ? temperature.valuation : '—'}</strong></span><span>{t('navigation.sentimentScore')}<strong>{Number.isFinite(temperature.sentiment) ? temperature.sentiment : '—'}</strong></span></div></> : <Empty text={t('navigation.sentimentUnavailable')} />}
        </article>
        <article className="felix-dashboard-card"><h2><TrendingUp size={16} /><BilingualLabel>{t('navigation.observedLeaders')}</BilingualLabel></h2><div className="felix-dashboard-rankings">
          <Ranking label={t('navigation.risingList')} quotes={ordered.filter((quote) => quote.changePercent > 0).slice(0, 5)} onOpen={openSymbol} />
          <Ranking label={t('navigation.fallingList')} quotes={ordered.filter((quote) => quote.changePercent < 0).reverse().slice(0, 5)} onOpen={openSymbol} />
        </div><p className="felix-dashboard-footnote">{t('navigation.watchlistScope')}</p></article>
      </div>
      <div className="felix-dashboard-bottom">
        <article className="felix-dashboard-card"><h2><BilingualLabel>{t('navigation.sectorHeat')}</BilingualLabel></h2><Empty text={t('navigation.sectorUnavailable')} /><button type="button" className="felix-dashboard-link" onClick={() => setSection('settings')}>{t('navigation.configureMarketData')} <ArrowUpRight size={14} /></button></article>
        <article className="felix-dashboard-card"><h2><BilingualLabel>{t('navigation.researchShortcuts')}</BilingualLabel></h2><div className="felix-dashboard-shortcuts">{(['alerts', 'events', 'portfolio', 'discover'] as const).map((section) => <button key={section} type="button" onClick={() => setSection(section)}><BilingualLabel>{t('navigation.' + section)}</BilingualLabel><ArrowUpRight size={14} /></button>)}</div></article>
      </div>
    </section>
  </main>;
};

const Metric: React.FC<{ title: string; value: string; hint: string; color?: string }> = ({ title, value, hint, color }) => <article className="felix-market-metric"><span><BilingualLabel>{title}</BilingualLabel></span><strong style={{ color }}>{value}</strong><small><BilingualLabel>{hint}</BilingualLabel></small></article>;
const Empty: React.FC<{ text: string }> = ({ text }) => <div className="felix-dashboard-empty"><Activity size={23} /><p><BilingualLabel>{text}</BilingualLabel></p></div>;
const IndexCard: React.FC<{ descriptor: { symbol: string; key: string }; onOpen: () => void }> = ({ descriptor, onOpen }) => {
  const { t } = useTranslation();
  const cache = useAtomValue(quoteCacheAtomFamily(descriptor.symbol));
  const quote = cache.data;
  return <article className="felix-index-card"><button type="button" onClick={onOpen}><h2><BilingualLabel>{t('navigation.' + descriptor.key)}</BilingualLabel></h2><span className="felix-index-change" style={{ color: tone(quote?.changePercent) }}>{quote ? percent(quote.changePercent) : '—'}</span><span className="felix-index-code">{descriptor.symbol}</span><strong>{quote && Number.isFinite(quote.lastPrice) ? quote.lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</strong>{quote && quote.changePercent >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</button><QuoteStatus quote={quote} error={cache.error} /></article>;
};
const Ranking: React.FC<{ label: string; quotes: Quote[]; onOpen: (symbol: string) => void }> = ({ label, quotes, onOpen }) => {
  const { t } = useTranslation();
  return <div><h3><BilingualLabel>{label}</BilingualLabel></h3>{quotes.length ? quotes.map((quote) => <button type="button" key={quote.symbol} onClick={() => onOpen(quote.symbol)}><span>{quote.symbol}<small>{formatMarketPrice(quote.lastPrice, quote.symbol)}</small></span><strong style={{ color: tone(quote.changePercent) }}>{percent(quote.changePercent)}</strong></button>) : <p className="felix-dashboard-footnote">{t('navigation.noObservedQuotes')}</p>}</div>;
};
