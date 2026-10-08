import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import type { SessionMeta } from '@finagent/core';
import { sessionsAtom } from '../../atoms';
import { installHappyDom } from '../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest';
import { fallbackClient, FinagentClientProvider } from '../../client';
import { AssistantHistory } from './AssistantHistory';

let restoreDom: (() => void) | undefined;
beforeAll(() => { restoreDom = installHappyDom().restore; });
afterAll(() => restoreDom?.());
const records: SessionMeta[] = [
  { id: 'draft', title: 'Empty draft', createdAt: 1, updatedAt: 9, status: 'idle', messageCount: 0 },
  { id: 'msft', title: 'Earnings research', recentSymbols: ['MSFT.US'], createdAt: 1, updatedAt: 3, status: 'idle', messageCount: 4 },
  { id: 'hk', title: 'Tencent', recentSymbols: ['0700.HK'], createdAt: 1, updatedAt: 4, status: 'idle', messageCount: 2 },
];

describe('Assistant history', () => {
  it('hides empty drafts without removing records and restores the selected conversation', async () => {
    const store = createStore(); store.set(sessionsAtom, records);
    const selected: string[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Provider store={store}><FinagentClientProvider client={fallbackClient}><I18nextProvider i18n={makeTestI18n('zh-CN')}><AssistantHistory busy={false} onSelect={(session) => selected.push(session.id)} /></I18nextProvider></FinagentClientProvider></Provider>));
      expect(container.querySelectorAll('.felix-history-open').length).toBe(2);
      expect(container.textContent).not.toContain('Empty draft');
      act(() => container.querySelector<HTMLButtonElement>('.felix-history-open')!.click());
      expect(selected).toEqual(['hk']);
      expect(store.get(sessionsAtom)).toEqual(records);
    } finally { act(() => root.unmount()); }
  });
  it('disables restoration and deletion during an active run', async () => {
    const store = createStore(); store.set(sessionsAtom, records);
    const container = document.createElement('div'); const root = createRoot(container);
    try {
      await act(async () => root.render(<Provider store={store}><FinagentClientProvider client={fallbackClient}><I18nextProvider i18n={makeTestI18n('zh-CN')}><AssistantHistory busy onSelect={() => { throw new Error('must not select'); }} /></I18nextProvider></FinagentClientProvider></Provider>));
      expect(Array.from(container.querySelectorAll<HTMLButtonElement>('article button')).every((button) => button.disabled)).toBe(true);
    } finally { act(() => root.unmount()); }
  });
});
