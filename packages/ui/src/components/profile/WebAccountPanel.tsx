import React, { useEffect, useState } from 'react';
import { useFinagentClient } from '../../client';
import { ChevronDown, Download, KeyRound, LogOut, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '../ui/dropdown-menu';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { ServerAdminPanel } from './ServerAdminPanel';

type Mode = 'login' | 'register' | 'resetPassword' | 'changePassword' | 'deleteAccount';
const labels: Record<Mode, string> = { login: '登录', register: '注册', resetPassword: '恢复账号', changePassword: '修改密码', deleteAccount: '删除账号和数据' };
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
    if (mode === 'deleteAccount' && form.confirm !== user?.username) { setError('请输入当前用户名确认删除。'); return; }
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
    if (!result?.ok) { setError('数据导出失败。'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'felix-workspace.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="felix-account-bar" data-testid="account-bar">
      <div className="felix-account-identity"><span className="felix-account-avatar"><UserRound size={14} /></span>
        <span>{user ? user.username : '匿名试用'}</span>
        <span className="felix-account-hint">{user ? '个人工作区' : '注册后跨设备保留记录'}</span>
      </div>
      <div className="felix-account-actions">
        {user?.role === 'admin' && client.admin && <button className="felix-account-admin" onClick={() => setAdministration(true)} aria-label="管理设置"><ShieldCheck size={14} /><BilingualLabel>管理设置</BilingualLabel></button>}
        {user ? <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="felix-account-menu-trigger" data-testid="account-menu-trigger" aria-label="账号菜单"><BilingualLabel>账号</BilingualLabel><ChevronDown size={13} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="felix-account-menu">
            <DropdownMenuLabel>{user.username}</DropdownMenuLabel>
            <DropdownMenuItem aria-label="导出数据" disabled={busy} onSelect={() => void exportData()}><Download size={14} /><BilingualLabel>导出数据</BilingualLabel></DropdownMenuItem>
            <DropdownMenuItem aria-label="修改密码" onSelect={() => open('changePassword')}><KeyRound size={14} /><BilingualLabel>修改密码</BilingualLabel></DropdownMenuItem>
            <DropdownMenuItem aria-label="退出" disabled={busy} onSelect={() => void logout()}><LogOut size={14} /><BilingualLabel>退出</BilingualLabel></DropdownMenuItem>
            <DropdownMenuItem aria-label="删除账号" className="text-negative" onSelect={() => open('deleteAccount')}><Trash2 size={14} /><BilingualLabel>删除账号</BilingualLabel></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> : <><button className="felix-account-signin" onClick={() => open('login')}>登录</button><button className="felix-account-register" onClick={() => open('register')}>注册</button></>}
      </div>
      {!mode && error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
    </div>
    {administration && <ServerAdminPanel onClose={() => setAdministration(false)} />}
    {mode && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={labels[mode]}>
      <form onSubmit={(event) => void execute(event)} className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{labels[mode]}</h2>
        {recovery ? <><p className="text-sm">请保存恢复码。忘记密码时需要它找回账号；只在此显示一次。</p><code className="block break-all rounded border border-border p-3" data-testid="recovery-code">{recovery}</code><button type="button" className={buttonStyle} onClick={() => window.location.reload()}>已保存恢复码，进入工作区</button></> : <>
          {(mode === 'login' || mode === 'register' || mode === 'resetPassword') && <label className="block space-y-1 text-sm">用户名<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}" autoComplete="username" className="block w-full rounded border border-border bg-background p-2" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>}
          {mode !== 'resetPassword' && <label className="block space-y-1 text-sm">{mode === 'register' ? '密码，至少 12 个字符' : '密码'}<input required type="password" minLength={12} maxLength={256} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className="block w-full rounded border border-border bg-background p-2" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>}
          {(mode === 'changePassword' || mode === 'resetPassword') && <label className="block space-y-1 text-sm">新密码，至少 12 个字符<input required type="password" minLength={12} maxLength={256} autoComplete="new-password" className="block w-full rounded border border-border bg-background p-2" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>}
          {mode === 'resetPassword' && <label className="block space-y-1 text-sm">恢复码<input required className="block w-full rounded border border-border bg-background p-2" value={form.recoveryCode} onChange={(event) => setForm({ ...form, recoveryCode: event.target.value })} /></label>}
          {mode === 'register' && inviteRequired && <label className="block space-y-1 text-sm">邀请码<input required className="block w-full rounded border border-border bg-background p-2" value={form.inviteCode} onChange={(event) => setForm({ ...form, inviteCode: event.target.value })} /></label>}
          {mode === 'deleteAccount' && <><p className="text-sm">将删除服务器上的账号、工作区与模型密钥。此操作不可撤销。</p><label className="block space-y-1 text-sm">输入用户名确认<input required className="block w-full rounded border border-border bg-background p-2" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></label></>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2"><button className={buttonStyle} disabled={busy} type="submit">{busy ? '处理中…' : labels[mode]}</button><button className={buttonStyle} disabled={busy} type="button" onClick={() => setMode(null)}>取消</button>{mode === 'login' && <button className={buttonStyle} type="button" onClick={() => open('resetPassword')}>忘记密码</button>}</div>
        </>}
      </form>
    </div>}
  </>;
};
