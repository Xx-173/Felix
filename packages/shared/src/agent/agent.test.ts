import { describe, expect, it } from 'bun:test';
import type { Kline, PortfolioSnapshot, Quote } from '@finagent/core';
import { LocalFinanceAgentBackend } from './local-finance-agent-backend.ts';
import { MarketDataService } from './market-data-service.ts';
import { routeFinanceIntent } from './intent-router.ts';

const quote: Quote = {
  symbol: 'AAPL.US',
  lastPrice: 200,
  change: 3,
  changePercent: 1.5,
  volume: 1234,
  timestamp: 1710000000,
  high: 203,
  low: 198,
  open: 199,
  prevClose: 197,
};

const kline: Kline = {
  symbol: 'AAPL.US',
  timestamp: 1710000000,
  open: 198,
  high: 203,
  low: 197,
  close: 200,
  volume: 4567,
};

const klineDown: Kline = {
  ...kline,
  timestamp: 1710086400,
  close: 194,
};

const klineUp: Kline = {
  ...kline,
  timestamp: 1710172800,
  close: 202,
};

const portfolio: PortfolioSnapshot = {
  baseCurrency: 'USD',
  totalAssets: 10000,
  cash: 1500,
  accounts: [],
  holdings: [
    {
      symbol: 'AAPL.US',
      name: 'Apple',
      currency: 'USD',
      quantity: 10,
      costPrice: 180,
      marketPrice: 200,
      marketValue: 2000,
      marketValueBase: 2000,
      unrealizedPnL: 200,
      unrealizedPnLPercent: 11.11,
    },
  ],
  fetchedAt: 0,
};

describe('routeFinanceIntent', () => {
  it('routes explicit quote requests', () => {
    expect(routeFinanceIntent('AAPL.US quote')).toMatchObject({
      intent: 'quote',
      symbol: 'AAPL.US',
    });
  });

  it('uses recent session symbol for follow-up chart requests', () => {
    expect(routeFinanceIntent('看下走势', {
      id: 's1',
      recentSymbols: ['TSLA.US'],
      toolCalls: [],
    })).toMatchObject({
      intent: 'kline',
      symbol: 'TSLA.US',
    });
  });

  it('routes unsupported input to a friendly boundary', () => {
    expect(routeFinanceIntent('hello')).toMatchObject({
      intent: 'unsupported',
    });
  });

  it('routes portfolio risk requests to multi-step analysis', () => {
    expect(routeFinanceIntent('分析我的组合风险')).toMatchObject({
      intent: 'portfolio_risk',
    });
  });
});

describe('MarketDataService', () => {
  it('refreshes a cached unavailable status after login and coalesces concurrent probes', async () => {
    let authed = false;
    let calls = 0;
    const service = new MarketDataService({ fetchers: {
      getLongBridgeStatus: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { installed: true, authed, available: authed, status: authed ? 'available' : 'not_authed' };
      },
    } });
    expect((await service.getLongBridgeStatus()).available).toBe(false);
    authed = true;
    expect((await service.getLongBridgeStatus()).available).toBe(false);
    const results = await Promise.all([service.getLongBridgeStatus({ refresh: true }), service.getLongBridgeStatus({ refresh: true })]);
    expect(results.every((status) => status.available)).toBe(true);
    expect(calls).toBe(2);
    expect((await service.getLongBridgeStatus()).available).toBe(true);
  });

  it('caches quote results within the TTL', async () => {
    let calls = 0;
    let now = 1_000;
    const service = new MarketDataService({
      quoteTTL: 1_000,
      now: () => now,
      fetchers: {
        getQuote: async () => {
          calls += 1;
          return quote;
        },
      },
    });

    await service.getQuote('AAPL.US');
    await service.getQuote('AAPL.US');
    now = 2_001;
    await service.getQuote('AAPL.US');

    expect(calls).toBe(2);
  });

  it('coalesces concurrent quote requests for the same symbol', async () => {
    let calls = 0;
    const service = new MarketDataService({
      fetchers: {
        getQuote: async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return quote;
        },
      },
    });

    const [first, second] = await Promise.all([
      service.getQuote('AAPL.US'),
      service.getQuote('AAPL.US'),
    ]);

    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });
});

describe('LocalFinanceAgentBackend', () => {
  it('uses imported focus records instead of demo assets for the user portfolio', async () => {
    const backend = new LocalFinanceAgentBackend({ demoData: true });
    const result = await backend.send({ sessionId: 'own-assets', content: '分析我的组合风险', context: {
      focusObjects: [{ kind: 'portfolio' }], focusData: { manualPortfolios: [{ name: '自己的组合', updatedAt: 12, holdings: [{ symbol: 'AAPL.US', quantity: 12, costPrice: 180.5 }] }] },
    } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.answer).toContain('自己的组合');
    expect(result.data.answer).toContain('成本价 180.5');
    expect(result.data.answer).toContain('成本价不代表当前行情');
    expect(result.data.toolCalls).toEqual([]);
    const empty = await backend.send({ sessionId: 'own-assets', content: '我的持仓', context: { focusObjects: [{ kind: 'holdings' }], focusData: { manualPortfolios: [] } } });
    expect(empty.ok && empty.data.answer).toContain('尚未读取到你的实际持仓');
  });
  it('does not route a cleared focus back to the previous stock', async () => {
    const backend = createBackend();
    await backend.send({ sessionId: 'focus-clear', content: 'AAPL.US quote' });
    const result = await backend.send({ sessionId: 'focus-clear', content: '看下走势', context: { focusObjects: [] } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.toolName).toBeUndefined();
    expect(result.data.toolCalls ?? []).toHaveLength(0);
  });
  it('answers quote requests and records session context', async () => {
    const backend = createBackend();

    const result = await backend.send({
      sessionId: 's1',
      content: 'AAPL.US quote',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const response = result.data;

    expect(response.toolName).toBe('get_quote');
    expect(response.content).toContain('AAPL.US');
    expect(response.session?.recentSymbols).toEqual(['AAPL.US']);
    expect(response.toolCalls?.[0]).toMatchObject({
      toolName: 'get_quote',
      status: 'success',
      args: { symbol: 'AAPL.US' },
    });
  });

  it('uses session symbol for follow-up kline requests', async () => {
    const backend = createBackend();

    await backend.send({ sessionId: 's1', content: 'AAPL.US quote' });
    const result = await backend.send({ sessionId: 's1', content: '看下走势' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const response = result.data;
    expect(response.toolName).toBe('get_kline');
    expect(response.content).toContain('AAPL.US K-Line');
  });

  it('returns the MVP boundary for unsupported requests', async () => {
    const backend = createBackend();

    const result = await backend.send({ sessionId: 'default', content: 'hello' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const response = result.data;
    expect(response.content).toContain('当前为规则分析模式');
    expect(response.toolName).toBeUndefined();
  });

  it('analyzes portfolio risk with portfolio, quote, and kline tool calls', async () => {
    const backend = createBackend();

    const result = await backend.send({ sessionId: 's1', content: '分析我的组合风险' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.answer).toContain('Portfolio Risk Summary');
    expect(result.data.toolCalls?.map((toolCall) => toolCall.toolName)).toEqual([
      'get_portfolio',
      'get_quote',
      'get_kline',
    ]);
    expect(result.data.sessionSnapshot.recentSymbols).toEqual(['AAPL.US']);
    expect(result.data.trace).toHaveLength(3);
  });
});

function createBackend() {
  const marketData = new MarketDataService({
    fetchers: {
      getQuote: async () => quote,
      getKline: async () => [kline, klineDown, klineUp],
      getPortfolio: async () => portfolio,
      getIntraday: async () => [],
      getLongBridgeStatus: async () => ({
        installed: true,
        authed: true,
        available: true,
        status: 'available',
      }),
    },
  });

  return new LocalFinanceAgentBackend({ marketData, now: () => 1710000000000 });
}
