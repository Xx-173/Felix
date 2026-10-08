import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, LockKeyhole, RefreshCw } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@finagent/i18n';
import { activeIndexSymbolAtom, fetchQuoteAtom, navSectionAtom, quoteCacheAtomFamily } from '../../atoms';
import { useFinagentClient } from '../../client';
import { DASHBOARD_INDICES, type DashboardMarket } from '../../lib/market-dashboard';
import { defaultIndexRange, filterIndexHistory, indexRangeBounds, prepareIndexHistory } from '../../lib/index-history';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { DemoBadge } from '../primitives/DemoBadge';
import { QuoteStatus } from '../stock/QuoteStatus';
import { FinancialKLineChart } from '../chart/FinancialKLineChart';

const percent = (value?: number) => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const indexValue = (value: number) => formatNumber(value, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tone = (value?: number) => value == null || value === 0 ? 'var(--foreground-muted)' : value > 0 ? 'var(--positive)' : 'var(--negative)';
type History = ReturnType<typeof prepareIndexHistory>;

/** Index navigation is independent of stock selection, watchlists and screening. */
export const IndexWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [symbol, setSymbol] = useAtom(activeIndexSymbolAtom);
  const setSection = useSetAtom(navSectionAtom);
  const fetchQuote = useSetAtom(fetchQuoteAtom);
  const market = (Object.keys(DASHBOARD_INDICES) as DashboardMarket[]).find((item) => DASHBOARD_INDICES[item].some((index) => index.symbol === symbol)) ?? 'CN';
  const indices = DASHBOARD_INDICES[market];
  const descriptor = indices.find((index) => index.symbol === symbol)!;
  const quoteCache = useAtomValue(quoteCacheAtomFamily(symbol));
  const quote = quoteCache.data;
  const [range, setRange] = useState(defaultIndexRange);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ symbol: string; status: 'loading' | 'ready' | 'error'; history: History; error?: string }>({ symbol, status: 'loading', history: { bars: [], isDemo: false, providers: [] } });
  useEffect(() => {
    void Promise.allSettled(indices.map((index) => fetchQuote({ client, symbol: index.symbol })));
  }, [client, market, reload, fetchQuote]);
  useEffect(() => {
    let cancelled = false;
    setState({ symbol, status: 'loading', history: { bars: [], isDemo: false, providers: [] } });
    void client.market.getKline({ symbol, period: '1d', limit: 400 }).then((result) => {
      if (cancelled) return;
      if (!result.ok) { setState({ symbol, status: 'error', history: { bars: [], isDemo: false, providers: [] }, error: result.error.message }); return; }
      setState({ symbol, status: 'ready', history: prepareIndexHistory(result.data, symbol) });
    }).catch((error: unknown) => { if (!cancelled) setState({ symbol, status: 'error', history: { bars: [], isDemo: false, providers: [] }, error: error instanceof Error ? error.message : t('security.chart.loadFailed') }); });
    return () => { cancelled = true; };
  }, [client, symbol, reload, t]);
  // Never display a previous index's candles while its replacement is loading.
  const history = state.symbol === symbol ? state.history : { bars: [], isDemo: false, providers: [] };
  const status = state.symbol === symbol ? state.status : 'loading';
  const bars = useMemo(() => filterIndexHistory(history.bars, range.start, range.end), [history.bars, range]);
  const hasVolume = bars.some((bar) => (bar.volume ?? 0) > 0);
  const validRange = indexRangeBounds(range.start, range.end) !== null;
  const date = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
  return <main className="felix-indices-page" data-testid="index-workspace" data-market={market} data-symbol={symbol}>
    <header className="felix-indices-heading">
      <div><h1><BilingualLabel>{t('navigation.indices')}</BilingualLabel></h1><p>{t('navigation.indexWorkspaceHint')}</p></div>
      <div className="felix-indices-actions"><button type="button" aria-label={t('navigation.backDashboard')} onClick={() => setSection('today')}><ArrowLeft size={14} /><BilingualLabel>{t('navigation.backDashboard')}</BilingualLabel></button><button type="button" aria-label={t('navigation.refreshIndices')} disabled={status === 'loading'} onClick={() => setReload((current) => current + 1)}><RefreshCw size={14} className={status === 'loading' ? 'animate-spin' : ''} /><BilingualLabel>{t('navigation.refreshIndices')}</BilingualLabel></button></div>
    </header>
    <div className="felix-market-tabs" role="tablist" aria-label={t('navigation.marketTabs')}>
      {(['CN', 'HK', 'US'] as const).map((item, index, all) => <button type="button" key={item} role="tab" aria-label={t('navigation.market' + item)} aria-selected={market === item} tabIndex={market === item ? 0 : -1} aria-controls="index-content" id={`index-market-${item}`} onClick={() => setSymbol(DASHBOARD_INDICES[item][0]!.symbol)} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'CN' : event.key === 'End' ? 'US' : all[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]!;
        setSymbol(DASHBOARD_INDICES[next][0]!.symbol); document.getElementById(`index-market-${next}`)?.focus();
      }}><BilingualLabel>{t('navigation.market' + item)}</BilingualLabel></button>)}
    </div>
    <section className="felix-indices-layout" id="index-content" role="tabpanel" aria-labelledby={`index-market-${market}`}>
      <aside className="felix-indices-list"><h2>{t('navigation.coreIndices')}</h2>{indices.map((index) => <IndexListItem key={index.symbol} descriptor={index} selected={symbol === index.symbol} onSelect={() => setSymbol(index.symbol)} />)}</aside>
      <article className="felix-indices-detail">
        <header className="felix-indices-security"><div><h2><Activity size={18} /><BilingualLabel>{t('navigation.' + descriptor.key)}</BilingualLabel><code>{symbol}</code></h2><div className="felix-indices-price"><strong>{quote ? indexValue(quote.lastPrice) : '—'}</strong><small>{t('navigation.indexPoints')}</small><span style={{ color: tone(quote?.changePercent) }}>{percent(quote?.changePercent)}</span></div><QuoteStatus quote={quote} error={quoteCache.error} /></div>
          <div className="felix-indices-range"><label>{t('navigation.indexRangeStart')}<input type="date" aria-label={t('navigation.indexRangeStart')} value={range.start} onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))} /></label><label>{t('navigation.indexRangeEnd')}<input type="date" aria-label={t('navigation.indexRangeEnd')} value={range.end} onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))} /></label></div>
        </header>
        <div className="felix-indices-history-meta" data-testid="index-history-status">{history.isDemo && <DemoBadge />}<span>{t('navigation.indexBarsCount', { count: bars.length })}</span><span>{history.isDemo ? t('navigation.quoteDemo') : history.providers.join(' · ') || t('navigation.indexHistorySourceUnknown')}</span>{history.bars.length > 0 && <span>{t('navigation.indexAvailableRange', { start: date(history.bars[0]!.timestamp), end: date(history.bars.at(-1)!.timestamp) })}</span>}</div>
        <div className="felix-indices-charts">
          <section className="felix-index-daily"><h3>{t('navigation.indexDaily')}</h3>
            {!validRange ? <div className="felix-index-chart-state" role="alert">{t('navigation.indexInvalidRange')}</div> : status === 'loading' ? <div className="felix-index-chart-state">{t('security.chart.loading')}</div> : status === 'error' ? <div className="felix-index-chart-state" role="alert"><p>{state.error}</p><button type="button" onClick={() => setReload((current) => current + 1)}>{t('common.retry')}</button></div> : bars.length === 0 ? <div className="felix-index-chart-state">{t('navigation.indexNoHistory')}</div> : <div className="felix-index-daily-canvas"><FinancialKLineChart bars={bars} symbol={symbol} period="1d" showMA showVolume={hasVolume} showMACD /></div>}
            {status === 'ready' && bars.length > 0 && !hasVolume && <p className="felix-index-volume-hint">{t('navigation.indexVolumeUnavailable')}</p>}
          </section>
          <section className="felix-index-intraday"><h3>{t('navigation.indexIntraday')}</h3><div className="felix-index-chart-state"><LockKeyhole size={32} /><strong>{t('navigation.indexIntradayUnavailable')}</strong><p>{t('navigation.indexIntradayHint')}</p></div></section>
        </div>
      </article>
    </section>
  </main>;
};

const IndexListItem: React.FC<{ descriptor: { symbol: string; key: string }; selected: boolean; onSelect: () => void }> = ({ descriptor, selected, onSelect }) => {
  const { t } = useTranslation();
  const quote = useAtomValue(quoteCacheAtomFamily(descriptor.symbol)).data;
  return <button type="button" data-testid={`index-item-${descriptor.symbol}`} aria-pressed={selected} onClick={onSelect}><span><BilingualLabel>{t('navigation.' + descriptor.key)}</BilingualLabel><strong style={{ color: tone(quote?.changePercent) }}>{percent(quote?.changePercent)}</strong></span><small><code>{descriptor.symbol}</code><span>{quote ? indexValue(quote.lastPrice) : '—'}</span></small></button>;
};
