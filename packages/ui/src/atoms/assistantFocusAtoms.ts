import { atom } from 'jotai';
import type { AssistantFocus, WorkspaceContext } from '@finagent/core';
import { activeSymbolAtom, activeIndexSymbolAtom, navSectionAtom, selectedPositionAtom, activeViewAtom } from './workspaceAtoms';
import { compareSymbolsAtom } from './compareAtoms';
import { DASHBOARD_INDICES } from '../lib/market-dashboard';

export const assistantFocusOverridesAtom = atom<AssistantFocus[] | null>(null);
export function symbolFocus(symbol: string, holding = false): AssistantFocus {
  return { kind: holding ? 'holding' : Object.values(DASHBOARD_INDICES).flat().some((index) => index.symbol === symbol) ? 'index' : 'security', symbol };
}
export const assistantFocusAtom = atom((get): AssistantFocus[] => {
  const overrides = get(assistantFocusOverridesAtom);
  if (overrides !== null) return overrides;
  const section = get(navSectionAtom);
  if (section === 'indices') return [symbolFocus(get(activeIndexSymbolAtom))];
  if (section === 'portfolio') {
    const position = get(selectedPositionAtom);
    return position ? [symbolFocus(position, true)] : [{ kind: 'portfolio' }];
  }
  if (section === 'compare') return get(compareSymbolsAtom).map((symbol) => symbolFocus(symbol));
  if (['today', 'workspace', 'discover', 'sessions'].includes(section)) return [{ kind: 'watchlist' }];
  const symbol = get(activeSymbolAtom);
  return symbol ? [symbolFocus(symbol)] : [];
});
export const assistantWorkspaceContextAtom = atom((get): WorkspaceContext => {
  const focusObjects = get(assistantFocusAtom);
  const symbols = focusObjects.filter((focus): focus is Extract<AssistantFocus, { symbol: string }> => 'symbol' in focus).map((focus) => focus.symbol);
  const position = focusObjects.find((focus) => focus.kind === 'holding');
  return {
    focusObjects,
    activeView: focusObjects.some((focus) => ['portfolio', 'holdings', 'holding'].includes(focus.kind)) ? 'portfolio' : get(activeViewAtom),
    ...(symbols.length > 0 ? { activeSymbol: symbols[0] } : {}),
    ...(symbols.length > 1 ? { comparisonSymbols: symbols } : {}),
    ...(position && 'symbol' in position ? { selectedPosition: position.symbol } : {}),
  };
});
