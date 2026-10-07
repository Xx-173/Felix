import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createCodeError } from '@finagent/shared';
import type { WorkspaceDatabase } from './database.ts';

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,39}$/);
const password = z.string().min(12).max(256);
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const fresh = () => randomBytes(32).toString('base64url');
type AccountResult = { user: Account; token: string; recoveryCode?: string } | { deleted: true; expectedPasswordHash: string };
export type Account = { id: string; username: string; workspaceId: string; createdAt: number };
type UserRow = { id: string; username: string; workspace_id: string; password_hash: string; recovery_hash: string; created_at: number };
const publicUser = (user: UserRow): Account => ({ id: user.id, username: user.username, workspaceId: user.workspace_id, createdAt: user.created_at });

export class Accounts {
  private concurrent = 0;
  private readonly dummy: Promise<string>;
  constructor(private readonly database: WorkspaceDatabase, private readonly invite?: string) {
    database.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
    this.dummy = Bun.password.hash(fresh(), { algorithm: 'argon2id' });
  }
  state(user?: Account) { return { user: user ?? null, inviteRequired: !!this.invite }; }
  workspaceClaimed(workspaceId: string) { return !!this.database.sql.query('SELECT 1 FROM users WHERE workspace_id = ?').get(workspaceId); }
  resolve(cookie: string | undefined): Account | undefined {
    if (!cookie || !/^[a-zA-Z0-9_-]{43}$/.test(cookie)) return;
    const user = this.database.sql.query('SELECT users.* FROM users JOIN auth_sessions ON users.id=auth_sessions.user_id WHERE token_hash=? AND expires_at>?').get(tokenHash(cookie), Date.now()) as UserRow | null;
    return user ? publicUser(user) : undefined;
  }
  private row(name: string) { return this.database.sql.query('SELECT * FROM users WHERE username = ?').get(name) as UserRow | null; }
  private session(user: UserRow) {
    const current = this.row(user.username);
    if (!current || current.password_hash !== user.password_hash || current.recovery_hash !== user.recovery_hash) throw createCodeError('INVALID_CREDENTIALS', '凭据已更改，请重新登录（Credentials changed; sign in again）。');
    const token = fresh();
    this.database.sql.query('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
    this.database.sql.query('DELETE FROM auth_sessions WHERE user_id=? AND rowid NOT IN (SELECT rowid FROM auth_sessions WHERE user_id=? ORDER BY rowid DESC LIMIT 9)').run(user.id, user.id);
    this.database.sql.query('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(tokenHash(token), user.id, Date.now() + 30 * 86400000);
    return { user: publicUser(user), token };
  }
  delete(user: Account, expectedPasswordHash: string) {
    this.database.sql.transaction(() => {
      if (this.row(user.username)?.password_hash !== expectedPasswordHash) throw createCodeError('INVALID_CREDENTIALS', '凭据已更改，请重新登录（Credentials changed; sign in again）。');
      this.database.removeWorkspace(user.workspaceId); this.database.sql.query('DELETE FROM users WHERE id=?').run(user.id);
    })();
  }
  logout(token: string | undefined) { if (token) this.database.sql.query('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash(token)); }
  async execute(action: string, raw: unknown, workspaceId: string, user: Account | undefined, address: string): Promise<AccountResult> {
    if (this.concurrent >= 2) throw createCodeError('AUTH_BUSY', '登录服务繁忙，请稍后再试（Sign-in busy; retry shortly）。');
    const key = `${address}:${action}`; const now = Date.now();
    this.database.sql.query('DELETE FROM auth_attempts WHERE reset_at < ?').run(now);
    const rate = this.database.sql.query('SELECT count FROM auth_attempts WHERE key = ?').get(key) as { count: number } | null;
    if ((rate?.count ?? 0) >= 10) throw createCodeError('AUTH_RATE_LIMIT', '尝试次数过多，请一分钟后重试（Too many attempts; retry in a minute）。');
    this.database.sql.query('INSERT INTO auth_attempts VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 60000);
    this.concurrent++;
    try {
      const input = z.object({ username: username.optional(), password: password.optional(), newPassword: password.optional(), recoveryCode: z.string().max(100).optional(), inviteCode: z.string().max(256).optional() }).parse(raw);
      if (action === 'register') {
        if (user) throw createCodeError('AUTH_ALREADY_SIGNED_IN', '请先退出当前账号（Sign out first）。');
        const name = username.parse(input.username), secret = password.parse(input.password);
        if (this.invite) {
          const a = Buffer.from(tokenHash(input.inviteCode ?? '')), b = Buffer.from(tokenHash(this.invite));
          if (!timingSafeEqual(a, b)) throw createCodeError('INVITE_REQUIRED', '邀请码不正确（Invalid invitation code）。');
        }
        const hash = await Bun.password.hash(secret, { algorithm: 'argon2id' });
        const recoveryCode = fresh(), id = randomBytes(16).toString('hex');
        try { this.database.sql.query('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(id, name, workspaceId, hash, tokenHash(recoveryCode), now); }
        catch { throw createCodeError('ACCOUNT_EXISTS', '用户名已被使用，请换一个（Username unavailable）。'); }
        return { ...this.session(this.row(name)!), recoveryCode };
      }
      if (action === 'login') {
        const row = this.row(username.parse(input.username));
        const ok = await Bun.password.verify(password.parse(input.password), row?.password_hash ?? await this.dummy);
        if (!row || !ok) throw createCodeError('INVALID_CREDENTIALS', '用户名或密码错误（Invalid username or password）。');
        return this.session(row);
      }
      if (action === 'resetPassword') {
        const row = this.row(username.parse(input.username));
        const expected = row?.recovery_hash ?? tokenHash(fresh());
        if (!timingSafeEqual(Buffer.from(expected), Buffer.from(tokenHash(input.recoveryCode ?? ''))) || !row) throw createCodeError('INVALID_CREDENTIALS', '用户名或恢复码错误（Invalid username or recovery code）。');
        const hash = await Bun.password.hash(password.parse(input.newPassword), { algorithm: 'argon2id' });
        const recoveryCode = fresh();
        this.database.sql.transaction(() => { if (this.database.sql.query('UPDATE users SET password_hash=?, recovery_hash=? WHERE id=? AND recovery_hash=?').run(hash, tokenHash(recoveryCode), row.id, row.recovery_hash).changes !== 1) throw createCodeError('INVALID_CREDENTIALS', '恢复码已使用或账号已删除（Recovery code used or account deleted）。'); this.database.sql.query('DELETE FROM auth_sessions WHERE user_id=?').run(row.id); })();
        return { ...this.session(this.row(row.username)!), recoveryCode };
      }
      if (!user) throw createCodeError('SIGN_IN_REQUIRED', '请先登录（Sign in first）。');
      const row = this.row(user.username)!;
      if (!await Bun.password.verify(password.parse(input.password), row.password_hash)) throw createCodeError('INVALID_CREDENTIALS', '密码错误（Incorrect password）。');
      if (action === 'changePassword') {
        const hash = await Bun.password.hash(password.parse(input.newPassword), { algorithm: 'argon2id' });
        this.database.sql.transaction(() => { if (this.database.sql.query('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(hash, row.id, row.password_hash).changes !== 1) throw createCodeError('INVALID_CREDENTIALS', '凭据已更改，请重新登录（Credentials changed; sign in again）。'); this.database.sql.query('DELETE FROM auth_sessions WHERE user_id=?').run(row.id); })();
        return this.session(this.row(row.username)!);
      }
      if (action === 'deleteAccount') return { deleted: true as const, expectedPasswordHash: row.password_hash };
      throw createCodeError('INVALID_ARGUMENT', '未知账号操作（Unknown account action）。');
    } finally { this.concurrent--; }
  }
}
