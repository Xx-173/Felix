import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { MAX_WATCHLIST_GROUPS } from '@finagent/core';
import { watchlistGroupsAtom } from '../../atoms';
import { Dialog } from '../primitives/Dialog';
import { Button } from '../primitives/Button';

/** Group removal never removes securities from the parent watchlist. */
export const WatchlistGroupsDialog: React.FC<{ onClose: () => void; symbol?: string }> = ({ onClose, symbol }) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useAtom(watchlistGroupsAtom);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40 || groups.some((group) => group.id !== editing && group.name.toLowerCase() === trimmed.toLowerCase())) { setError(t('navigation.groupNameInvalid')); return; }
    if (!editing && groups.length >= MAX_WATCHLIST_GROUPS) { setError(t('navigation.groupLimit')); return; }
    setGroups((current) => editing
      ? current.map((group) => group.id === editing ? { ...group, name: trimmed } : group)
      : [...current, { id: crypto.randomUUID(), name: trimmed, symbols: symbol ? [symbol] : [] }]);
    setName(''); setEditing(null); setError('');
  };
  return <Dialog open onClose={onClose} title={symbol ? `${t('navigation.groupMembership')} · ${symbol}` : t('navigation.manageGroups')} className="felix-watchlist-dialog">
    <p className="mb-4 text-xs text-foreground/65">{t('navigation.groupInstructions')}</p>
    <div className="felix-group-editor">
      <input aria-label={t('navigation.groupName')} maxLength={40} value={name} placeholder={t('navigation.groupName')} onChange={(event) => { setName(event.target.value); setError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') save(); }} />
      <Button size="sm" onClick={save}>{t(editing ? 'navigation.groupSaveName' : 'navigation.groupCreate')}</Button>
      {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setName(''); }}>{t('navigation.cancel')}</Button>}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-negative">{error}</p>}
    <div className="felix-group-list">
      {groups.map((group) => <div key={group.id} className="felix-group-editor-row">
        {symbol ? <label><input type="checkbox" checked={group.symbols.includes(symbol)} onChange={(event) => setGroups((current) => current.map((entry) => entry.id !== group.id ? entry : { ...entry, symbols: event.target.checked ? [...new Set([...entry.symbols, symbol])] : entry.symbols.filter((item) => item !== symbol) }))} />{group.name}</label> : <span>{group.name} <small>{group.symbols.length}</small></span>}
        <Button size="sm" variant="ghost" aria-label={t('navigation.groupRename', { name: group.name })} onClick={() => { setEditing(group.id); setName(group.name); setError(''); }}>{t('navigation.groupRenameAction')}</Button>
        <Button size="sm" variant="ghost" aria-label={t('navigation.groupDelete', { name: group.name })} onClick={() => setRemoving(group.id)}>{t('navigation.groupDeleteAction')}</Button>
        {removing === group.id && <div className="felix-group-delete-confirm">
          <p>{t('navigation.groupDeleteConfirm')}</p>
          <Button size="sm" variant="outline" onClick={() => setRemoving(null)}>{t('navigation.cancel')}</Button>
          <Button size="sm" variant="destructive" onClick={() => { setGroups((current) => current.filter((entry) => entry.id !== group.id)); setRemoving(null); if (editing === group.id) { setEditing(null); setName(''); } }}>{t('navigation.confirmDelete')}</Button>
        </div>}
      </div>)}
      {groups.length === 0 && <p className="py-5 text-xs text-foreground/50">{t('navigation.groupEmpty')}</p>}
    </div>
    <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>{t('navigation.done')}</Button></div>
  </Dialog>;
};
