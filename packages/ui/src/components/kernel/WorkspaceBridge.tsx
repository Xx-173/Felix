import React, { useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';
import type { FinagentClient } from '../../client';
import { watchlistAtom } from '../../atoms/quoteAtoms';

export const WorkspaceBridge: React.FC<{ client: FinagentClient }> = ({ client }) => {
  const [watchlist, setWatchlist] = useAtom(watchlistAtom);
  const [ready, setReady] = useState(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false; setReady(false);
    if (client.workspace) void client.workspace.get().then((result) => {
      if (!cancelled && result.ok) { setWatchlist(result.data.watchlist); setReady(true); }
      else if (!cancelled) toast.error('自选股加载失败，刷新后重试（Watchlist could not load; reload to retry）。');
    });
    return () => { cancelled = true; };
  }, [client, setWatchlist]);
  useEffect(() => {
    if (!ready || !client.workspace) return;
    writes.current = writes.current.catch(() => undefined).then(async () => {
      const result = await client.workspace!.update({ watchlist });
      if (!result.ok) toast.error('自选股保存失败（Watchlist could not be saved）：' + result.error.message);
    });
  }, [client, ready, watchlist]);
  return null;
};
