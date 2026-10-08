import React, { useEffect, useState } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useAtomValue } from 'jotai';
import { agentPanelVisibleAtom, activeSessionIdAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { ErrorBoundary } from '../primitives/ErrorBoundary';
import { Sidebar } from './Sidebar';
import { FinanceWorkspace } from '../workspace/FinanceWorkspace';
import { AgentPanel } from '../agent/AgentPanel';
import { WorkspaceTopbar } from './WorkspaceTopbar';

const SIZES_KEY = 'allotmentSizes';
const DEFAULT_SIZES = [224, 800, 360];

export const WorkbenchShell: React.FC = () => {
  const client = useFinagentClient();
  const sessionId = useAtomValue(activeSessionIdAtom);
  const [mobileAgent, setMobileAgent] = useState(false);
  const agentPanelVisible = useAtomValue(agentPanelVisibleAtom);
  const [sizes, setSizes] = useState<number[]>(() => readPersisted<number[]>(SIZES_KEY, DEFAULT_SIZES));
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { if (client.deployment && isNarrow && sessionId) setMobileAgent(true); }, [client, isNarrow, sessionId]);

  // Keep persisted sizes sane: always three panes, positive values.
  const normalized = sizes.length === 3 && sizes.every((s) => Number.isFinite(s) && s > 0)
    ? sizes
    : DEFAULT_SIZES;

  const handleDragEnd = (next: number[]): void => {
    // Allotment redistributes the hidden pane's width when Copilot is closed.
    // Keep the user's sidebar preference while preserving the last Copilot
    // width for the next time the third pane is restored.
    if (next.length === 2) {
      setSizes((current) => {
        const updated = [next[0] ?? current[0], current[1], current[2]];
        writePersisted(SIZES_KEY, updated);
        return updated;
      });
      return;
    }
    setSizes(next);
    writePersisted(SIZES_KEY, next);
  };

  // When the agent panel toggles off and back on, Allotment restores its
  // remembered width automatically; no extra state required.
  const showAgent = agentPanelVisible && !isNarrow;

  if (client.deployment && isNarrow) return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <nav aria-label="视图切换" className="flex shrink-0 gap-2 border-b border-border p-2">
        <button className="rounded border border-border px-3 py-1 text-xs" aria-pressed={!mobileAgent} onClick={() => setMobileAgent(false)}>工作台（Workspace）</button>
        <button className="rounded border border-border px-3 py-1 text-xs" aria-pressed={mobileAgent} onClick={() => setMobileAgent(true)}>研究助手（Copilot）</button>
      </nav>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-14 shrink-0"><Sidebar /></aside>
        <div className="min-w-0 flex-1 overflow-hidden"><ErrorBoundary>{mobileAgent ? <AgentPanel /> : <FinanceWorkspace />}</ErrorBoundary></div>
      </div>
    </div>
  );

  return (
    <div className="relative h-full flex-1 overflow-hidden">
      <Allotment
        key={showAgent ? 'workbench-with-agent' : isNarrow ? 'workbench-narrow' : 'workbench-without-agent'}
        className="h-full"
        defaultSizes={showAgent ? normalized : isNarrow ? [56, Math.max(320, normalized[1])] : [normalized[0], normalized[1] + normalized[2]]}
        onDragEnd={handleDragEnd}
      >
        <Allotment.Pane minSize={isNarrow ? 56 : 200} maxSize={isNarrow ? 56 : 280} preferredSize={isNarrow ? 56 : Math.min(normalized[0], 280)}>
          <Sidebar />
        </Allotment.Pane>
        <Allotment.Pane minSize={isNarrow ? 320 : 500}>
          <ErrorBoundary>
            <div className="flex h-full min-h-0 flex-col">
              <WorkspaceTopbar />
              <div className="min-h-0 flex-1">
                <FinanceWorkspace />
              </div>
            </div>
          </ErrorBoundary>
        </Allotment.Pane>
        {showAgent && (
          <Allotment.Pane minSize={320} preferredSize={normalized[2]} snap>
            <ErrorBoundary>
              <AgentPanel />
            </ErrorBoundary>
          </Allotment.Pane>
        )}
      </Allotment>
    </div>
  );
};
