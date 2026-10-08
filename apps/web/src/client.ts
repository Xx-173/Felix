import type { AgentEvent, ApiResult, StreamEvent } from '@finagent/core';
import type { FinagentClient } from '@finagent/ui';

type Bootstrap = { deployment: NonNullable<FinagentClient['deployment']>; workspaceId: string };
async function rpc<T>(method: string, ...args: unknown[]): Promise<ApiResult<T>> {
  try {
    const response = await fetch('/api/rpc', {
      method: 'POST', credentials: 'same-origin', keepalive: method === 'workspace.update',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }),
    });
    return await response.json() as ApiResult<T>;
  } catch {
    return { ok: false, error: { code: 'WEB_CONNECTION_FAILED', message: '无法连接 Felix 后端，请检查服务是否启动。' } };
  }
}

/** Every channel maps to a validated server method; secrets never live here. */
function channel<T>(name: string): T {
  return new Proxy({}, { get: (_, method) => (...args: unknown[]) => rpc(`${name}.${String(method)}`, ...args) }) as T;
}

async function adminRequest(action: string, input?: unknown) {
  try {
    return await (await fetch('/api/admin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, input }) })).json();
  } catch { return { ok: false, error: { code: 'WEB_CONNECTION_FAILED', message: '连接失败，请稍后重试。' } }; }
}

export async function createWebClient(): Promise<FinagentClient> {
  const bootstrap = await rpc<Bootstrap>('bootstrap');
  if (!bootstrap.ok) throw new Error(bootstrap.error.message);
  const agents = new Set<(event: AgentEvent) => void>();
  const streams = new Set<(payload: { sessionId: string; event: StreamEvent }) => void>();
  const source = new EventSource('/api/events');
  source.addEventListener('reset', () => window.location.reload());
  source.addEventListener('connected', (event) => {
    const workspaceId = JSON.parse((event as MessageEvent).data).workspaceId;
    if (workspaceId !== bootstrap.data.workspaceId) window.location.reload();
  });
  source.addEventListener('agent', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as AgentEvent;
    agents.forEach((callback) => callback(data));
  });
  source.addEventListener('stream', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { sessionId: string; event: StreamEvent };
    streams.forEach((callback) => callback(data));
  });
  const connected = () => new Promise<void>((resolve, reject) => {
    if (source.readyState === EventSource.OPEN) { resolve(); return; }
    const cleanup = () => { clearTimeout(timer); source.removeEventListener('open', open); };
    const open = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Event stream unavailable')); }, 12000);
    source.addEventListener('open', open, { once: true });
  });
  window.addEventListener('pagehide', () => source.close(), { once: true });
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
  return {
    deployment: bootstrap.data.deployment,
    workspace: channel('workspace'),
    account: { request: async (action, input) => {
      try { return await (await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, input }) })).json(); }
      catch { return { ok: false, error: { code: 'WEB_CONNECTION_FAILED', message: '连接失败，请稍后重试。' } }; }
    } },
    admin: { getSettings: () => adminRequest('getSettings'), saveSettings: (input) => adminRequest('saveSettings', input) },
    kernel: {
      hydrate: () => rpc('kernel.hydrate'),
      createSession: (title) => rpc('kernel.createSession', title),
      deleteSession: (id) => rpc('kernel.deleteSession', id),
      getMessages: (id) => rpc('kernel.getMessages', id),
      listRuns: (id) => rpc('kernel.listRuns', id),
      cancelRun: (id, runId) => rpc('kernel.cancelRun', id, runId),
      streamReplay: (input) => rpc('kernel.streamReplay', input),
      async startRun(...args) {
        try { await connected(); }
        catch { return { ok: false, error: { code: 'STREAM_UNAVAILABLE', message: '实时连接尚未就绪，请稍后再试。' } }; }
        return rpc('kernel.startRun', ...args);
      },
      onAgentEvent: (callback) => { agents.add(callback); return () => { agents.delete(callback); }; },
      onStreamEvent: (callback) => { streams.add(callback); return () => { streams.delete(callback); }; },
    },
    market: channel('market'), agent: channel('agent'), longbridge: channel('longbridge'),
    health: channel('health'),
    diagnostics: { collect: () => rpc('diagnostics.collect'), restartRuntime: () => rpc('diagnostics.restartRuntime'), export: async () => { const result = await rpc<string>('diagnostics.export'); if (!result.ok) return result; const url = URL.createObjectURL(new Blob([result.data], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'felix-diagnostics.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return { ok: true, data: {} }; } },
    connections: { ...Object.fromEntries(['list','connect','cancelConnect','disconnect','test','setConfig','coverage'].map((method) => [method, (...args: unknown[]) => rpc(`connections.${method}`, ...args)])), onChanged: (callback) => { const listener = (event: Event) => callback(JSON.parse((event as MessageEvent).data)); source.addEventListener('connections', listener); return () => source.removeEventListener('connections', listener); } } as NonNullable<FinagentClient['connections']>,
    openExternal: async (url) => { const target = new URL(url); if (!['http:', 'https:'].includes(target.protocol)) return { ok: false, error: { code: 'INVALID_URL', message: '仅支持网页链接。' } }; window.open(target.href, '_blank', 'noopener,noreferrer'); return { ok: true, data: undefined }; },
    llm: channel('llm'), skills: channel('skills'), prefs: channel('prefs'),
    onboarding: channel('onboarding'), about: channel('about'), capabilities: channel('capabilities'),
    screening: channel('screening'), outcome: channel('outcome'), pulse: channel('pulse'), performance: channel('performance'), automation: channel('automation'), evaluation: channel('evaluation'), portfolioRisk: channel('portfolioRisk'), portfolioImport: channel('portfolioImport'),
    thesis: { ...Object.fromEntries(['list','getReport','saveFromReport','reEvaluate','update','listImpacts'].map((method) => [method, (...args: unknown[]) => rpc(`thesis.${method}`, ...args)])), onImpact: (callback) => { const listener = (event: Event) => callback(JSON.parse((event as MessageEvent).data)); source.addEventListener('thesis', listener); return () => source.removeEventListener('thesis', listener); } } as NonNullable<FinagentClient['thesis']>,
    alerts: { ...channel<NonNullable<FinagentClient['alerts']>>('alerts'), loadRules: () => rpc('alerts.loadRules'), saveRules: (rules) => rpc('alerts.saveRules', rules), listEvents: () => rpc('alerts.listEvents'), onTriggered: (callback) => { const listener = (event: Event) => callback(JSON.parse((event as MessageEvent).data)); source.addEventListener('alert', listener); return () => source.removeEventListener('alert', listener); } },
    research: channel('research'), compare: channel('compare'), export: channel('export'),
  };
}
