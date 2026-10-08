import React, { useEffect, useState } from 'react';
import { Flame, RefreshCw } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { LimitLadderSnapshot } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { DemoBadge } from '../primitives/DemoBadge';
import { formatMarketPrice } from '../../lib/watchlist';

const chinaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function LimitUpLadder({ market }: { market: string }) {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const select = useSetAtom(activeSymbolAtom), navigate = useSetAtom(navSectionAtom);
  const [date, setDate] = useState(chinaDate);
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<'auto' | 'live'>('auto');
  const [snapshot, setSnapshot] = useState<LimitLadderSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (market !== 'CN') return;
    let alive = true;
    setSnapshot(null); setError(null); setLoading(true);
    void (async () => {
      try {
        if (!client.market.getLimitUpLadder) throw new Error(t('discover.ladderUnavailable'));
        const result = await client.market.getLimitUpLadder(date, mode);
        if (!result.ok) throw new Error(result.error.message);
        if (alive) setSnapshot(result.data);
      } catch (caught) { if (alive) setError(caught instanceof Error ? caught.message : t('discover.ladderUnavailable')); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [client, market, date, mode, reload, t]);
  const stocks = snapshot?.stocks ?? [];
  const levels = [...new Set(stocks.map((stock) => stock.boards))].sort((a, b) => b - a);
  return <section className="felix-limit-ladder" data-testid="limit-up-ladder" data-market={market}>
    <header><h2><Flame size={18} />{t('discover.ladderTitle')}</h2>{market === 'CN' && <div><button type="button" aria-pressed={mode === 'live'} onClick={() => setMode((current) => current === 'live' ? 'auto' : 'live')}>{t(mode === 'live' ? 'discover.ladderOnline' : 'discover.ladderFetchOnline')}</button><input type="date" value={date} max={chinaDate()} aria-label={t('discover.ladderDate')} onChange={(event) => setDate(event.target.value)} /><button type="button" disabled={loading} aria-label={t('discover.ladderRefresh')} onClick={() => setReload((value) => value + 1)}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{t('discover.ladderRefresh')}</button></div>}</header>
    {market !== 'CN' ? <p className="felix-ladder-state">{t('discover.ladderNotApplicable')}</p> : <>
      <p className="felix-ladder-scope">{t('discover.ladderScope')}</p>
      {loading ? <p className="felix-ladder-state">{t('common.loading')}</p> : error ? <p className="felix-ladder-state" role="alert">{error}</p> : snapshot && <>
        <div className="felix-ladder-summary">{snapshot.source === 'demo' && <DemoBadge />}<span>{snapshot.date}</span><span>{snapshot.source === 'demo' ? t('navigation.quoteDemo') : t('discover.ladderSource')}</span><span>{t('discover.ladderCount', { count: stocks.length })}</span><time>{t('research.workspace.lastUpdated')} {new Date(snapshot.fetchedAt).toLocaleTimeString()}</time></div>
        {levels.length === 0 ? <p className="felix-ladder-state">{t('discover.ladderEmpty')}</p> : levels.map((boards) => <details key={boards} open className="felix-ladder-tier"><summary>{t(boards === 1 ? 'discover.ladderFirst' : 'discover.ladderBoards', { count: boards })}<small>{stocks.filter((stock) => stock.boards === boards).length}</small></summary><div>{stocks.filter((stock) => stock.boards === boards).map((stock) => <button key={stock.symbol} type="button" onClick={() => { select(stock.symbol); navigate('research'); }}><strong>{stock.name}</strong><code>{stock.symbol}</code><span>{formatMarketPrice(stock.price, stock.symbol)} <b>{stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%</b></span>{stock.industry && <small>{stock.industry}</small>}</button>)}</div></details>)}
      </>}
    </>}
  </section>;
}
