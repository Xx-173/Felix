import React, { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, ExternalLink, ShieldCheck, Settings2, UserRound } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { AboutInfo } from '../../client';
import { useFinagentClient } from '../../client';
import { navSectionAtom, settingsTabAtom } from '../../atoms';
import { loadConnections, loadHealthCheck, type ConnectionEntry, type HealthCheckReport, type HealthCheckItem } from '../../client/connections';
import { Button } from '../primitives/Button';

type LoadState = 'loading' | 'ready';

const CheckStatus: React.FC<{ ok: boolean | null }> = ({ ok }) => {
  if (ok === true) return <CircleCheck className="h-4 w-4 text-positive" aria-hidden="true" />;
  if (ok === false) return <CircleAlert className="h-4 w-4 text-negative" aria-hidden="true" />;
  return <span className="h-2 w-2 rounded-full bg-foreground/25" aria-hidden="true" />;
};

/** Stitch Profile & Security surface, composed from existing local app state. */
export const ProfileSecurityView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const setNavSection = useSetAtom(navSectionAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);
  const [health, setHealth] = useState<HealthCheckReport | null>(null);
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const refresh = useCallback(async () => {
    setLoadState('loading');
    const [nextConnections, nextHealth, nextAbout] = await Promise.all([
      loadConnections(client),
      loadHealthCheck(client),
      client.about?.get().then((result) => result.ok ? result.data : null).catch(() => null) ?? Promise.resolve(null),
    ]);
    setConnections(nextConnections);
    setHealth(nextHealth);
    setAbout(nextAbout);
    setLoadState('ready');
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openConnections = () => {
    setSettingsTab('connections');
    setNavSection('settings');
  };

  const healthRows: Array<{ label: string; ok: boolean | null; mode?: HealthCheckItem['mode'] }> = [
    { label: t('profile.healthAi'), ok: health?.ai.ok ?? null, mode: health?.ai.mode },
    { label: t('profile.healthMarketData'), ok: health?.marketData.ok ?? null, mode: health?.marketData.mode },
    { label: t('profile.healthSkills'), ok: health?.skills.ok ?? null },
    { label: t('profile.healthRuntime'), ok: health?.agentRuntime.ok ?? null },
  ];

  return (
    <main className="felix-page felix-profile-view flex h-full min-h-0 flex-col overflow-y-auto bg-background" data-testid="profile-view">
      <header className="felix-page-header flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-6 py-5">
        <div>
          <div className="felix-eyebrow"><UserRound className="h-3.5 w-3.5" />{t('profile.eyebrow')}</div>
          <h1 className="felix-page-title">{t('profile.title')}</h1>
          <p className="felix-page-subtitle">{client.deployment ? '查看个人工作区、数据连接和运行状态。' : t('profile.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loadState === 'loading'}>
          {t('common.refresh')}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          <section className="felix-page-section felix-profile-identity">
            <div className="flex items-center gap-4">
              <div className="felix-profile-avatar"><ShieldCheck className="h-6 w-6" /></div>
              <div className="min-w-0">
                <h2>{client.deployment ? '个人工作区' : t('profile.localWorkspace')}</h2>
                <p>{client.deployment ? '账号数据独立存储在服务器，登录后可跨浏览器访问；密钥加密保存，可导出数据或删除账号。匿名记录依赖浏览器 Cookie，注册可保留这些记录。' : t('profile.localWorkspaceDescription')}</p>
              </div>
            </div>
            <dl className="felix-definition-grid mt-5">
              <div><dt>{t('profile.application')}</dt><dd>Felix</dd></div>
              <div><dt>{t('profile.channel')}</dt><dd>{about?.channel ?? '—'}</dd></div>
              <div><dt>{t('profile.version')}</dt><dd>{about?.version ?? '—'}</dd></div>
              <div><dt>{t('profile.build')}</dt><dd>{about?.build ?? '—'}</dd></div>
            </dl>
          </section>

          <section className="felix-page-section">
            <div className="felix-section-heading">
              <div><div className="felix-eyebrow">{t('profile.connectionsEyebrow')}</div><h2>{t('profile.connectionsTitle')}</h2></div>
              <Button variant="ghost" size="sm" onClick={openConnections}><Settings2 className="mr-1.5 h-3.5 w-3.5" />{t('profile.manage')}</Button>
            </div>
            {loadState === 'loading' ? (
              <div className="felix-skeleton-line" />
            ) : connections.length === 0 ? (
              <div className="felix-empty-state">{t('profile.noConnections')}</div>
            ) : (
              <div className="felix-profile-list">
                {connections.map((entry) => (
                  <div key={entry.providerId} className="felix-profile-list-row">
                    <div className="min-w-0"><strong>{entry.name}</strong><span>{entry.accountLabel ?? t(`connections.kind${entry.kind === 'broker-account' ? 'BrokerAccount' : 'FinancialData'}`)}</span></div>
                    <div className="flex items-center gap-2"><CheckStatus ok={entry.status === 'connected'} /><span>{entry.status.replaceAll('-', ' ')}</span></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="felix-page-section h-fit">
          <div className="felix-eyebrow"><ShieldCheck className="h-3.5 w-3.5" />{t('profile.securityEyebrow')}</div>
          <h2 className="mt-2">{t('profile.securityTitle')}</h2>
          <div className="felix-health-list mt-4">
            {healthRows.map((row) => (
              <div key={row.label} className="felix-health-row"><CheckStatus ok={row.mode ? null : row.ok} /><span>{row.label}</span><strong>{row.ok === null ? '—' : row.ok ? t(row.mode === 'demo' ? 'profile.demoOnly' : row.mode === 'local' ? 'profile.localOnly' : 'profile.ready') : t('profile.needsAttention')}</strong></div>
            ))}
          </div>
          {health?.marketData.mode === 'demo' && <p className="mt-3 text-[11px] text-foreground/60">{t('profile.demoHealthHint')}</p>}
          {health?.ai.mode === 'local' && <p className="mt-3 text-[11px] text-foreground/60">{t('profile.localHealthHint')}</p>}
          <div className="mt-5 border-t border-border pt-4 text-[11px] leading-relaxed text-foreground/42">
            {t('profile.securityHint')}
          </div>
          <button type="button" onClick={openConnections} className="felix-profile-link mt-4"><ExternalLink className="h-3.5 w-3.5" />{t('profile.openConnections')}</button>
        </aside>
      </div>
    </main>
  );
};
