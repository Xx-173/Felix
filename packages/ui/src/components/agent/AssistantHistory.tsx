import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Search, Trash2 } from 'lucide-react';
import type { SessionMeta } from '@finagent/core';
import { activeSessionIdAtom, deleteSessionAtom, sessionsAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { Dialog } from '../primitives/Dialog';
import { Button } from '../primitives/Button';

export const AssistantHistory: React.FC<{ busy: boolean; onSelect: (session: SessionMeta) => void }> = ({ busy, onSelect }) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const sessions = useAtomValue(sessionsAtom);
  const activeId = useAtomValue(activeSessionIdAtom);
  const removeSession = useSetAtom(deleteSessionAtom);
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SessionMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const visible = sessions.filter((session) => (session.messageCount > 0 || session.status === 'running')
    && `${session.title} ${(session.recentSymbols ?? []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return <section className="felix-assistant-history" data-testid="assistant-history-list" aria-label={t('agent.welcome.history')}>
    <h3>{t('agent.welcome.history')}</h3>
    <label className="felix-history-search"><Search size={15} /><input aria-label={t('navigation.sessionSearch')} placeholder={t('navigation.sessionSearch')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {visible.map((session) => <article key={session.id} className="felix-assistant-history-row">
      <button type="button" className="felix-history-open" disabled={busy || deleting} aria-current={session.id === activeId ? 'true' : undefined} aria-label={t('navigation.sessionResume', { title: session.title })} onClick={() => onSelect(session)}>
        <span>{session.title}<small>{(session.recentSymbols ?? []).join(' · ')}</small></span><small>{t('navigation.messagesCount', { count: session.messageCount })}</small>
      </button>
      <button type="button" className="felix-history-delete" disabled={busy || deleting} aria-label={t('navigation.deleteSession', { title: session.title })} onClick={() => { setPendingDelete(session); setError(''); }}><Trash2 size={15} /></button>
    </article>)}
    {visible.length === 0 && <p>{t(query.trim() ? 'navigation.noMatches' : 'agent.welcome.historyEmpty')}</p>}
    <Dialog open={Boolean(pendingDelete)} onClose={() => { if (!deleting) setPendingDelete(null); }} title={t('navigation.sessionDeleteTitle')}>
      <p className="mb-5 text-sm text-foreground/70">{t('navigation.sessionDeleteConfirm', { title: pendingDelete?.title })}</p>
      {error && <p role="alert" className="mb-3 text-sm text-negative">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={deleting} onClick={() => setPendingDelete(null)}>{t('navigation.cancel')}</Button>
        <Button variant="destructive" disabled={busy || deleting} onClick={async () => {
          if (!pendingDelete || busy || deleting) return;
          setDeleting(true);
          try { if (await removeSession(client, pendingDelete.id)) setPendingDelete(null); else setError(t('navigation.sessionDeleteFailed')); }
          catch { setError(t('navigation.sessionDeleteFailed')); }
          finally { setDeleting(false); }
        }}>{t('navigation.confirmDelete')}</Button>
      </div>
    </Dialog>
  </section>;
};
