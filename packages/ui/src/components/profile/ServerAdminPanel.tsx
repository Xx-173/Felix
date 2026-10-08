import React, { useEffect, useState } from 'react';
import { useFinagentClient, type ServerManagementSettings } from '../../client';

export const ServerAdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const client = useFinagentClient();
  const [settings, setSettings] = useState<ServerManagementSettings>();
  const [hosts, setHosts] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let disposed = false;
    void client.admin?.getSettings().then((result) => {
      if (disposed) return;
      if (result.ok) { setSettings(result.data); setHosts(result.data.modelAllowedHosts.join('\n')); }
      else setError(result.error.message);
    });
    return () => { disposed = true; };
  }, [client]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!settings || !client.admin || busy) return;
    setBusy(true); setError(''); setSaved(false);
    const result = await client.admin.saveSettings({ revision: settings.revision, modelAllowedHosts: hosts.split(/\s+/).filter(Boolean) });
    setBusy(false);
    if (result.ok) { setSettings(result.data); setHosts(result.data.modelAllowedHosts.join('\n')); setSaved(true); }
    else setError(result.error.message);
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="管理设置（Administration）">
    <form onSubmit={(event) => void save(event)} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
      <h2 className="text-lg font-semibold">管理设置（Administration）</h2>
      <p className="text-sm text-muted-foreground">设置全站可使用的额外模型服务商域名。保存后立即生效；每位使用者仍填写自己的模型密钥（Approve additional model domains for all users. Changes apply immediately; users supply their own API keys）。</p>
      <div className="space-y-2 text-sm"><label htmlFor="admin-model-domains">允许的模型域名（Allowed model domains）</label>
        <textarea id="admin-model-domains" rows={5} disabled={!settings || busy} className="block w-full rounded border border-border bg-background p-2 font-mono" placeholder="apihub.agnes-ai.com" value={hosts} onChange={(event) => { setHosts(event.target.value); setSaved(false); }} />
      </div>
      <p className="text-xs text-muted-foreground">每行一个域名，例如 apihub.agnes-ai.com；不用填写 https:// 或 /v1。移除域名后，该服务商的新模型请求将被阻止（One domain per line, without https:// or /v1. Removed domains cannot serve new model requests）。</p>
      {settings && <div className="space-y-2 rounded border border-border p-3 text-xs"><p>内置服务商（Built-in providers）：{settings.builtinHosts.join('、')}</p>{settings.environmentHosts.length > 0 && <p>部署时固定允许的域名（Deployment-approved domains）：{settings.environmentHosts.join('、')}</p>}{settings.updatedBy && <p>最近修改（Last updated）：{settings.updatedBy} · {new Date(settings.updatedAt!).toLocaleString()}</p>}</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm text-emerald-600">已保存并立即生效，无需重启（Saved and applied; no restart needed）。</p>}
      <div className="flex gap-2"><button type="submit" disabled={!settings || busy} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">{busy ? '保存中（Saving）…' : '保存并生效（Save and apply）'}</button><button type="button" disabled={busy} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={onClose}>关闭（Close）</button></div>
    </form>
  </div>;
};
