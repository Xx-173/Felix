import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Quote } from '@finagent/core';
import { quoteDisplayState } from '../../lib/watchlist';

export const QuoteStatus: React.FC<{ quote: Quote | null; error?: string | null }> = ({ quote, error = null }) => {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(interval); }, []);
  const state = quoteDisplayState(quote, error, now);
  const timestamp = quote?.timestamp && Number.isFinite(quote.timestamp) && quote.timestamp > 0 ? quote.timestamp * 1000 : undefined;
  const source = quote?.source === 'demo' ? t('navigation.quoteDemo') : quote?.provenance?.providerName ?? t('navigation.quoteSourceUnknown');
  return <div className="felix-quote-status" data-state={state} data-testid={`quote-status-${quote?.symbol ?? 'empty'}`}>
    <span className="felix-quote-state">{t('navigation.quoteState' + state[0]!.toUpperCase() + state.slice(1))}</span>
    {quote && <span>{source}</span>}
    {timestamp && <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString(i18n.language)}>{t('navigation.quoteTime')}: {new Date(timestamp).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>}
    {error && <span className="felix-quote-error" title={error}>{error}</span>}
  </div>;
};
