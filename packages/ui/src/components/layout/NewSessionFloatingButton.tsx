import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
const bullMarketIcon = new URL('../../assets/bull-market-assistant.png', import.meta.url).href;
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { agentPanelVisibleAtom, mobileAgentVisibleAtom } from '../../atoms';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { clampFloatingPosition } from '../../lib/market-dashboard';

/** A global launcher: dragging moves it; clicking opens the assistant without changing the page. */
export const NewSessionFloatingButton: React.FC = () => {
  const { t } = useTranslation();
  const showAgent = useSetAtom(agentPanelVisibleAtom);
  const showMobileAgent = useSetAtom(mobileAgentVisibleAtom);
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
  return createPortal(<button type="button" className="felix-session-fab" data-testid="new-session-fab" aria-label={t('agent.panel.title')} title={t('agent.welcome.title')}
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
    onClick={() => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      showAgent(true); showMobileAgent(true);
    }}>
    <img data-testid="assistant-bull-icon" src={bullMarketIcon} alt="" draggable={false} />
  </button>, document.body);
};
