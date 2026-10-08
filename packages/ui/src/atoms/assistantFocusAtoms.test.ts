import { describe, expect, it } from 'bun:test';
import { createStore } from 'jotai';
import { assistantFocusAtom, assistantFocusOverridesAtom, assistantWorkspaceContextAtom } from './assistantFocusAtoms';
import { activeSymbolAtom, activeIndexSymbolAtom, navSectionAtom, selectedPositionAtom } from './workspaceAtoms';

describe('assistant focus scope', () => {
  it('follows a stock detail page and returns to the whole watchlist on its overview', () => {
    const store = createStore();
    store.set(navSectionAtom, 'watchlist');
    store.set(activeSymbolAtom, 'AAPL.US');
    expect(store.get(assistantFocusAtom)).toEqual([{ kind: 'security', symbol: 'AAPL.US' }]);
    store.set(navSectionAtom, 'workspace');
    expect(store.get(assistantFocusAtom)).toEqual([{ kind: 'watchlist' }]);
  });
  it('keeps manual selections across navigation without changing page selection', () => {
    const store = createStore();
    store.set(navSectionAtom, 'indices');
    store.set(activeIndexSymbolAtom, '000001.SH');
    expect(store.get(assistantFocusAtom)).toEqual([{ kind: 'index', symbol: '000001.SH' }]);
    store.set(assistantFocusOverridesAtom, [{ kind: 'security', symbol: 'AAPL.US' }, { kind: 'holdings' }]);
    store.set(navSectionAtom, 'portfolio');
    expect(store.get(assistantWorkspaceContextAtom)).toMatchObject({ activeSymbol: 'AAPL.US', activeView: 'portfolio' });
    expect(store.get(activeIndexSymbolAtom)).toBe('000001.SH');
    expect(store.get(activeSymbolAtom)).toBeNull();
    store.set(assistantFocusOverridesAtom, null);
    expect(store.get(assistantFocusAtom)).toEqual([{ kind: 'portfolio' }]);
    store.set(selectedPositionAtom, '0700.HK');
    expect(store.get(assistantFocusAtom)).toEqual([{ kind: 'holding', symbol: '0700.HK' }]);
  });
  it('explicitly cleared scope removes stale symbols and positions from the next request', () => {
    const store = createStore();
    store.set(activeSymbolAtom, 'MSFT.US');
    store.set(selectedPositionAtom, 'MSFT.US');
    store.set(assistantFocusOverridesAtom, []);
    expect(store.get(assistantWorkspaceContextAtom)).toEqual({ focusObjects: [], activeView: 'overview' });
    store.set(navSectionAtom, 'indices');
    expect(store.get(assistantFocusAtom)).toEqual([]);
  });
  it('uses all selected symbols for comparisons', () => {
    const store = createStore();
    store.set(assistantFocusOverridesAtom, [{ kind: 'security', symbol: 'AAPL.US' }, { kind: 'holding', symbol: '0700.HK' }]);
    expect(store.get(assistantWorkspaceContextAtom)).toMatchObject({ comparisonSymbols: ['AAPL.US', '0700.HK'], selectedPosition: '0700.HK' });
  });
});
