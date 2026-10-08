import { afterAll, beforeAll, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import type { Quote } from '@finagent/core';
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client';
import { installHappyDom } from '../../test/setupHappyDom';
import { makeTestI18n, I18nextProvider } from '../../test/i18nTest';
import { watchlistAtom } from '../../atoms';
import { MarketDashboard } from './MarketDashboard';

let restore: () => void;
beforeAll(() => { restore = installHappyDom().restore; });
afterAll(() => restore());
const flush = async () => { for (let index = 0; index < 8; index++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
it('switches market requests and observation scope, leaving unavailable market-wide totals unknown', async () => {
  const requested: string[] = [], sentimentMarkets: string[] = [];
  const store = createStore();
  store.set(watchlistAtom, ['600519.SH', '0700.HK', 'AAPL.US']);
  const client: FinagentClient = { ...fallbackClient, market: { ...fallbackClient.market,
    getQuote: async (symbol) => { requested.push(symbol); return { ok: true, data: { symbol, lastPrice: 100, changePercent: symbol === '600519.SH' ? 2 : -3, timestamp: Math.floor(Date.now() / 1000) } as Quote }; },
    getMarketStatus: async () => ({ ok: true, data: [] }),
    getMarketTemperature: async (market) => { sentimentMarkets.push(market); return { ok: true, data: { market, temperature: 60, valuation: 55, sentiment: 65, description: 'fixture' } }; },
  } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Provider store={store}><I18nextProvider i18n={makeTestI18n('zh-CN')}><FinagentClientProvider client={client}><MarketDashboard /></FinagentClientProvider></I18nextProvider></Provider>));
    await flush();
    expect(container.querySelector('[data-market=CN]')).not.toBeNull();
    expect(requested).toContain('000001.SH');
    expect(requested).not.toContain('HSI.HK');
    expect(container.textContent).toContain('仅统计当前市场的自选股');
    expect(container.textContent).toContain('当前数据源暂不提供全市场统计');
    expect(container.querySelector('.felix-dashboard-rankings')?.textContent).toContain('600519.SH');
    for (const market of ['HK', 'US']) {
      await act(async () => (container.querySelector(`#market-tab-${market}`) as HTMLButtonElement).click());
      await flush();
      expect(container.querySelector(`[data-market=${market}]`)).not.toBeNull();
    }
    expect(requested).toContain('HSI.HK'); expect(requested).toContain('SPX.US');
    expect(sentimentMarkets).toEqual(['CN', 'HK', 'US']);
    const ranking = container.querySelector('.felix-dashboard-rankings')?.textContent ?? '';
    expect(ranking).toContain('AAPL.US'); expect(ranking).not.toContain('0700.HK');
    expect(container.textContent).not.toContain('NaN');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
