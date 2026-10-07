import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const origin = 'http://127.0.0.1:8790';
async function healthy() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(origin + '/healthz')).ok) return; } catch {}
    await Bun.sleep(500);
  }
  throw new Error('Container did not become healthy');
}
let cookie = '';
async function rpc(method: string, args: unknown[] = []) {
  const response = await fetch(origin + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ method, args }) });
  cookie = response.headers.getSetCookie()[0]?.split(';')[0] ?? cookie;
  const result = await response.json(); assert.equal(result.ok, true); return result.data;
}
await healthy();
assert.equal((await fetch(origin)).status, 200);
const session = await rpc('kernel.createSession', ['Container restart']);
await rpc('workspace.update', [{ watchlist: ['MSFT.US'] }]);
execFileSync('docker', ['restart', 'felix-ci'], { stdio: 'inherit' });
await healthy();
assert.equal((await rpc('kernel.hydrate')).sessions[0].id, session.id);
assert.deepEqual((await rpc('workspace.get')).watchlist, ['MSFT.US']);
// Kill instead of graceful stop verifies stale PID-1 lock recovery on Linux.
execFileSync('docker', ['kill', 'felix-ci'], { stdio: 'inherit' });
execFileSync('docker', ['start', 'felix-ci'], { stdio: 'inherit' });
await healthy();
assert.deepEqual((await rpc('workspace.get')).watchlist, ['MSFT.US']);
console.log('Linux container: startup, shared UI, SQLite persistence, graceful and crash restart passed.');
