import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createCodeError } from '@finagent/shared';
import type { WorkspaceDatabase, QueryExecutor } from './database.ts';

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,39}$/);
const password = z.string().min(12).max(256);
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const fresh = () => randomBytes(32).toString('base64url');
const changed = () => createCodeError('INVALID_CREDENTIALS', '凭据已更改，请重新登录（Credentials changed; sign in again）。');
type AccountResult = { user: Account; token: string; recoveryCode?: string } | { deleted: true; expectedPasswordHash: string };
export type Account = { id: string; username: string; workspaceId: string; createdAt: number; role: 'user' | 'admin' };
type UserRow = { id: string; username: string; workspace_id: string; password_hash: string; recovery_hash: string; created_at: number; role: Account['role'] };
const userSelect = "SELECT users.*, CASE WHEN administrators.user_id IS NULL THEN 'user' ELSE 'admin' END AS role FROM users LEFT JOIN administrators ON administrators.user_id=users.id";
const publicUser = (user: UserRow): Account => ({ id: user.id, username: user.username, workspaceId: user.workspace_id, createdAt: user.created_at, role: user.role });

/** Only the local operator CLI can grant/revoke roles; registration always creates users. */
export async function setAdministrator(database: WorkspaceDatabase, name: string, enabled: boolean) {
  name = username.parse(name);
  await database.transaction(async (tx) => {
    const [row] = await tx.query('SELECT id FROM users WHERE username=$1', [name]);
    if (!row) throw new Error('Account not found. Register the account before granting administrator access.');
    if (enabled) await tx.query('INSERT INTO administrators VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.id, Date.now()]);
    else await tx.query('DELETE FROM administrators WHERE user_id=$1', [row.id]);
  });
}

export class Accounts {
  private concurrent = 0;
  private readonly dummy: Promise<string>;
  constructor(private readonly database: WorkspaceDatabase, private readonly invite?: string) {
    this.dummy = Bun.password.hash(fresh(), { algorithm: 'argon2id' });
  }
  state(user?: Account) { return { user: user ?? null, inviteRequired: !!this.invite }; }
  async workspaceClaimed(workspaceId: string) { return (await this.database.query('SELECT 1 FROM users WHERE workspace_id = $1', [workspaceId])).length > 0; }
  async resolve(cookie: string | undefined): Promise<Account | undefined> {
    if (!cookie || !/^[a-zA-Z0-9_-]{43}$/.test(cookie)) return;
    const [user] = await this.database.query<UserRow>(userSelect + ' JOIN auth_sessions ON users.id=auth_sessions.user_id WHERE token_hash=$1 AND expires_at>$2', [tokenHash(cookie), Date.now()]);
    return user ? publicUser(user) : undefined;
  }
  private async row(name: string, tx: QueryExecutor = this.database) { return (await tx.query<UserRow>(userSelect + ' WHERE username = $1', [name]))[0]; }
  private session(user: UserRow) {
    return this.database.transaction(async (tx) => {
      const current = await this.row(user.username, tx);
      if (!current || current.password_hash !== user.password_hash || current.recovery_hash !== user.recovery_hash) throw changed();
      const token = fresh();
      await tx.query('DELETE FROM auth_sessions WHERE expires_at < $1', [Date.now()]);
      await tx.query('DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE user_id=$1 ORDER BY expires_at DESC, token_hash DESC LIMIT 9)', [user.id]);
      await tx.query('INSERT INTO auth_sessions VALUES ($1, $2, $3)', [tokenHash(token), user.id, Date.now() + 30 * 86400000]);
      return { user: publicUser(user), token };
    });
  }
  async delete(user: Account, expectedPasswordHash: string) {
    await this.database.transaction(async (tx) => {
      if ((await this.row(user.username, tx))?.password_hash !== expectedPasswordHash) throw changed();
      await this.database.removeWorkspace(user.workspaceId, tx);
      await tx.query('DELETE FROM users WHERE id=$1', [user.id]);
    });
  }
  async logout(token: string | undefined) { if (token) await this.database.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash(token)]); }
  async execute(action: string, raw: unknown, workspaceId: string, user: Account | undefined, address: string): Promise<AccountResult> {
    if (this.concurrent >= 2) throw createCodeError('AUTH_BUSY', '登录服务繁忙，请稍后再试（Sign-in busy; retry shortly）。');
    this.concurrent++;
    try {
      const key = `${address}:${action}`, now = Date.now();
      await this.database.query('DELETE FROM auth_attempts WHERE reset_at < $1', [now]);
      const [rate] = await this.database.query('INSERT INTO auth_attempts VALUES ($1, 1, $2) ON CONFLICT(key) DO UPDATE SET count=auth_attempts.count+1 RETURNING count', [key, now + 60000]);
      if (rate.count > 10) throw createCodeError('AUTH_RATE_LIMIT', '尝试次数过多，请一分钟后重试（Too many attempts; retry in a minute）。');
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
        try { await this.database.query('INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6)', [id, name, workspaceId, hash, tokenHash(recoveryCode), now]); }
        catch (error) {
          const failure = error as { errno?: string | number; code?: string };
          const code = failure.code === 'ERR_POSTGRES_SERVER_ERROR' ? String(failure.errno) : String(failure.code);
          if (code === '23505' || code.startsWith('SQLITE_CONSTRAINT')) throw createCodeError('ACCOUNT_EXISTS', '用户名已被使用，请换一个（Username unavailable）。');
          throw error;
        }
        return { ...await this.session((await this.row(name))!), recoveryCode };
      }
      if (action === 'login') {
        const row = await this.row(username.parse(input.username));
        const ok = await Bun.password.verify(password.parse(input.password), row?.password_hash ?? await this.dummy);
        if (!row || !ok) throw createCodeError('INVALID_CREDENTIALS', '用户名或密码错误（Invalid username or password）。');
        return this.session(row);
      }
      if (action === 'resetPassword') {
        const row = await this.row(username.parse(input.username));
        const expected = row?.recovery_hash ?? tokenHash(fresh());
        if (!timingSafeEqual(Buffer.from(expected), Buffer.from(tokenHash(input.recoveryCode ?? ''))) || !row) throw createCodeError('INVALID_CREDENTIALS', '用户名或恢复码错误（Invalid username or recovery code）。');
        const hash = await Bun.password.hash(password.parse(input.newPassword), { algorithm: 'argon2id' });
        const recoveryCode = fresh();
        await this.database.transaction(async (tx) => {
          if ((await tx.query('UPDATE users SET password_hash=$1, recovery_hash=$2 WHERE id=$3 AND recovery_hash=$4 RETURNING id', [hash, tokenHash(recoveryCode), row.id, row.recovery_hash])).length !== 1) throw createCodeError('INVALID_CREDENTIALS', '恢复码已使用或账号已删除（Recovery code used or account deleted）。');
          await tx.query('DELETE FROM auth_sessions WHERE user_id=$1', [row.id]);
        });
        return { ...await this.session((await this.row(row.username))!), recoveryCode };
      }
      if (!user) throw createCodeError('SIGN_IN_REQUIRED', '请先登录（Sign in first）。');
      const row = await this.row(user.username);
      if (!row || !await Bun.password.verify(password.parse(input.password), row.password_hash)) throw createCodeError('INVALID_CREDENTIALS', '密码错误（Incorrect password）。');
      if (action === 'changePassword') {
        const hash = await Bun.password.hash(password.parse(input.newPassword), { algorithm: 'argon2id' });
        await this.database.transaction(async (tx) => {
          if ((await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND password_hash=$3 RETURNING id', [hash, row.id, row.password_hash])).length !== 1) throw changed();
          await tx.query('DELETE FROM auth_sessions WHERE user_id=$1', [row.id]);
        });
        return this.session((await this.row(row.username))!);
      }
      if (action === 'deleteAccount') {
        if (row.role === 'admin') throw createCodeError('ADMIN_ACCOUNT_DELETE_FORBIDDEN', '请先由部署者撤销管理员权限，再删除账号（Revoke administrator access before deleting this account）。');
        return { deleted: true as const, expectedPasswordHash: row.password_hash };
      }
      throw createCodeError('INVALID_ARGUMENT', '未知账号操作（Unknown account action）。');
    } finally { this.concurrent--; }
  }
}
