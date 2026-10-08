import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { activeSymbolAtom, watchlistAtom } from '../../atoms';
import { installHappyDom } from '../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest';
import { AssistantWelcome } from './AssistantWelcome';

let restoreDom: (() => void) | undefined;
beforeAll(() => { restoreDom = installHappyDom().restore; });
afterAll(() => restoreDom?.());

describe('AssistantWelcome drafts', () => {
  for (const locale of ['en-US', 'zh-CN'] as const) {
    it(`uses the current symbol and watchlist without running a model (${locale})`, async () => {
      const store = createStore();
      store.set(activeSymbolAtom, '0700.HK');
      store.set(watchlistAtom, ['0700.HK', 'MSFT.US']);
      const drafts: string[] = [];
      const container = document.createElement('div');
      const root = createRoot(container);
      try {
        await act(async () => root.render(<Provider store={store}><I18nextProvider i18n={makeTestI18n(locale)}><AssistantWelcome onPick={(text) => drafts.push(text)} /></I18nextProvider></Provider>));
        expect(container.querySelectorAll('.felix-assistant-questions button').length).toBe(17);
        expect(drafts).toEqual([]);
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="assistant-group-stocks"] button');
        act(() => buttons[1]!.click());
        expect(drafts[0]).toContain('0700.HK');
        act(() => buttons[0]!.click());
        expect(drafts[1]).toContain('0700.HK, MSFT.US');
        // Reading current atoms on the next render avoids inserting a stale focus.
        await act(async () => { store.set(activeSymbolAtom, 'AAPL.US'); });
        act(() => container.querySelectorAll<HTMLButtonElement>('[data-testid="assistant-group-stocks"] button')[1]!.click());
        expect(drafts[2]).toContain('AAPL.US');
        expect(drafts[2]).not.toContain('0700.HK');
      } finally { act(() => root.unmount()); }
    });
  }
  it('asks for missing symbols and holdings rather than inventing them', async () => {
    const store = createStore();
    store.set(watchlistAtom, []);
    const drafts: string[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Provider store={store}><I18nextProvider i18n={makeTestI18n('zh-CN')}><AssistantWelcome onPick={(text) => drafts.push(text)} /></I18nextProvider></Provider>));
      const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="assistant-group-stocks"] button');
      act(() => { buttons[0]!.click(); buttons[1]!.click(); });
      expect(drafts[0]).toContain('暂无自选');
      expect(drafts[1]).toContain('先询问');
      expect(drafts.join(' ')).not.toContain('AAPL.US');
      act(() => container.querySelector<HTMLButtonElement>('[data-testid="assistant-group-research"] button')!.click());
      expect(drafts[2]).toContain('没有持仓');
    } finally { act(() => root.unmount()); }
  });
});
