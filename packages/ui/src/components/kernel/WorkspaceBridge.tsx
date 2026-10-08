import React, { useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';
import type { FinagentClient } from '../../client';
import { watchlistAtom, watchlistGroupsAtom } from '../../atoms/quoteAtoms';

export const WorkspaceBridge: React.FC<{ client: FinagentClient }> = ({ client }) => {
  const [watchlist, setWatchlist] = useAtom(watchlistAtom);
  const [groups, setGroups] = useAtom(watchlistGroupsAtom);
  const [ready, setReady] = useState(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false; setReady(false);
    if (client.workspace) void client.workspace.get().then((result) => {
      if (!cancelled && result.ok) { setWatchlist(result.data.watchlist); setGroups(result.data.groups ?? []); setReady(true); }
      else if (!cancelled) toast.error('自选股加载失败，刷新后重试。');
    });
    return () => { cancelled = true; };
  }, [client, setWatchlist, setGroups]);
  useEffect(() => {
    if (!ready || !client.workspace) return;
    writes.current = writes.current.catch(() => undefined).then(async () => {
      const result = await client.workspace!.update({ watchlist, groups });
      if (!result.ok) toast.error('自选股保存失败：' + result.error.message);
    });
  }, [client, ready, watchlist, groups]);
  return null;
};
