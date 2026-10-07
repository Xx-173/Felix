import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { AppShell } from '@finagent/ui';
import { navSectionAtom } from '../../../packages/ui/src/atoms';
import { createWebClient } from './client';
import '../../../packages/ui/src/styles/app.css';
import './web.css';

const root = createRoot(document.getElementById('root')!);
const store = createStore();
store.set(navSectionAtom, 'today');
root.render(<div role="status" style={{ padding: 32 }}>正在连接 Felix…</div>);
void createWebClient().then((client) => {
  root.render(<React.StrictMode><Provider store={store}><AppShell client={client} /></Provider></React.StrictMode>);
}).catch((error: Error) => {
  root.render(<main style={{ padding: 32 }}><h1>Felix 暂时无法连接</h1><p>{error.message}</p><button onClick={() => window.location.reload()}>重新连接</button></main>);
});
