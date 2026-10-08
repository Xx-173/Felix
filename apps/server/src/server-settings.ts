import { isIP } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import { createCodeError } from '@finagent/shared';
import { builtinModelHosts } from './visitor-models.ts';
import type { WorkspaceDatabase } from './database.ts';

const settingsKey = 'server/settings.json';
const hostname = z.string().trim().toLowerCase().max(253).refine((value) => {
  return !isIP(value) && !/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(value)
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)
    && value.split('.').every((label) => label.length <= 63);
}, '请输入公网域名，不包含协议、端口或路径。');
const storedSchema = z.object({ modelAllowedHosts: z.array(hostname).max(50), revision: z.number().int().nonnegative(), updatedAt: z.number().optional(), updatedBy: z.string().optional() });
const saveSchema = z.object({ modelAllowedHosts: z.array(hostname).max(50), revision: z.number().int().nonnegative() }).strict();
type Stored = z.infer<typeof storedSchema>;
const defaults: Stored = { modelAllowedHosts: [], revision: 0 };

export class ServerSettings {
  /** Shared by every visitor runtime, updated immediately after a successful save. */
  readonly modelHosts: string[] = [];
  constructor(private readonly database: WorkspaceDatabase, private readonly root: string, private readonly environmentHosts: string[] = []) {}
  private apply(value: Stored) { this.modelHosts.splice(0, this.modelHosts.length, ...new Set([...this.environmentHosts, ...value.modelAllowedHosts])); }
  async load() { this.apply(storedSchema.parse(await this.database.read(join(this.root, settingsKey), defaults))); }
  async get() {
    const settings = storedSchema.parse(await this.database.read(join(this.root, settingsKey), defaults));
    return { ...settings, builtinHosts: builtinModelHosts, environmentHosts: this.environmentHosts };
  }
  async save(input: unknown, actor: string) {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) throw createCodeError('INVALID_ARGUMENT', '请输入有效的公网域名，每行一个，最多 50 个。');
    const value = await this.database.transaction(async (tx) => {
      const [row] = await tx.query('SELECT value FROM documents WHERE key=$1', [settingsKey]);
      const previous = storedSchema.parse(row ? JSON.parse(row.value) : defaults);
      if (previous.revision !== parsed.data.revision) throw createCodeError('SERVER_SETTINGS_CHANGED', '设置已被其他管理员修改，请重新打开后再保存。');
      const next: Stored = { modelAllowedHosts: [...new Set(parsed.data.modelAllowedHosts)].sort(), revision: previous.revision + 1, updatedAt: Date.now(), updatedBy: actor };
      await tx.query('INSERT INTO documents VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [settingsKey, JSON.stringify(next)]);
      const auditKey = 'server/admin-audit.json';
      const [audit] = await tx.query('SELECT value FROM documents WHERE key=$1', [auditKey]);
      const events = audit ? JSON.parse(audit.value) as unknown[] : [];
      const event = { action: 'model-domains-updated', actor, at: next.updatedAt, previous: previous.modelAllowedHosts, domains: next.modelAllowedHosts };
      await tx.query('INSERT INTO documents VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [auditKey, JSON.stringify([...events.slice(-99), event])]);
      return next;
    });
    this.apply(value);
    return { ...value, builtinHosts: builtinModelHosts, environmentHosts: this.environmentHosts };
  }
}
