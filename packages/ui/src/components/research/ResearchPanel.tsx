import React, { useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Check, Search } from 'lucide-react';
import type { ResearchRunSummary, ResearchReport, StrategyId } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom, watchlistAtom } from '../../atoms';
import { pendingResearchStrategyAtom, researchOriginAtom } from '../../atoms/discoverAtoms';
import {
  researchRunsAtom,
  researchReportAtom,
  researchLoadingAtom,
  startResearch,
  cancelResearch,
  loadResearchRuns,
  loadResearchRun,
  loadResearchReport,
  TERMINAL_RUN_STATUSES,
} from '../../atoms/researchAtoms';
import { saveThesisFromReport } from '../../client/thesis';
import { ResearchReportView } from './ResearchReportView';
import { MarketTabs } from '../primitives/MarketTabs';
import { watchlistMarket } from '../../lib/watchlist';
import { ResearchStockPicker } from './ResearchStockPicker';
import { ResearchMarketWorkspace } from './ResearchMarketWorkspace';
import { DEFAULT_STRATEGY_ID, StrategyPicker } from './StrategyPicker';
import { NextAction } from '../primitives/NextAction';
import { semanticCapabilityLabelKey } from '../../lib/agentPresentation';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { ContentReveal } from '../motion/ContentReveal';
import { useFinagentClient } from '../../client';

const POLL_MS = 900;
const SYMBOL_REGEX = /^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/;

/** localStorage key for the last strategy chosen for a symbol (V9 §20). */
function lastStrategyKey(symbol: string): string {
  return `lastStrategy.${symbol}`;
}

/** Deep Research entry: run history for the focused symbol + start/cancel + report. */
export const ResearchPanel: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);
  const watchlist = useAtomValue(watchlistAtom);
  const [market, setMarket] = useState(() => ['CN', 'HK', 'US'].includes(watchlistMarket(symbol ?? '')) ? watchlistMarket(symbol!) : 'CN');
  useEffect(() => { if (symbol && ['CN', 'HK', 'US'].includes(watchlistMarket(symbol))) setMarket(watchlistMarket(symbol)); }, [symbol]);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const [runs, setRuns] = useAtom(researchRunsAtom);
  const userSelected = React.useRef(false);
  const requestedReport = React.useRef<string | null>(null);
  const selectionRef = React.useRef(symbol);
  selectionRef.current = symbol;
  const [historyLoading, setHistoryLoading] = useState(false);
  const [report, setReport] = useAtom(researchReportAtom);
  const [loading, setLoading] = useAtom(researchLoadingAtom);
  const [error, setError] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState<StrategyId>(DEFAULT_STRATEGY_ID);
  const [pendingStrategy, setPendingStrategy] = useAtom(pendingResearchStrategyAtom);
  const [researchOrigin, setResearchOrigin] = useAtom(researchOriginAtom);
  const [recommendedStrategy, setRecommendedStrategy] = useState<StrategyId | null>(null);
  const [thesisSaved, setThesisSaved] = useState(false);

  // Discover → Research: a candidate card carries a recommended strategy.
  useEffect(() => {
    if (pendingStrategy) {
      setStrategyId(pendingStrategy);
      setRecommendedStrategy(pendingStrategy);
      setPendingStrategy(null);
      return;
    }
    // No recommendation: reuse the last strategy the user ran for this
    // symbol, so repeated research doesn't force a re-selection (V9 §20).
    if (symbol) {
      const last = readPersisted<StrategyId | null>(lastStrategyKey(symbol), null);
      if (last) setStrategyId(last);
    }
  }, [pendingStrategy, setPendingStrategy, symbol]);

  useEffect(() => {
    let alive = true;
    void loadResearchRuns(client).then((loaded) => {
      if (!alive) return;
      setRuns(loaded);
      const validRuns = loaded.filter((run) => SYMBOL_REGEX.test(run.symbol));
      const recent = validRuns.find((run) => run.status === 'interrupted' || !(run.status in TERMINAL_RUN_STATUSES)) ?? validRuns[0];
      if (recent && !userSelected.current) setActiveSymbol((current) => current ?? recent.symbol);
    });
    return () => { alive = false; };
  }, [setRuns, setActiveSymbol, client]);

  useEffect(() => {
    let alive = true;
    setThesisSaved(false);
    if (!symbol) { setReport(null); return; }
    const latest = runs.find((run) => run.symbol === symbol && run.reportId === requestedReport.current) ?? runs.find((run) => run.symbol === symbol && run.reportId);
    if (latest?.reportId && (!report || report.symbol !== symbol)) {
      void loadResearchReport(latest.reportId, client).then((loaded) => { if (alive && loaded) setReport(loaded); });
    }
    return () => { alive = false; };
  }, [symbol, setReport, runs, report, client]);

  // Poll the newest active run for this symbol while it is non-terminal.
  const activeRun = runs.find(
    (run) => run.symbol === symbol && !(run.status in TERMINAL_RUN_STATUSES)
  );
  useEffect(() => {
    if (!activeRun) return;
    let alive = true;
    const timer = setInterval(async () => {
      const updated = await loadResearchRun(activeRun.id, client);
      if (!alive || !updated) return;
      setRuns((current) => {
        const next = [updated, ...current.filter((run) => run.id !== updated.id)];
        return next;
      });
      if (updated.status in TERMINAL_RUN_STATUSES && updated.reportId) {
        const loaded = await loadResearchReport(updated.reportId, client);
        if (alive && loaded) {
          setReport(loaded);

        }
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeRun?.id, setRuns, setReport, client]);

  const handleStart = async (targetSymbol = symbol) => {
    if (!targetSymbol || loading || activeRun) return;
    setLoading(true);
    setError(null);
    try {
      const started = await startResearch({ symbol: targetSymbol, strategyId }, client);
      if (started) {
        setRuns((current) => [started, ...current.filter((run) => run.id !== started.id)]);
        // Remember this strategy for the symbol so the next run defaults to it.
        writePersisted(lastStrategyKey(targetSymbol), strategyId);
      } else {
        setError(t('research.notAvailable'));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const handleStrategyChange = (next: StrategyId): void => {
    setStrategyId(next);
    if (symbol) writePersisted(lastStrategyKey(symbol), next);
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    await cancelResearch(activeRun.id, client);
  };

  /** V9: research complete → one-click save as investment thesis. */
  const handleSaveThesis = async () => {
    if (!symbol) return;
    const created = await saveThesisFromReport(symbol, client);
    if (created) {
      setThesisSaved(true);
    } else {
      setError(t('research.notAvailable'));
    }
  };

  /** V9: return to the section the user came from (Discover results / Portfolio). */
  const handleBackToOrigin = (): void => {
    const origin = researchOrigin;
    if (!origin) return;
    setNavSection(origin.from === 'discover' ? 'discover' : 'portfolio');
    setResearchOrigin(null);
  };

  const recoverableRuns = runs.filter((run) => (!symbol ? watchlistMarket(run.symbol) === market : run.symbol === symbol) &&
    (run.status === 'interrupted' || (run.status === 'failed' && run.error)));

  const handleRecovery = async (runId: string, action: 'resume' | 'restart' | 'discard') => {
    setLoading(true);
    setError(null);
    try {
      const method = client.research?.[action];
      if (!method) throw new Error(t('research.notAvailable'));
      const result = await method({ runId });
      if (!result.ok) throw new Error(result.error.message);
      if (action !== 'discard' && result.data) {
        setActiveSymbol((result.data as ResearchRunSummary).symbol);
      }
      setRuns(await loadResearchRuns(client));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setLoading(false); }
  };

  return (
    <div className="felix-pilot-shell flex h-full flex-col" data-testid="research-panel" data-market={market}>
      <div className="felix-research-topbar">
        <span className="felix-research-topbar-title">{t('research.workspace.title')}</span>
        <span className="felix-research-topbar-market">{t('navigation.market' + market)}</span>
      </div>
      <MarketTabs value={market} disabled={loading || Boolean(activeRun)} onChange={(value) => { userSelected.current = true; setMarket(value); setActiveSymbol(null); setReport(null); requestedReport.current = null; setResearchOrigin(null); }} />
      <div className="felix-pilot-research-header">
        <div>
          <h2 className="felix-pilot-research-title">{t('research.deepResearch')}</h2>
          <p className="felix-pilot-subtitle">
            {symbol
              ? t('research.subtitleFor', { symbol })
              : t('research.analysisIntro')}
          </p>
        </div>
        {symbol && (
          <div className="flex items-center gap-2">
            {activeRun && (
              <button
                onClick={() => void handleCancel()}
                className="mac-secondary-button rounded-[8px] px-3 py-1.5 text-[12px] font-semibold"
              >
                {t('research.stop')}
              </button>
            )}
            <button
              onClick={() => void handleStart()}
              disabled={!symbol || loading || Boolean(activeRun)}
              className="mac-primary-button rounded-[8px] px-3 py-1.5 text-[12px] font-semibold disabled:opacity-45"
            >
              {loading ? t('research.starting') : t('research.deepResearch')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-[9px] border border-destructive/24 bg-destructive/6 px-3 py-2.5">
          <p className="text-[12.5px] text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded-[7px] border border-border px-2 py-1 text-[11.5px] font-medium text-foreground/68 hover:bg-foreground/6"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {researchOrigin && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={handleBackToOrigin}
            data-testid="research-back-origin"
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border px-2.5 py-1 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-border-strong hover:text-foreground"
          >
            ← {t('research.backToOrigin', { label: researchOrigin.label })}
          </button>
        </div>
      )}

      <div className="felix-pilot-research-content felix-research-with-history">
        <div className="felix-research-current">
        <ResearchStockPicker market={market} symbols={watchlist.filter((item) => watchlistMarket(item) === market)} disabled={loading || Boolean(activeRun)} onSelect={(value) => { userSelected.current = true; requestedReport.current = null; setActiveSymbol(value); setReport(null); }} />
        {recoverableRuns.map((run) => (
          <div key={run.id} data-testid="research-recovery" className="mb-3 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold">{t('research.recovery.title', { symbol: run.symbol })}</p>
            <p className="mt-1 text-xs text-text-muted">{t('research.recovery.saved', { count: run.completedCapabilities.length })}</p>
            {run.error && <p className="mt-1 text-xs text-destructive">{run.error}</p>}
            <div className="mt-3 flex gap-2">
              {(['resume', 'restart', 'discard'] as const).map((action) => (
                <button key={action} type="button" disabled={loading || Boolean(activeRun) || (action === 'resume' && !run.recoverable)}
                  onClick={() => void handleRecovery(run.id, action)}
                  className="mac-secondary-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-45">
                  {t('research.recovery.' + action)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!symbol && <div className="felix-research-select-empty"><Search size={32} /><h3>{t('research.symbolEntry.title')}</h3><p>{t('research.analysisIntro')}</p></div>}

        {symbol && (
          <ResearchMarketWorkspace
            symbol={symbol}
            report={report && report.symbol === symbol ? report : null}
            activeRun={activeRun?.status ?? null}
            loading={loading}
            onStart={() => void handleStart()}
          />
        )}

        {symbol && !activeRun && (!report || report.symbol !== symbol) && (
          <div className="felix-research-strategy-section">
            <div className="felix-research-section-kicker">{t('research.researchStrategy')}</div>
            <StrategyPicker value={strategyId} onChange={handleStrategyChange} recommendedId={recommendedStrategy} />
          </div>
        )}

        {symbol && !activeRun && report && report.symbol === symbol && (
          <details className="felix-pilot-strategy-context">
            <summary>{t('research.researchStrategy')}</summary>
            <div className="pt-3">
              <StrategyPicker value={strategyId} onChange={handleStrategyChange} recommendedId={recommendedStrategy} />
            </div>
          </details>
        )}

        {activeRun && (
          <RunProgressCard key={activeRun.id} run={activeRun} />
        )}

        {report && symbol && report.symbol === symbol && (
          <ContentReveal testId="research-report-reveal">
            <ResearchReportView
              report={report}
              nextAction={
                thesisSaved ? (
                  <div data-testid="thesis-saved-banner" className="felix-pilot-next-action text-[12.5px] font-medium text-positive">
                    {t('research.next.thesisSaved')}
                  </div>
                ) : (
                  <NextAction
                    testId="research-next-action"
                    primaryLabel={t('research.next.saveThesis')}
                    onPrimary={() => void handleSaveThesis()}
                    secondaryLabel={t('research.next.viewThesis')}
                    onSecondary={() => setNavSection('thesis')}
                    hint={t('research.next.saveThesisHint')}
                  />
                )
              }
            />
          </ContentReveal>
        )}

        </div>
        <aside className="felix-research-history" data-testid="research-history">
          <h3>{t('research.historyTitle')}</h3>
          {historyLoading && <p>{t('research.historyLoading')}</p>}
          <RunHistory runs={runs.filter((run) => watchlistMarket(run.symbol) === market && Boolean(run.reportId))} onSelect={async (reportId) => {
            const run = runs.find((item) => item.reportId === reportId);
            if (!run || activeRun || loading) return;
            userSelected.current = true; requestedReport.current = reportId; setActiveSymbol(run.symbol); setReport(null); selectionRef.current = run.symbol; setHistoryLoading(true);
            try { const loaded = await loadResearchReport(reportId, client); if (loaded && selectionRef.current === loaded.symbol && requestedReport.current === reportId) setReport(loaded); }
            finally { setHistoryLoading(false); }
          }} />
        </aside>
      </div>
    </div>
  );
};

const RunProgressCard: React.FC<{ run: ResearchRunSummary }> = ({ run }) => {
  const { t } = useTranslation();
  const planned = run.plannedCapabilities.length;
  const done = run.completedCapabilities.length;
  const failed = run.failedCapabilities.length;
  const humanized = (id: string): string => {
    return t(semanticCapabilityLabelKey(id));
  };
  return (
    <div className="felix-pilot-progress mb-3">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-foreground">
          {run.status === 'fetching' ? t('research.fetching') : t('research.synthesizing')}
        </span>
        <span className="tnum text-[11px] text-text-muted">
          {t('research.capabilitiesCount', { done, planned })}
          {failed > 0 ? ` ${t('research.failedCount', { failed })}` : ''}
        </span>
      </div>
      <div className="felix-pilot-progress-bar mt-2">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${planned === 0 ? 100 : Math.round((done / planned) * 100)}%` }}
        />
      </div>
      <SemanticStageList run={run} />
      <div className="hidden" aria-hidden="true">
        {run.plannedCapabilities.map((capabilityId) => {
          const doneCap = run.completedCapabilities.includes(capabilityId);
          const failedCap = run.failedCapabilities.includes(capabilityId);
          return (
            <span
              key={capabilityId}
              className={`inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-medium ${
                doneCap
                  ? 'bg-positive/12 text-positive'
                  : failedCap
                    ? 'bg-negative/12 text-negative'
                    : 'bg-foreground/8 text-text-muted'
              }`}
            >
              {doneCap && <Check className="h-2.5 w-2.5" strokeWidth={2.2} />}
              {humanized(capabilityId)}
            </span>
          );
        })}
      </div>
    </div>
  );
};

type ResearchStageKey = 'market' | 'financials' | 'valuation' | 'events' | 'synthesis';
type ResearchStageState = 'pending' | 'active' | 'done' | 'failed';

const RESEARCH_STAGES: ReadonlyArray<{ key: ResearchStageKey }> = [
  { key: 'market' },
  { key: 'financials' },
  { key: 'valuation' },
  { key: 'events' },
  { key: 'synthesis' },
];

function stageForCapability(capabilityId: string): ResearchStageKey {
  if (capabilityId.startsWith('market.')) return 'market';
  if (capabilityId === 'company.valuation') return 'valuation';
  if (capabilityId.startsWith('company.')) return 'financials';
  if (capabilityId.startsWith('research.')) return 'events';
  return 'financials';
}

const SemanticStageList: React.FC<{ run: ResearchRunSummary }> = ({ run }) => {
  const { t } = useTranslation();
  const openStage = RESEARCH_STAGES.find((stage) => {
    const capabilities = run.plannedCapabilities.filter(
      (capabilityId) => stageForCapability(capabilityId) === stage.key
    );
    return capabilities.some(
      (capabilityId) =>
        !run.completedCapabilities.includes(capabilityId) &&
        !run.failedCapabilities.includes(capabilityId)
    );
  })?.key;

  const stateFor = (stage: ResearchStageKey): ResearchStageState => {
    if (stage === 'synthesis' && run.status === 'synthesizing') return 'active';
    const capabilities = run.plannedCapabilities.filter(
      (capabilityId) => stageForCapability(capabilityId) === stage
    );
    if (capabilities.length > 0 && capabilities.every((capabilityId) => run.completedCapabilities.includes(capabilityId))) {
      return 'done';
    }
    if (capabilities.some((capabilityId) => run.failedCapabilities.includes(capabilityId))) {
      return 'failed';
    }
    return openStage === stage ? 'active' : 'pending';
  };

  return (
    <div className="felix-pilot-stage-list" aria-label={t('research.stages.label')}>
      {RESEARCH_STAGES.map((stage) => {
        const state = stateFor(stage.key);
        const marker = state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'active' ? '•' : '·';
        return (
          <div key={stage.key} className={'felix-pilot-stage felix-pilot-stage--' + state}>
            <span className="felix-pilot-stage-marker" aria-hidden="true">{marker}</span>
            <span>{t('research.stages.' + stage.key)}</span>
          </div>
        );
      })}
    </div>
  );
};

const RunHistory: React.FC<{
  runs: ResearchRunSummary[];
  onSelect: (reportId: string) => void;
}> = ({ runs, onSelect }) => {
  const { t } = useTranslation();
  if (runs.length === 0) return <EmptyState />;
  return (
    <div className="flex flex-col gap-1.5">
      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => {
            if (run.reportId) onSelect(run.reportId);
          }}
          className="mac-list-row flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left"
        >
          <span className="text-[12.5px] font-semibold text-foreground">{run.symbol}</span>
          <span className="tnum text-[11px] text-text-muted">
            {t(`research.runStatus.${run.status}`)}
            {run.finishedAt ? ` · ${new Date(run.finishedAt).toLocaleTimeString()}` : ''}
          </span>
        </button>
      ))}
    </div>
  );
};

const EmptyState: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="py-10 text-center text-[12px] text-text-muted">
      {t('research.historyEmpty')}
    </div>
  );
};
