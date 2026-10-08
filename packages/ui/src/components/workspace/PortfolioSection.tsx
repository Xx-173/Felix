import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { PortfolioFailureKind } from '@finagent/core';
import {
  portfolioCacheAtom,
  fetchPortfolioAtom,
  selectedAccountIdAtom,
  portfolioViewAtom,
  selectedPositionAtom,
  activeSymbolAtom,
  isManualAccountId,
  manualAccountId,
  navSectionAtom,
} from '../../atoms';
import { manualPortfoliosAtom, refreshManualPortfoliosAtom } from '../../atoms/portfolioImportAtoms';
import { researchOriginAtom } from '../../atoms/discoverAtoms';
import { useFinagentClient } from '../../client';
import { PortfolioCard } from '../portfolio/PortfolioCard';
import { HoldingRow } from '../portfolio/HoldingRow';
import { ImportDialog } from '../portfolio/ImportDialog';
import { Button } from '../primitives/Button';
import { i18nCurrentLocale } from '@finagent/i18n';

const FAILURE_HEADINGS: Record<PortfolioFailureKind, string> = {
  'not-connected': 'portfolio.failure.notConnected',
  'no-account-permission': 'portfolio.failure.noPermission',
  empty: 'portfolio.failure.empty',
  partial: 'portfolio.failure.partial',
  'provider-error': 'portfolio.failure.providerError',
  'parse-error': 'portfolio.failure.parseError',
  timeout: 'portfolio.failure.timeout',
};

/** Locale-aware `Updated hh:mm:ss` freshness line (spec §34). */
function formatFreshness(t: (k: string, o?: Record<string, unknown>) => string, fetchedAt: number | undefined): string {
  if (fetchedAt === undefined || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return t('portfolio.freshnessUpdatedUnknown');
  }
  const time = new Intl.DateTimeFormat(i18nCurrentLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(fetchedAt);
  return t('portfolio.freshnessUpdated', { time });
}

export const PortfolioSection: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const cache = useAtomValue(portfolioCacheAtom);
  const brokerView = useAtomValue(portfolioViewAtom);
  const fetchPortfolio = useSetAtom(fetchPortfolioAtom);
  const [selectedAccount, setSelectedAccount] = useAtom(selectedAccountIdAtom);
  const setSelectedPosition = useSetAtom(selectedPositionAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const setResearchOrigin = useSetAtom(researchOriginAtom);
  const manualState = useAtomValue(manualPortfoliosAtom);
  const refreshManualPortfolios = useSetAtom(refreshManualPortfoliosAtom);
  const [importOpen, setImportOpen] = useState(false);
  const view = cache.isDemo && !isManualAccountId(selectedAccount) ? null : brokerView;
  useEffect(() => {
    if (cache.isDemo && selectedAccount === null && manualState.portfolios[0]) setSelectedAccount(manualAccountId(manualState.portfolios[0].id));
  }, [cache.isDemo, selectedAccount, manualState.portfolios, setSelectedAccount]);

  useEffect(() => {
    fetchPortfolio(client).catch(() => {
      /* error surfaced via portfolioCacheAtom.failure */
    });
    refreshManualPortfolios(client).catch(() => {
      /* error surfaced via manualPortfoliosAtom.error */
    });
  }, [client, fetchPortfolio, refreshManualPortfolios]);

  if (cache.loading && !view) {
    return (
      <div className="space-y-3 bg-[#f7f8fa] p-4">
        <div className="h-24 animate-pulse rounded-[14px] border border-[var(--mac-border)] bg-white" />
        <div className="h-32 animate-pulse rounded-[14px] border border-[var(--mac-border)] bg-white" />
      </div>
    );
  }

  if (!view) {
    return <div className="felix-portfolio-view space-y-4 overflow-y-auto p-4" data-testid="portfolio-view">
      <div className="flex items-center justify-between"><h2>{t('portfolio.title')}</h2><Button onClick={() => setImportOpen(true)}>{t('portfolio.importButton')}</Button></div>
      <section className="felix-portfolio-summary-card rounded-xl border border-border bg-surface p-5"><h3>{t('portfolio.totalValue')}</h3><strong className="text-3xl">—</strong><p className="mt-3 text-sm text-foreground/60">{t('portfolio.ownAssetsEmpty')}</p>{!cache.isDemo && cache.failure && <p role="alert">{t(FAILURE_HEADINGS[cache.failure.kind])}: {cache.failure.message}</p>}</section>
      <h3>{t('portfolio.holdings')} (0)</h3><p className="text-sm text-foreground/60">{t('portfolio.noHoldingsInAccount')}</p>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => { void refreshManualPortfolios(client).catch(() => {}); }} />
    </div>;
  }

  const handleSelect = (symbol: string) => {
    setSelectedPosition(symbol);
    setActiveSymbol(symbol);
  };

  // V9: position → research continuity (spec §51). Carries position context so
  // the agent and the research panel already know the symbol.
  const handleResearch = (symbol: string) => {
    setSelectedPosition(symbol);
    setActiveSymbol(symbol);
    setResearchOrigin({ from: 'portfolio', label: symbol });
    setNavSection('research');
  };

  const isPartial = cache.failure?.kind === 'partial';
  const brokerAccounts = cache.isDemo ? [] : cache.data?.accounts ?? [];
  const showAccountSelector =
    brokerAccounts.length > 1 || manualState.portfolios.length > 0;
  const freshnessProvider = isManualAccountId(selectedAccount)
    ? t('portfolio.manualPortfolio')
    : 'Longbridge';

  return (
    <div className="felix-portfolio-view space-y-4 overflow-y-auto bg-[#f7f8fa] p-4" data-testid="portfolio-view">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-foreground">{t('portfolio.title')}</h2>
          <div className="mt-1 text-[11px] text-foreground/44">{freshnessProvider}</div>
        </div>
        <Button variant="default" size="sm" onClick={() => setImportOpen(true)}>
          {t('portfolio.importButton')}
        </Button>
      </div>

      {showAccountSelector && (
        <label className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--mac-border)] bg-white px-3 py-2 text-[12px] text-foreground/54">
          {t('portfolio.account')}
          <select
            value={selectedAccount ?? ''}
            onChange={(e) => setSelectedAccount(e.target.value === '' ? null : e.target.value)}
            className="rounded-[8px] border border-[var(--mac-border)] bg-white px-2 py-1 text-[12px] text-foreground outline-none focus:border-[var(--mac-blue)]"
          >
            {!cache.isDemo && <option value="">{t('portfolio.allAccounts')}</option>}
            {brokerAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency ?? '—'})
              </option>
            ))}
            {manualState.portfolios.map((portfolio) => (
              <option key={portfolio.id} value={manualAccountId(portfolio.id)}>
                {portfolio.name} ({t('portfolio.manual')})
              </option>
            ))}
          </select>
        </label>
      )}

      {isPartial && (
        <div className="rounded-[10px] border border-[var(--mac-yellow)]/20 bg-[var(--mac-yellow)]/12 px-3 py-2 text-[12px] text-foreground/80">
          {cache.failure?.message}
        </div>
      )}

      <PortfolioCard view={view} />

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-foreground/48">
          {t('portfolio.holdings')} ({view.holdings.length})
        </h3>
        <div className="space-y-2">
          {view.holdings.map((holding) => (
            <HoldingRow
              key={holding.symbol}
              holding={holding}
              onClick={() => handleSelect(holding.symbol)}
              onResearch={() => handleResearch(holding.symbol)}
            />
          ))}
          {view.holdings.length === 0 && (
            <div className="py-8 text-center text-[13px] text-foreground/44">
              {t('portfolio.noHoldingsInAccount')}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--mac-border)]/70 bg-white/60 px-3 py-2 text-[11px] text-foreground/44">
        {freshnessProvider} · {formatFreshness(t, view.snapshot.fetchedAt)}
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void refreshManualPortfolios(client).catch(() => {})
        }}
      />
    </div>
  );
};
