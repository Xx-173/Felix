import React, { useEffect, useState } from 'react';
import { useFinagentClient } from '../../client';
import { ServerAdminPanel } from './ServerAdminPanel';

type Mode = 'login' | 'register' | 'resetPassword' | 'changePassword' | 'deleteAccount';
const labels: Record<Mode, string> = { login: '登录（Sign in）', register: '注册（Register）', resetPassword: '恢复账号（Recover account）', changePassword: '修改密码（Change password）', deleteAccount: '删除账号和数据（Delete account and data）' };
const buttonStyle = 'rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50';
export const WebAccountPanel: React.FC = () => {
  const client = useFinagentClient();
  const [user, setUser] = useState<{ username: string; role?: 'user' | 'admin' } | null>(null);
  const [administration, setAdministration] = useState(false);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const [form, setForm] = useState({ username: '', password: '', newPassword: '', recoveryCode: '', inviteCode: '', confirm: '' });
  useEffect(() => { let disposed = false; void client.account?.request('state').then((result) => {
    if (!disposed && result.ok) { setUser(result.data.user ?? null); setInviteRequired(!!result.data.inviteRequired); }
  }); return () => { disposed = true; }; }, [client]);
  const open = (next: Mode) => { setMode(next); setError(''); setRecovery(''); setForm({ username: '', password: '', newPassword: '', recoveryCode: '', inviteCode: '', confirm: '' }); };
  const execute = async (event: React.FormEvent) => {
    event.preventDefault(); if (!mode || !client.account) return;
    if (mode === 'deleteAccount' && form.confirm !== user?.username) { setError('请输入当前用户名确认删除（Type your username to confirm deletion）。'); return; }
    setBusy(true); setError('');
    const input: Record<string, string> = mode === 'login' || mode === 'register'
      ? { username: form.username, password: form.password, ...(mode === 'register' && inviteRequired ? { inviteCode: form.inviteCode } : {}) }
      : mode === 'resetPassword' ? { username: form.username, newPassword: form.newPassword, recoveryCode: form.recoveryCode }
      : mode === 'changePassword' ? { password: form.password, newPassword: form.newPassword }
      : { password: form.password };
    const result = await client.account.request(mode, input);
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    setForm((value) => ({ ...value, password: '', newPassword: '', recoveryCode: '' }));
    if (result.data.recoveryCode) { setUser(result.data.user ?? null); setRecovery(result.data.recoveryCode); }
    else window.location.reload();
  };
  const logout = async () => { setBusy(true); const result = await client.account!.request('logout'); if (result.ok) window.location.reload(); else { setError(result.error.message); setBusy(false); } };
  const exportData = async () => {
    const result = await client.workspace?.exportData?.();
    if (!result?.ok) { setError('数据导出失败（Data export failed）。'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'felix-workspace.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2" data-testid="account-bar">
      <span className="mr-auto text-xs">{user ? `个人工作区（Personal workspace）：${user.username}` : '匿名试用（Guest trial） · 注册可保留当前记录并在其他设备登录（Register to keep this workspace across devices）。'}</span>
      {user?.role === 'admin' && client.admin && <button className={buttonStyle} onClick={() => setAdministration(true)}>管理设置（Administration）</button>}
      {user ? <><button className={buttonStyle} disabled={busy} onClick={() => void exportData()}>导出数据（Export data）</button><button className={buttonStyle} onClick={() => open('changePassword')}>修改密码（Change password）</button><button className={buttonStyle} onClick={() => open('deleteAccount')}>删除账号（Delete account）</button><button className={buttonStyle} disabled={busy} onClick={() => void logout()}>退出（Sign out）</button></> : <><button className={buttonStyle} onClick={() => open('login')}>登录（Sign in）</button><button className={buttonStyle} onClick={() => open('register')}>注册（Register）</button></>}
      {!mode && error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
    </div>
    {administration && <ServerAdminPanel onClose={() => setAdministration(false)} />}
    {mode && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={labels[mode]}>
      <form onSubmit={(event) => void execute(event)} className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{labels[mode]}</h2>
        {recovery ? <><p className="text-sm">请保存恢复码。忘记密码时需要它找回账号；只在此显示一次（Save this recovery code; shown once and required if you forget your password）。</p><code className="block break-all rounded border border-border p-3" data-testid="recovery-code">{recovery}</code><button type="button" className={buttonStyle} onClick={() => window.location.reload()}>已保存恢复码，进入工作区（Saved; enter workspace）</button></> : <>
          {(mode === 'login' || mode === 'register' || mode === 'resetPassword') && <label className="block space-y-1 text-sm">用户名（Username）<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}" autoComplete="username" className="block w-full rounded border border-border bg-background p-2" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>}
          {mode !== 'resetPassword' && <label className="block space-y-1 text-sm">{mode === 'register' ? '密码，至少 12 个字符（Password, at least 12 characters）' : '密码（Password）'}<input required type="password" minLength={12} maxLength={256} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className="block w-full rounded border border-border bg-background p-2" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>}
          {(mode === 'changePassword' || mode === 'resetPassword') && <label className="block space-y-1 text-sm">新密码，至少 12 个字符（New password, at least 12 characters）<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" className="block w-full rounded border border-border bg-background p-2" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>}
          {mode === 'resetPassword' && <label className="block space-y-1 text-sm">恢复码（Recovery code）<input required className="block w-full rounded border border-border bg-background p-2" value={form.recoveryCode} onChange={(event) => setForm({ ...form, recoveryCode: event.target.value })} /></label>}
          {mode === 'register' && inviteRequired && <label className="block space-y-1 text-sm">邀请码（Invitation code）<input required className="block w-full rounded border border-border bg-background p-2" value={form.inviteCode} onChange={(event) => setForm({ ...form, inviteCode: event.target.value })} /></label>}
          {mode === 'deleteAccount' && <><p className="text-sm">将删除服务器上的账号、工作区与模型密钥。此操作不可撤销（Deletes this server account, workspace and keys permanently）。</p><label className="block space-y-1 text-sm">输入用户名确认（Type username to confirm）<input required className="block w-full rounded border border-border bg-background p-2" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></label></>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2"><button className={buttonStyle} disabled={busy} type="submit">{busy ? '处理中（Working）…' : labels[mode]}</button><button className={buttonStyle} disabled={busy} type="button" onClick={() => setMode(null)}>取消（Cancel）</button>{mode === 'login' && <button className={buttonStyle} type="button" onClick={() => open('resetPassword')}>忘记密码（Forgot password）</button>}</div>
        </>}
      </form>
    </div>}
  </>;
};
