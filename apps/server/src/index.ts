import { resolve } from 'node:path';
import { createWebApplication } from './app.ts';

const env = process.env;
const repositoryRoot = resolve(import.meta.dirname, '../../..');
function positiveInteger(name: string, fallback: number) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
const app = await createWebApplication({
  dataDir: resolve(env.FELIX_DATA_DIR ?? resolve(repositoryRoot, '.felix-web-data')),
  staticDir: resolve(env.FELIX_STATIC_DIR ?? resolve(repositoryRoot, 'apps/web/dist')),
  secret: env.FELIX_COOKIE_SECRET,
  production: env.NODE_ENV === 'production',
  publicOrigin: env.FELIX_PUBLIC_ORIGIN,
  demoData: env.FELIX_DEMO_DATA !== '0',
  modelAllowedHosts: (env.FELIX_MODEL_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
  skillsDir: env.FELIX_SKILLS_DIR,
  inviteCode: env.FELIX_INVITE_CODE || undefined,
  proxySecret: env.FELIX_PROXY_SECRET || undefined,
  dailyRunLimit: positiveInteger('FELIX_DAILY_RUN_LIMIT', 1000),
  visitorDailyRunLimit: positiveInteger('FELIX_VISITOR_DAILY_RUN_LIMIT', 20),
  maxVisitors: positiveInteger('FELIX_ACTIVE_VISITORS', 32),
  concurrency: positiveInteger('FELIX_CONCURRENCY', 2),

});
const port = Number(env.PORT ?? '8787');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const server = Bun.serve({
  hostname: env.HOST ?? '127.0.0.1', port, idleTimeout: 0, maxRequestBodySize: 65536,
  fetch(request, server) { return app.fetch(request, server.requestIP(request)?.address ?? 'unknown'); },
});
console.log(`Felix Web listening on ${server.url} (${env.FELIX_DEMO_DATA === '0' ? 'live market configuration' : 'sample market mode'})`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.stop(true);
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
