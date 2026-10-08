import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Plus, X, Link2 } from 'lucide-react';
import type { AssistantFocus } from '@finagent/core';
import { assistantFocusAtom, assistantFocusOverridesAtom, watchlistAtom, portfolioCacheAtom, fetchPortfolioAtom } from '../../atoms';
import { manualPortfoliosAtom, refreshManualPortfoliosAtom } from '../../atoms/portfolioImportAtoms';
import { useFinagentClient } from '../../client';
import { symbolFocus } from '../../atoms/assistantFocusAtoms';
import { DASHBOARD_INDICES } from '../../lib/market-dashboard';
import { WATCHLIST_SYMBOL_PATTERN } from '../../lib/watchlist';
import { Dialog } from '../primitives/Dialog';
import { Button } from '../primitives/Button';

const focusId = (focus: AssistantFocus) => focus.kind + ('symbol' in focus ? ':' + focus.symbol : '');

/** The assistant's scope can follow the page or remain explicitly selected. */
export const ContextChip: React.FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  const { t } = useTranslation();
  const focus = useAtomValue(assistantFocusAtom);
  const [overrides, setOverrides] = useAtom(assistantFocusOverridesAtom);
  const watchlist = useAtomValue(watchlistAtom);
  const client = useFinagentClient();
  const portfolioCache = useAtomValue(portfolioCacheAtom);
  const manual = useAtomValue(manualPortfoliosAtom);
  const fetchPortfolio = useSetAtom(fetchPortfolioAtom);
  const fetchManual = useSetAtom(refreshManualPortfoliosAtom);
  const holdings = [...new Set([...manual.portfolios.flatMap((portfolio) => portfolio.holdings.map((holding) => holding.symbol)),
    ...(portfolioCache.isDemo ? [] : portfolioCache.data?.holdings.map((holding) => holding.symbol) ?? [])])];
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const indices = Object.values(DASHBOARD_INDICES).flat();
  const label = (item: AssistantFocus) => {
    if (!('symbol' in item)) return t(`agent.context.${item.kind}`);
    const index = indices.find((entry) => entry.symbol === item.symbol);
    return index ? `${t('navigation.' + index.key)} · ${item.symbol}` : `${item.kind === 'holding' ? t('agent.context.holding') + ' · ' : ''}${item.symbol}`;
  };
  const add = (item: AssistantFocus) => {
    if (disabled) return;
    if (focus.some((entry) => focusId(entry) === focusId(item))) { setError(t('agent.context.alreadyAdded')); return; }
    if (focus.length >= 10) { setError(t('agent.context.limit')); return; }
    setOverrides([...focus, item]); setError(''); setCode('');
  };
  return <div className="felix-focus-selector" data-testid="context-chip">
    <div className="felix-focus-chips">
      {focus.length === 0 && <span className="felix-focus-empty">{t('agent.context.none')}</span>}
      {focus.map((item) => <span className="felix-focus-chip" data-testid={`assistant-focus-${focusId(item)}`} key={focusId(item)}><span>{label(item)}</span><button type="button" disabled={disabled} aria-label={t('agent.context.remove', { name: label(item) })} onClick={() => setOverrides(focus.filter((entry) => focusId(entry) !== focusId(item)))}><X size={12} /></button></span>)}
      <button type="button" className="felix-focus-add" data-testid="assistant-focus-add" disabled={disabled} aria-label={t('agent.context.add')} onClick={() => { setOpen(true); setError(''); void fetchPortfolio(client).catch(() => undefined); void fetchManual(client).catch(() => undefined); }}><Plus size={13} />{t('agent.context.add')}</button>
      <button type="button" className="felix-focus-follow" data-testid="assistant-focus-follow" aria-pressed={overrides === null} disabled={disabled} title={t('agent.context.followHint')} onClick={() => setOverrides(null)}><Link2 size={13} />{t('agent.context.follow')}</button>
    </div>
    <Dialog open={open} onClose={() => setOpen(false)} title={t('agent.context.addTitle')} className="max-h-[85vh] overflow-y-auto">
      <p className="mb-4 text-sm text-text-muted">{t('agent.context.hint')}</p>
      <form className="felix-focus-symbol-form" onSubmit={(event) => { event.preventDefault(); const symbol = code.trim().toUpperCase(); if (!WATCHLIST_SYMBOL_PATTERN.test(symbol)) { setError(t('agent.context.invalidSymbol')); return; } add(symbolFocus(symbol)); }}>
        <input aria-label={t('agent.context.symbol')} placeholder="600519.SH / 0700.HK / AAPL.US" value={code} onChange={(event) => setCode(event.target.value)} maxLength={24} />
        <Button type="submit" disabled={disabled}>{t('agent.context.addSymbol')}</Button>
      </form>
      <div className="felix-focus-options">
        {(['portfolio', 'holdings', 'watchlist'] as const).map((kind) => <button type="button" disabled={disabled} key={kind} onClick={() => add({ kind })}>{t(`agent.context.${kind}`)}</button>)}
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold">{t('agent.context.fromWatchlist')}</h3>
      <div className="felix-focus-options">{watchlist.map((symbol) => <button type="button" disabled={disabled} key={symbol} onClick={() => add(symbolFocus(symbol))}>{symbol}</button>)}</div>
      <h3 className="mt-5 mb-2 text-sm font-semibold">{t('agent.context.fromHoldings')}</h3>
      <div className="felix-focus-options">{holdings.map((symbol) => <button type="button" disabled={disabled} key={symbol} onClick={() => add(symbolFocus(symbol, true))}>{symbol}</button>)}</div>
      {holdings.length === 0 && <p className="text-xs text-text-muted">{t('agent.context.noHoldings')}</p>}
      <h3 className="mt-5 mb-2 text-sm font-semibold">{t('agent.context.indices')}</h3>
      <div className="felix-focus-options">{indices.map((index) => <button type="button" disabled={disabled} key={index.symbol} onClick={() => add(symbolFocus(index.symbol))}>{t('navigation.' + index.key)}</button>)}</div>
      {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}
      <div className="mt-5 flex justify-end"><Button variant="outline" onClick={() => setOpen(false)}>{t('agent.context.done')}</Button></div>
    </Dialog>
  </div>;
};
