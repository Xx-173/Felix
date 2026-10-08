import React, { useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { watchlistAtom, watchlistGroupsAtom } from '../../atoms';
import { previewWatchlistImport } from '../../lib/watchlist';
import { Dialog } from '../primitives/Dialog';
import { Button } from '../primitives/Button';

export const WatchlistImportDialog: React.FC<{ onClose: () => void; groupId?: string }> = ({ onClose, groupId }) => {
  const { t } = useTranslation();
  const [watchlist, setWatchlist] = useAtom(watchlistAtom);
  const [groups, setGroups] = useAtom(watchlistGroupsAtom);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [target, setTarget] = useState(groupId ?? '');
  const rows = useMemo(() => previewWatchlistImport(text, watchlist), [text, watchlist]);
  const eligible = rows.filter((row) => row.status === 'new').map((row) => row.symbol);
  return <Dialog open onClose={onClose} title={t('navigation.watchlistImport')} className="felix-watchlist-dialog">
    <p className="mb-3 text-xs text-foreground/65">{t('navigation.importInstructions')}</p>
    <label className="mb-3 block text-xs">{t('navigation.importCodes')}
      <textarea aria-label={t('navigation.importCodes')} value={text} maxLength={20000} onChange={(event) => { setText(event.target.value); setError(''); }} placeholder={'AAPL.US\n0700.HK\n600519.SH'} className="mt-2 h-24 w-full rounded-lg border border-input bg-surface p-3 text-xs" />
    </label>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <label className="felix-import-file text-xs">{t('navigation.importFile')}<input aria-label={t('navigation.importFile')} type="file" accept=".txt,.csv,text/plain,text/csv" onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 20000) { setError(t('navigation.importTooLarge')); return; }
        try { setText(await file.text()); setError(''); } catch { setError(t('navigation.importReadFailed')); }
      }} /></label>
      <select aria-label={t('navigation.importTarget')} value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">{t('navigation.ungrouped')}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
    </div>
    {error && <p role="alert" className="mb-2 text-xs text-negative">{error}</p>}
    <p role="status" className="mb-2 text-xs text-foreground/65">{t('navigation.importSummary', { count: eligible.length, skipped: rows.length - eligible.length })}</p>
    <div className="felix-import-preview" data-testid="watchlist-import-preview">
      {rows.map((row, index) => <div key={index} data-state={row.status}><span>{row.input}</span><span>{t('navigation.importStatus' + row.status[0]!.toUpperCase() + row.status.slice(1))}</span></div>)}
    </div>
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="outline" onClick={onClose}>{t('navigation.cancel')}</Button>
      <Button disabled={eligible.length === 0 || Boolean(error)} onClick={() => {
        setWatchlist((current) => [...new Set([...current, ...eligible])]);
        if (target) setGroups((current) => current.map((group) => group.id === target ? { ...group, symbols: [...new Set([...group.symbols, ...eligible])] } : group));
        onClose();
      }}>{t('navigation.importConfirm', { count: eligible.length })}</Button>
    </div>
  </Dialog>;
};
