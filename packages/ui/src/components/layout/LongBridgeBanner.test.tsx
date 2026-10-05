import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import type { ApiResult, LongBridgeStatus } from '@finagent/core';
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../../client';
import type { ConnectionEntry } from '../../client/connections';
import { navSectionAtom, settingsTabAtom } from '../../atoms';
import { installHappyDom } from '../../test/setupHappyDom';
import { I18nextProvider, makeTestI18n } from '../../test/i18nTest';
import { LongBridgeBanner } from './LongBridgeBanner';

let restore: (() => void) | undefined;
beforeAll(() => { restore = installHappyDom().restore; });
afterAll(() => restore?.());

const ready: ApiResult<LongBridgeStatus> = {
  ok: true, data: { installed: true, authenticated: true, available: true, status: 'available', message: 'ready' },
};
const unavailable: ApiResult<LongBridgeStatus> = {
  ok: true, data: { installed: true, authenticated: false, available: false, status: 'not_authed', message: 'RAW STDERR secret=should-not-display' },
};

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function render(client: FinagentClient, locale: 'en-US' | 'zh-CN' = 'en-US') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const store = createStore();
  await act(async () => root.render(
    <Provider store={store}><I18nextProvider i18n={makeTestI18n(locale)}>
      <FinagentClientProvider client={client}><LongBridgeBanner /></FinagentClientProvider>
    </I18nextProvider></Provider>
  ));
  await settle();
  return {
    container, store,
    dispose: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

describe('LongBridgeBanner recovery', () => {
  it('handles rejected IPC safely and lets retry clear the banner', async () => {
    let calls = 0;
    const view = await render({ ...fallbackClient, longbridge: { getStatus: async () => {
      if (++calls === 1) throw new Error('RAW STDERR secret=should-not-display');
      return ready;
    } } });
    expect(view.container.textContent).toContain('status could not be checked');
    expect(view.container.textContent).not.toContain('RAW STDERR');
    const retry = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent === 'Retry')!;
    await act(async () => retry.click());
    await settle();
    expect(calls).toBe(2);
    expect(view.container.querySelector('[role="status"]')).toBeNull();
    await view.dispose();
  });

  it('localizes authorization guidance and opens connection settings', async () => {
    const view = await render({ ...fallbackClient, longbridge: { getStatus: async () => unavailable } }, 'zh-CN');
    expect(view.container.textContent).toContain('尚未登录');
    expect(view.container.textContent).not.toContain('RAW STDERR');
    const settings = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent === '打开连接设置')!;
    await act(async () => settings.click());
    expect(view.store.get(navSectionAtom)).toBe('settings');
    expect(view.store.get(settingsTabAtom)).toBe('connections');
    await view.dispose();
  });

  it('refreshes on connection changes and ignores an older probe completing late', async () => {
    let notify: ((entries: ConnectionEntry[]) => void) | undefined;
    let finishOld: ((result: ApiResult<LongBridgeStatus>) => void) | undefined;
    let calls = 0;
    let unsubscribed = false;
    const view = await render({
      ...fallbackClient,
      connections: { ...fallbackClient.connections!, onChanged: (callback) => {
        notify = callback; return () => { unsubscribed = true; };
      } },
      longbridge: { getStatus: async () => ++calls === 1 ? new Promise((resolve) => { finishOld = resolve; }) : ready },
    });
    await act(async () => notify!([]));
    await settle();
    await act(async () => finishOld!(unavailable));
    await settle();
    expect(calls).toBe(2);
    expect(view.container.querySelector('[role="status"]')).toBeNull();
    await view.dispose();
    expect(unsubscribed).toBe(true);
  });

  it('uses safe guidance for failed envelopes and unknown status values', async () => {
    for (const result of [
      { ok: false, error: { code: 'BROKEN', message: 'RAW STDERR' } },
      { ...unavailable, data: { ...(unavailable as { data: LongBridgeStatus }).data, status: 'unexpected' } },
    ] as ApiResult<LongBridgeStatus>[]) {
      const view = await render({ ...fallbackClient, longbridge: { getStatus: async () => result } });
      expect(view.container.textContent).toContain('status could not be checked');
      expect(view.container.textContent).not.toContain('RAW STDERR');
      await view.dispose();
    }
  });
});
