import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { agentPanelVisibleAtom, createSessionAtom, mobileAgentVisibleAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { clampFloatingPosition } from '../../lib/market-dashboard';

/** A global launcher: dragging moves it; clicking creates a session without changing the page. */
export const NewSessionFloatingButton: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const createSession = useSetAtom(createSessionAtom);
  const showAgent = useSetAtom(agentPanelVisibleAtom);
  const showMobileAgent = useSetAtom(mobileAgentVisibleAtom);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [position, setPosition] = useState(() => {
    const saved = readPersisted<{ x: number; y: number } | null>('newSessionPosition', null);
    return clampFloatingPosition(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: window.innerWidth - 80, y: window.innerHeight - 150 }, window.innerWidth, window.innerHeight);
  });
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const resize = () => setPosition((current) => clampFloatingPosition(current, window.innerWidth, window.innerHeight));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return createPortal(<button type="button" className="felix-session-fab" data-testid="new-session-fab" aria-label={t('navigation.newSession')} title={t('navigation.floatingSessionHint')} disabled={busy}
    style={{ left: position.x, top: position.y }}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false; }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      suppressClick.current = false;
      drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const current = drag.current;
      if (!current) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) > 6) current.moved = true;
      if (current.moved) setPosition(clampFloatingPosition({ x: current.left + dx, y: current.top + dy }, window.innerWidth, window.innerHeight));
    }}
    onPointerUp={() => { if (drag.current?.moved) { suppressClick.current = true; writePersisted('newSessionPosition', position); } drag.current = null; }}
    onPointerCancel={() => { drag.current = null; suppressClick.current = true; }}
    onLostPointerCapture={() => { if (drag.current) { suppressClick.current = drag.current.moved; drag.current = null; } }}
    onClick={async () => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      if (busyRef.current) return;
      busyRef.current = true; setBusy(true);
      try {
        const session = await createSession(client);
        if (session) { showAgent(true); showMobileAgent(true); }
        else toast.error(t('navigation.sessionCreateFailed'));
      } catch { toast.error(t('navigation.sessionCreateFailed')); }
      finally { busyRef.current = false; setBusy(false); }
    }}>
    {busy ? <LoaderCircle size={24} className="animate-spin" /> : <Sparkles size={25} />}
  </button>, document.body);
};
