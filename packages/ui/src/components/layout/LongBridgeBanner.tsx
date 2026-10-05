import React, { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { LongBridgeStatus } from '@finagent/core';
import { useFinagentClient } from '../../client';
import { subscribeConnections } from '../../client/connections';
import { navSectionAtom, settingsTabAtom } from '../../atoms';
import { Button } from '../primitives/Button';

/** Stable, localized status copy; raw CLI stderr belongs in diagnostics. */
export const LongBridgeBanner: React.FC = () => {
  const client = useFinagentClient();
  const { t } = useTranslation();
  const setNav = useSetAtom(navSectionAtom);
  const setTab = useSetAtom(settingsTabAtom);
  const [status, setStatus] = useState<LongBridgeStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => subscribeConnections(client, () => setRevision((value) => value + 1)), [client]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const result = await client.longbridge.getStatus();
        if (!active) return;
        setStatus(result.ok ? result.data : null);
        setFailed(!result.ok);
      } catch {
        if (!active) return;
        setStatus(null);
        setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [client, revision]);

  if (!failed && (!status || status.available)) return null;

  // Older backends may omit the status enum. Never render their raw message.
  const state = status?.status ?? (status?.authenticated ? 'unknown' : status?.installed ? 'not_authed' : 'not_installed');
  const knownStates = ['not_installed', 'not_authed', 'rate_limited', 'timeout'];
  const messageKey = failed || !knownStates.includes(state) ? 'unknown' : state;

  return (
    <div role="status" className="felix-banner flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
      <span className="min-w-0 flex-1 text-foreground/78">{t(`connections.longbridgeBanner.${messageKey}`)}</span>
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
        {t(loading ? 'common.loading' : 'common.retry')}
      </Button>
      <Button variant="outline" size="sm" onClick={() => { setTab('connections'); setNav('settings'); }}>
        {t('profile.openConnections')}
      </Button>
    </div>
  );
};
