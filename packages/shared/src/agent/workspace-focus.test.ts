import { expect, test } from 'bun:test';
import { describeAssistantFocus, parseWorkspaceContext, resolveAssistantFocusData } from './workspace-focus';

test('focus transport accepts bounded identifiers and strips client-supplied owner data', () => {
  expect(parseWorkspaceContext({ focusObjects: [{ kind: 'security', symbol: 'aapl.us' }], focusData: { watchlist: ['forged'] } })).toEqual({ focusObjects: [{ kind: 'security', symbol: 'AAPL.US' }] });
  for (const input of [{ focusObjects: [{ kind: 'admin', symbol: 'AAPL.US' }] }, { activeSymbol: '../../secret' }, { focusObjects: Array.from({ length: 11 }, () => ({ kind: 'portfolio' })) }]) expect(() => parseWorkspaceContext(input)).toThrow();
});
test('cleared focus overrides history and the Shanghai Composite cannot be described as a company', () => {
  expect(describeAssistantFocus({ focusObjects: [] })).toContain('none (the user removed all focus objects)');
  const prompt = describeAssistantFocus({ focusObjects: [{ kind: 'index', symbol: '000001.SH' }] });
  expect(prompt).toContain('index: 000001.SH');
  expect(prompt).toContain('Shanghai Composite (上证指数)');
  expect(prompt).toContain('not 贵州茅台');
});
test('host reads selected owner data only, keeps import costs separate from live prices', async () => {
  let reads = 0;
  const sources = {
    watchlist: async () => { reads++; return { watchlist: ['MSFT.US'] }; },
    portfolios: async () => { reads++; return [{ id: 'p', name: '自己的组合', updatedAt: 12, holdings: [{ symbol: 'AAPL.US', name: 'Apple', quantity: 2, costPrice: 180 }, { symbol: 'MSFT.US', name: 'Microsoft', quantity: 4 }] }]; },
  };
  await resolveAssistantFocusData({ focusObjects: [] }, sources);
  expect(reads).toBe(0);
  const context = await resolveAssistantFocusData({ focusObjects: [{ kind: 'holding', symbol: 'AAPL.US' }, { kind: 'watchlist' }] }, sources);
  expect(context?.focusData?.watchlist).toEqual(['MSFT.US']);
  expect(context?.focusData?.manualPortfolios?.[0]?.holdings).toEqual([{ symbol: 'AAPL.US', quantity: 2, costPrice: 180, currency: undefined }]);
  expect(describeAssistantFocus(context)).toContain('costPrice is historical cost, never a live quote');
});
