import { uiTerm } from '../../i18n/displayNames';
import React, { useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  Maximize2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ClaimVerification } from './ClaimVerification';
import type { ResearchReport, ResearchRunStatus, StaticInfo } from '@finagent/core';
import { addToWatchlistAtom, quoteCacheAtomFamily, fetchQuoteAtom, removeFromWatchlistAtom, watchlistAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { FinancialKLineChart } from '../chart/FinancialKLineChart';
import { watchlistMarket } from '../../lib/watchlist';
import { prepareIndexHistory } from '../../lib/index-history';
import { DemoBadge } from '../primitives/DemoBadge';
import type { FinancialBar } from '../chart/klineAdapter';
import { semanticCapabilityLabelKey } from '../../lib/agentPresentation';
import { AgentAmbientField, type AgentMotionState } from '../motion/AgentAmbientField';

const PERIODS = ['1d', '1w', '1h', '15m'] as const;
type Period = (typeof PERIODS)[number];

interface ResearchMarketWorkspaceProps {
  symbol: string;
  report: ResearchReport | null;
  activeRun: ResearchRunStatus | null;
  loading: boolean;
  onStart: () => void;
}

const formatPrice = (value: number | undefined, currency = 'USD'): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
};

const formatSigned = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
};

const formatPercent = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const formatCompact = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
};

const STANCE_TONE = {
  bullish: 'felix-research-decision--positive',
  bearish: 'felix-research-decision--negative',
  neutral: 'felix-research-decision--neutral',
} as const;

/**
 * Coinbase-inspired research surface: chart-first context, an evidence
 * preview, and an actionable decision rail. All market values come from the
 * existing market client; the empty state stays honest when a provider is not
 * available.
 */
export const ResearchMarketWorkspace: React.FC<ResearchMarketWorkspaceProps> = ({
  symbol,
  report,
  activeRun,
  loading,
  onStart,
}) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const quoteCache = useAtomValue(quoteCacheAtomFamily(symbol));
  const fetchQuote = useSetAtom(fetchQuoteAtom);
  const watchlist = useAtomValue(watchlistAtom);
  const addToWatchlist = useSetAtom(addToWatchlistAtom);
  const removeFromWatchlist = useSetAtom(removeFromWatchlistAtom);
  const [info, setInfo] = useState<StaticInfo | null>(null);
  const [period, setPeriod] = useState<Period>('1d');
  const [bars, setBars] = useState<FinancialBar[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [historyDemo, setHistoryDemo] = useState(false);
  const [indicators, setIndicators] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const watched = watchlist.includes(symbol);
  const quote = quoteCache.data;
  const currency = info?.currency ?? ({ CN: 'CNY', HK: 'HKD', US: 'USD', SG: 'SGD' } as Record<string, string>)[watchlistMarket(symbol)] ?? 'USD';
  const companyName = info?.name ?? symbol;

  useEffect(() => {
    void fetchQuote({ client, symbol });
    let alive = true;
    setInfo(null);
    void client.market.getStaticInfo(symbol).then((result) => {
      if (alive && result.ok) setInfo(result.data);
    });
    return () => {
      alive = false;
    };
  }, [client, fetchQuote, symbol]);

  useEffect(() => {
    let alive = true;
    setChartLoading(true);
    setChartError(null);
    setBars([]); setHistoryDemo(false);
    void client.market
      .getKline({ symbol, period, limit: 180 })
      .then((result) => {
        if (!alive) return;
        if (!result.ok) {
          setChartError(result.error.message);
          setChartLoading(false);
          return;
        }
        const history = prepareIndexHistory(result.data, symbol);
        setBars(history.bars); setHistoryDemo(history.isDemo);
        setChartLoading(false);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setChartError(error instanceof Error ? error.message : String(error));
        setChartLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [client, period, symbol]);

  const evidenceRows = useMemo(
    () =>
      report?.sections
        .flatMap((section) =>
          section.evidence.map((ref) => ({
            ...ref,
            sectionTitle: section.title,
          }))
        )
        .slice(0, 5) ?? [],
    [report]
  );

  const recentBars = bars.slice(-20);
  const rangeHigh = recentBars.length ? Math.max(...recentBars.map((bar) => bar.high)) : undefined;
  const rangeLow = recentBars.length ? Math.min(...recentBars.map((bar) => bar.low)) : undefined;
  const averageClose = recentBars.length ? recentBars.reduce((sum, bar) => sum + bar.close, 0) / recentBars.length : undefined;
  const confidence = report ? Math.round(report.confidence * 100) : 0;
  const stance = report?.stance ?? 'neutral';
  const stanceTone = report ? STANCE_TONE[stance] : 'felix-research-decision--empty';
  const stanceLabel = report
    ? t(`research.stance.${stance}`)
    : t('research.workspace.awaitingDecision');
  const ambientState: AgentMotionState = activeRun === 'synthesizing'
    ? 'synthesizing'
    : activeRun
      ? 'tool'
      : 'idle';

  return (
    <section className="felix-research-workspace" data-testid="research-market-workspace" data-symbol={symbol}>
      <div className="felix-research-market-main">
        <div className="felix-research-asset-header">
          <div className="felix-research-asset-copy min-w-0">
            <div className="felix-research-asset-overline">
              <span className="felix-research-market-dot" aria-hidden="true" />
              <span>{currency} · {quote?.source === 'demo' ? t('demo.badge') : t('research.workspace.marketStatus')}</span>
            </div>
            <div className="felix-research-asset-identity">
              <h1 className="felix-research-symbol">{symbol}</h1>
              <span className="felix-research-asset-company">{companyName}</span>
            </div>
            <div className="felix-research-price-line">
              <strong className="tnum">{formatPrice(quote?.lastPrice, currency)}</strong>
              <span className={`felix-research-price-change tnum ${quote && quote.change >= 0 ? 'text-positive' : 'text-negative'}`}>
                {formatSigned(quote?.change)} ({formatPercent(quote?.changePercent)})
              </span>
            </div>
            <p className="felix-research-market-meta">
              {quote?.timestamp
                ? `${t('research.workspace.lastUpdated')} ${new Date(quote.timestamp * 1000).toLocaleString()}`
                : t('research.workspace.marketDataUnavailable')}
            </p>
          </div>
          <div className="felix-research-asset-actions">
            <button
              type="button"
              onClick={() => (watched ? removeFromWatchlist(symbol) : addToWatchlist(symbol))}
              className={`felix-research-outline-button ${watched ? 'felix-research-outline-button--active' : ''}`}
              aria-pressed={watched}
              data-testid="research-watchlist-toggle"
            >
              <Star className="h-3.5 w-3.5" fill={watched ? 'currentColor' : 'none'} />
              {watched ? t('research.workspace.inWatchlist') : t('research.workspace.addToWatchlist')}
            </button>
            <button type="button" className="felix-research-icon-button" aria-label={t('research.workspace.moreActions')}>
              <Ellipsis className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="felix-research-tabs" aria-label={t('research.workspace.tabsAria')}>
          <a className="felix-research-tab felix-research-tab--active" href="#research-overview">{t('research.workspace.overview')}</a>
          <a className="felix-research-tab" href="#research-signals">{t('research.workspace.signals')}</a>
          <a className="felix-research-tab" href="#research-evidence">{t('research.workspace.evidence')}</a>
          <a className="felix-research-tab" href="#research-thesis">{t('research.workspace.thesis')}</a>
        </nav>

        <div id="research-overview" className={`felix-research-chart-panel ${expanded ? 'felix-research-chart-expanded' : ''}`}>
          <div className="felix-research-chart-toolbar">
            <div className="felix-research-chart-toolbar-left">
              <span className="felix-research-chart-mode"><Activity className="h-3.5 w-3.5" />{t('research.workspace.chartMode')}</span>
              <div className="felix-research-periods">
              {PERIODS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPeriod(value)}
                  aria-pressed={period === value}
                  className={`felix-research-period ${period === value ? 'felix-research-period--active' : ''}`}
                >
                  {uiTerm(value)}
                </button>
              ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-pressed={indicators} onClick={() => setIndicators((current) => !current)} className="felix-research-toolbar-control"><SlidersHorizontal className="h-3.5 w-3.5" />{t('research.workspace.indicators')}<ChevronDown className="h-3 w-3" /></button>
              <button type="button" aria-pressed={expanded} onClick={() => setExpanded((current) => !current)} className="felix-research-icon-button" aria-label={t(expanded ? 'common.close' : 'research.workspace.expandChart')}><Maximize2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="felix-research-chart-canvas">
            {chartLoading ? (
              <div className="felix-research-chart-empty" data-testid="research-chart-loading">
                <div className="felix-research-chart-skeleton" />
                <span>{t('research.workspace.loadingChart')}</span>
              </div>
            ) : bars.length > 0 ? (
              <FinancialKLineChart bars={bars} symbol={symbol} period={period} showMA={indicators} showVolume={bars.some((bar) => (bar.volume ?? 0) > 0)} showMACD={indicators} />
            ) : (
              <div className="felix-research-chart-empty" data-testid="research-chart-empty">
                <BarChart3 className="h-5 w-5" />
                <span>{chartError ?? t('research.workspace.noChartData')}</span>
              </div>
            )}
          </div>
          <div className="felix-research-key-levels" data-testid="research-key-levels"><h3>{t('research.keyLevels')}{historyDemo && <DemoBadge />}</h3><div><ResearchStat label={t('research.rangeHigh')} value={formatPrice(rangeHigh, currency)} /><ResearchStat label={t('research.rangeLow')} value={formatPrice(rangeLow, currency)} /><ResearchStat label={t('research.averageClose')} value={formatPrice(averageClose, currency)} /></div><p>{t('research.levelsHint')}</p></div>
          <div className="felix-research-stat-strip">
            <ResearchStat label={t('research.workspace.open')} value={formatPrice(quote?.open, currency)} />
            <ResearchStat label={t('research.workspace.high')} value={formatPrice(quote?.high, currency)} />
            <ResearchStat label={t('research.workspace.low')} value={formatPrice(quote?.low, currency)} />
            <ResearchStat label={t('research.workspace.prevClose')} value={formatPrice(quote?.prevClose, currency)} />
            <ResearchStat label={t('research.workspace.volume')} value={formatCompact(quote?.volume)} />
            <ResearchStat label={t('research.workspace.marketStatus')} value={quote?.source === 'demo' ? t('demo.badge') : quote ? t('research.workspace.marketStatus') : '—'} />
          </div>
        </div>

        <EvidencePreview report={report} rows={evidenceRows} />
      </div>

      <aside className={`felix-research-decision-rail ${stanceTone}`} aria-label={t('research.workspace.decision')}>
        <div className="felix-research-rail-heading">
          <div>
            <span className="felix-research-rail-kicker">{t('research.workspace.signals')}</span>
            <h2>{t('research.workspace.decision')}</h2>
          </div>
          <CircleHelp className="h-3.5 w-3.5" />
        </div>
        <div className="felix-research-decision-status">
          {activeRun && <AgentAmbientField state={ambientState} />}
          <div className="felix-research-decision-card">
            {report ? <ArrowUpRight className="felix-research-decision-icon h-7 w-7" /> : <Sparkles className="felix-research-decision-icon h-6 w-6" />}
            <div>
              <strong>{stanceLabel}</strong>
              <p>{report ? t('research.workspace.decisionSummary') : t('research.workspace.decisionEmptyHint')}</p>
            </div>
          </div>
        </div>
        <div className="felix-research-confidence-row">
          <span>{t('research.confidence')}</span>
          <div className="felix-research-confidence-ring" style={{ '--confidence': `${confidence * 3.6}deg` } as React.CSSProperties}>
            <span>{report ? `${confidence}%` : '—'}</span>
          </div>
        </div>
        <DecisionRow label={t('research.workspace.horizon')} value="—" />
        {report && <ClaimVerification report={report} />}
        <DecisionRow label={t('research.workspace.priceTarget')} value="—" />
        <DecisionRow label={t('research.workspace.potentialReturn')} value="—" />
        <DecisionRow label={t('research.workspace.keyRisk')} value={report?.risks[0] ?? '—'} multiline />
        <div id="research-thesis" className="felix-research-next-action-block">
          <div className="felix-research-next-action-label">{t('research.workspace.nextAction')}</div>
          <button type="button" onClick={onStart} disabled={loading || Boolean(activeRun) || Boolean(report)} className="felix-research-next-action-button">
            <Activity className="h-4 w-4" />
            <span>
              <strong>{report ? t('research.workspace.reportReady') : activeRun ? t('research.synthesizing') : t('research.deepResearch')}</strong>
              <small>{report ? t('research.workspace.reportReadyHint') : t('research.workspace.startResearchHint')}</small>
            </span>
          </button>
        </div>
        <div className="felix-research-source-count">
          <span>{t('research.workspace.sources')}</span>
          <strong>{evidenceRows.length || '—'}</strong>
        </div>
      </aside>
    </section>
  );
};

const ResearchStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="felix-research-stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const DecisionRow: React.FC<{ label: string; value: string; multiline?: boolean }> = ({ label, value, multiline = false }) => (
  <div className={`felix-research-decision-row ${multiline ? 'felix-research-decision-row--multiline' : ''}`}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const EvidencePreview: React.FC<{
  report: ResearchReport | null;
  rows: Array<ResearchReport['sections'][number]['evidence'][number] & { sectionTitle: string }>;
}> = ({ report, rows }) => {
  const { t } = useTranslation();
  return (
    <section id="research-evidence" className="felix-research-evidence-panel" data-testid="research-evidence-preview">
      <div className="felix-research-section-heading">
        <div>
          <div className="felix-research-section-kicker"><Search className="h-3.5 w-3.5" />{t('research.workspace.evidence')}</div>
          <h2>{t('research.workspace.evidenceTitle')} <span>{rows.length || '—'}</span></h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="felix-research-toolbar-control"><SlidersHorizontal className="h-3.5 w-3.5" />{t('research.workspace.filters')}</button>
          <button type="button" className="felix-research-toolbar-control"><BarChart3 className="h-3.5 w-3.5" />{t('research.workspace.columns')}</button>
          <button type="button" className="felix-research-icon-button" aria-label={t('research.workspace.moreActions')}><Ellipsis className="h-4 w-4" /></button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="felix-research-evidence-empty">
          <Sparkles className="h-4 w-4" />
          <span>{report ? t('research.workspace.noEvidence') : t('research.workspace.evidenceEmptyHint')}</span>
        </div>
      ) : (
        <div className="felix-research-evidence-table">
          <div className="felix-research-evidence-head"><span>{t('research.workspace.source')}</span><span>{t('research.workspace.claim')}</span><span>{t('research.workspace.freshness')}</span><span>{t('research.confidence')}</span></div>
          {rows.map((row) => (
            <div key={row.runId} className="felix-research-evidence-table-row">
              <span className="felix-research-evidence-source"><span className="felix-research-source-mark">{row.sectionTitle.slice(0, 1)}</span>{t(semanticCapabilityLabelKey(row.capabilityId))}</span>
              <span className="felix-research-evidence-claim">{row.claim}</span>
              <span className="felix-research-evidence-freshness">{new Date(row.fetchedAt).toLocaleDateString()}</span>
              <span className="felix-research-evidence-confidence"><i /><i /><i /><i /><i /></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
