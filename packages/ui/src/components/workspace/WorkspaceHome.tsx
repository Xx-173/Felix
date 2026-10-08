import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, CirclePlus, MessageSquare, Search, Trash2 } from 'lucide-react';
import type { SessionMeta } from '@finagent/core';
import {
  activeSessionIdAtom, agentPanelVisibleAtom, createSessionAtom,
  deleteSessionAtom, navSectionAtom, sessionsAtom, watchlistAtom, mobileAgentVisibleAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { Watchlist } from '../stock/Watchlist';

/** Personal lists belong in a full page, separate from security detail and chat. */
export const WorkspaceHome: React.FC = () => {
  const { t, i18n } = useTranslation();
  const client = useFinagentClient();
  const section = useAtomValue(navSectionAtom);
  const setSection = useSetAtom(navSectionAtom);
  const sessions = useAtomValue(sessionsAtom);
  const symbols = useAtomValue(watchlistAtom);
  const activeId = useAtomValue(activeSessionIdAtom);
  const setActiveId = useSetAtom(activeSessionIdAtom);
  const showAgent = useSetAtom(agentPanelVisibleAtom);
  const showMobileAgent = useSetAtom(mobileAgentVisibleAtom);
  const createSession = useSetAtom(createSessionAtom);
  const deleteSession = useSetAtom(deleteSessionAtom);
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SessionMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const isSessions = section === 'sessions';
  const filtered = sessions.filter((session) =>
    `${session.title} ${(session.recentSymbols ?? []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a, b) => b.updatedAt - a.updatedAt);
  const openSession = (id: string) => { setActiveId(id); showAgent(true); showMobileAgent(true); };

  return (
    <main className="felix-workspace-home" data-testid="workspace-home">
      <div className="felix-hub-heading">
        <div>
          <div className="felix-hub-eyebrow">FELIX / <BilingualLabel>{t('navigation.personalResearch')}</BilingualLabel></div>
          <h2><BilingualLabel>{t('navigation.workspace')}</BilingualLabel></h2>
          <p><BilingualLabel>{t('navigation.workspaceIntro')}</BilingualLabel></p>
        </div>
        <Button size="sm" onClick={() => { showAgent(true); showMobileAgent(true); void createSession(client); }} aria-label={t('navigation.startResearch')}>
          <CirclePlus size={15} /><BilingualLabel>{t('navigation.startResearch')}</BilingualLabel>
        </Button>
      </div>
      <div className="felix-hub-tabs" role="tablist" aria-label={t('navigation.workspaceTabs')}>
        {(['workspace', 'sessions'] as const).map((tab) => (
          <button key={tab} type="button" role="tab" id={`hub-tab-${tab}`} aria-controls="hub-content" aria-selected={section === tab} tabIndex={section === tab ? 0 : -1}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 'workspace' : event.key === 'End' ? 'sessions' : tab === 'workspace' ? 'sessions' : 'workspace';
                setSection(next); document.getElementById(`hub-tab-${next}`)?.focus();
              }
            }}
            aria-label={t(`navigation.${tab === 'workspace' ? 'watchlist' : 'sessions'}`)} onClick={() => setSection(tab)}>
            <BilingualLabel>{t(`navigation.${tab === 'workspace' ? 'watchlist' : 'sessions'}`)}</BilingualLabel>
            <span className="felix-hub-count">{tab === 'workspace' ? symbols.length : sessions.length}</span>
          </button>
        ))}
      </div>
      <section id="hub-content" role="tabpanel" aria-labelledby={`hub-tab-${isSessions ? 'sessions' : 'workspace'}`} className="felix-hub-panel">
        {!isSessions ? <Watchlist fullPage /> : <>
          <div className="felix-hub-toolbar">
            <label className="felix-hub-search"><Search size={16} /><input aria-label={t('navigation.sessionSearch')} placeholder={t('navigation.sessionSearch')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <span className="text-xs text-foreground/50"><BilingualLabel>{t('navigation.sessionLatest')}</BilingualLabel></span>
          </div>
          <div className="felix-session-list" data-testid="workspace-sessions">
            {filtered.map((session) => <article key={session.id} className={`felix-session-card ${session.id === activeId ? 'felix-session-card--active' : ''}`} data-testid={`session-card-${session.id}`}>
              <MessageSquare size={19} className="felix-session-icon" />
              <button type="button" className="felix-session-open" aria-label={t('navigation.sessionResume', { title: session.title })} onClick={() => openSession(session.id)}>
                <strong>{session.title}</strong>
                <span className="felix-session-meta">
                  <time dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                  <span>{t('navigation.messagesCount', { count: session.messageCount })}</span>
                  {session.status !== 'idle' && <span>{t(`navigation.sessionStatus${session.status === 'running' ? 'Running' : 'Error'}`)}</span>}
                </span>
                {(session.recentSymbols ?? []).length > 0 && <span className="felix-session-symbols">{session.recentSymbols!.join(' · ')}</span>}
              </button>
              <ArrowUpRight size={17} className="text-foreground/40" aria-hidden="true" />
              <button type="button" className="felix-hub-remove" aria-label={t('navigation.deleteSession', { title: session.title })} onClick={() => { setPendingDelete(session); setDeleteError(''); }}><Trash2 size={16} /></button>
            </article>)}
            {filtered.length === 0 && <div className="felix-hub-empty"><MessageSquare size={26} /><p>{t(query.trim() ? 'navigation.noMatches' : 'navigation.noSessions')}</p></div>}
          </div>
        </>}
      </section>
      <Dialog open={Boolean(pendingDelete)} onClose={() => { if (!deleting) setPendingDelete(null); }} title={t('navigation.sessionDeleteTitle')}>
        <p className="mb-5 text-sm text-foreground/70">{t('navigation.sessionDeleteConfirm', { title: pendingDelete?.title })}</p>
        {deleteError && <p role="alert" className="mb-3 text-sm text-negative">{deleteError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => setPendingDelete(null)}>{t('navigation.cancel')}</Button>
          <Button variant="destructive" disabled={deleting} onClick={async () => {
            if (!pendingDelete) return;
            setDeleting(true);
            try {
              const result = await deleteSession(client, pendingDelete.id);
              if (result === false) setDeleteError(t('navigation.sessionDeleteFailed'));
              else setPendingDelete(null);
            } catch { setDeleteError(t('navigation.sessionDeleteFailed')); }
            finally { setDeleting(false); }
          }}>{t('navigation.confirmDelete')}</Button>
        </div>
      </Dialog>
    </main>
  );
};
