import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronRight, Square, Sparkles, History, Plus, X, Maximize2, Minimize2 } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ApiError, FelixTrace, PortfolioSnapshot, Quote, ToolCall } from '@finagent/core';
import {
  activeMessagesAtom,
  activeSessionIdAtom,
  agentPanelVisibleAtom,
  cancelRunAtom,
  createSessionAtom,
  lastRunSummaryAtom,
  loadMessagesAtom,
  mobileAgentVisibleAtom,
  navSectionAtom,
  runViewAtom,
  settingsTabAtom,
  assistantWorkspaceContextAtom,
  type LastRunSummary,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { MessageList } from '../chat/MessageList';
import { AnswerContent } from '../chat/AnswerContent';
import { ModelSelector } from './ModelSelector';
import { ThinkingSelector } from './ThinkingSelector';
import { ToolActivity } from './ToolActivity';
import { ContextChip } from './ContextChip';
import { TraceInspector } from '../trace/TraceInspector';
import { loadSessionTraceSources, projectSessionTrace } from '../../lib/traceData';
import { QuoteCard } from './structured/QuoteCard';
import { PortfolioRiskCard } from './structured/PortfolioRiskCard';
import { AgentAmbientField, type AgentMotionState } from '../motion/AgentAmbientField';
import { AssistantWelcome } from './AssistantWelcome';
import { AssistantHistory } from './AssistantHistory';

// ---------------------------------------------------------------------------
// Defensive parsing of structured tool results (get_quote / get_portfolio).
// Results may be a plain object, a { data } wrapper, or a JSON string.
// ---------------------------------------------------------------------------

function unwrapStructuredResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: unknown }).data;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function isQuote(value: unknown): value is Quote {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.lastPrice === 'number' && (typeof v.symbol === 'string' || typeof v.change === 'number');
}

function isPortfolio(value: unknown): value is PortfolioSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.holdings);
}

function extractQuote(toolCalls: ToolCall[]): Quote | null {
  const call = toolCalls.find((tc) => tc.toolName === 'get_quote' && tc.status === 'success');
  if (!call) return null;
  const data = unwrapStructuredResult(call.result);
  if (!isQuote(data)) return null;
  const symbol =
    (typeof data.symbol === 'string' && data.symbol) ||
    (typeof call.args?.symbol === 'string' ? call.args.symbol : '');
  return { ...data, symbol: symbol || '—' };
}

function extractPortfolio(toolCalls: ToolCall[]): PortfolioSnapshot | null {
  const call = toolCalls.find((tc) => tc.toolName === 'get_portfolio' && tc.status === 'success');
  if (!call) return null;
  const data = unwrapStructuredResult(call.result);
  return isPortfolio(data) ? data : null;
}

// ---------------------------------------------------------------------------
// AgentPanel — the right-hand copilot.
// ---------------------------------------------------------------------------

export const AgentPanel: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [messages] = useAtom(activeMessagesAtom);
  const [activeSessionId, setActiveSessionId] = useAtom(activeSessionIdAtom);
  const [runView, setRunView] = useAtom(runViewAtom);
  const setAgentPanelVisible = useSetAtom(agentPanelVisibleAtom);
  const setMobileAgentVisible = useSetAtom(mobileAgentVisibleAtom);
  const createSession = useSetAtom(createSessionAtom);
  const cancelRun = useSetAtom(cancelRunAtom);
  const [lastRun, setLastRun] = useAtom(lastRunSummaryAtom);
  const workspaceContext = useAtomValue(assistantWorkspaceContextAtom);

  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [traceDialog, setTraceDialog] = useState<{ runId: string; trace: FelixTrace | null } | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const isRunning = runView !== null && runView.infraError === undefined;
  const busy = isRunning || pending;
  const closeAssistant = () => { setAgentPanelVisible(false); setMobileAgentVisible(false); setExpanded(false); };

  // The run_completed event payload does not carry financial evidence (the
  // envelopes are built when the run settles). Once a run finishes, refresh the
  // message list from the store so the persisted evidence-backed message — with
  // resolvable citations — replaces the synthesized live one (#30).
  const loadMessages = useSetAtom(loadMessagesAtom);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (!isRunning && wasRunningRef.current && activeSessionId) {
      void loadMessages(client, activeSessionId);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, activeSessionId, client, loadMessages]);
  const agentMotionState: AgentMotionState = runView?.infraError
    ? 'error'
    : runView?.toolCalls.some((toolCall) => toolCall.status === 'running')
      ? 'tool'
      : runView?.answer
        ? 'synthesizing'
        : isRunning
          ? 'thinking'
          : 'idle';

  useEffect(() => {
    if (messages.length === 0 && !isRunning) {
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      return;
    }
    if (!shouldAutoScrollRef.current) return;
    bodyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isRunning, runView?.answer, runView?.toolCalls]);

  const handleBodyScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 24;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isRunning || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);

    setInput('');
    setSendError(null);
    try {
      const sessionId = activeSessionId ?? (await createSession(client))?.id;
      if (!sessionId) throw new Error(t('navigation.sessionCreateFailed'));
      // V9.1 §2: capture the ACTUAL context this live run starts with so the
      // run footer's trace can show it as 'Live' — never guessed later.
      setLastRun((previous) => ({
        runId: previous?.runId ?? '',
        sessionId,
        status: 'running',
        startedAt: previous?.startedAt ?? Date.now(),
        toolCount: 0,
        workspaceContext,
      }));
      const result = await client.kernel.startRun(sessionId, text, workspaceContext);
      if (!result.ok) {
        setSendError(result.error.message);
        setInput(text);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : t('navigation.sessionCreateFailed'));
      setInput(text);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  /** V9.1 §8/§12: open the Trace Inspector for the last finished run. */
  const handleOpenTrace = async () => {
    if (!lastRun || !activeSessionId) return;
    setTraceDialog({ runId: lastRun.runId, trace: null });
    setTraceLoading(true);
    try {
      const source = await loadSessionTraceSources(client, activeSessionId, lastRun.runId);
      if (!source) {
        setTraceDialog({ runId: lastRun.runId, trace: null });
        return;
      }
      // For a LIVE run the panel's captured context is the actual runtime
      // context (source 'live'); for a finished run it stays honest: the
      // projection only emits fields from persisted sources.
      const isLive = lastRun.status === 'running';
      const trace = projectSessionTrace({
        ...source,
        liveToolCalls: isLive ? runView?.toolCalls : undefined,
        liveContext: isLive ? lastRun.workspaceContext : undefined,
      });
      setTraceDialog({ runId: lastRun.runId, trace });
    } finally {
      setTraceLoading(false);
    }
  };

  const handleOpenLangSmith = (url: string): void => {
    void client.openExternal?.(url);
  };

  /** V8.1 §38: retry the last user message after an infra failure. */
  const handleRetry = async () => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser || !activeSessionId) return;
    setSendError(null);
    const result = await client.kernel.startRun(activeSessionId, lastUser.content, workspaceContext);
    if (!result.ok) {
      setSendError(result.error.message);
    }
  };

  const handleStop = async () => {
    await cancelRun(client);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const toolCalls = runView?.toolCalls ?? [];
  const quote = extractQuote(toolCalls);
  const portfolio = extractPortfolio(toolCalls);

  const panel = (
    <aside
      data-testid="agent-panel"
      className={`felix-agent-panel mac-sidebar flex h-full w-full flex-col border-l mac-section-divider ${expanded ? "felix-assistant-expanded" : ""}`}
    >
      <div className="felix-assistant-header border-b mac-section-divider">
        <div className="felix-assistant-heading">
          <div className="felix-assistant-title"><Sparkles size={18} />{t('agent.panel.title')}</div>
          <div className="felix-assistant-actions">
            <button type="button" data-testid="assistant-history" disabled={busy} aria-pressed={historyOpen} aria-label={t('agent.welcome.history')} title={t('agent.welcome.history')} onClick={() => setHistoryOpen(!historyOpen)}><History size={17} /></button>
            <button type="button" data-testid="assistant-new-session" disabled={busy} aria-label={t('agent.welcome.newSession')} title={t('agent.welcome.newSession')} onClick={() => { setActiveSessionId(null); setRunView(null); setHistoryOpen(false); setInput(''); setSendError(null); inputRef.current?.focus(); }}><Plus size={18} /></button>
            <button type="button" data-testid="assistant-expand" aria-label={t(expanded ? 'agent.welcome.restore' : 'agent.welcome.expand')} title={t(expanded ? 'agent.welcome.restore' : 'agent.welcome.expand')} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            <button type="button" data-testid="assistant-close" aria-label={t('agent.welcome.close')} title={t('agent.welcome.close')} onClick={closeAssistant}><X size={18} /></button>
          </div>
        </div>
        <div className="felix-assistant-models"><ModelSelector disabled={busy} /><ThinkingSelector disabled={busy} /></div>
      </div>
      {historyOpen && <AssistantHistory busy={busy} onSelect={async (session) => {
          if (pendingRef.current || isRunning) return;
          pendingRef.current = true; setPending(true); setSendError(null);
          try {
            const loaded = await loadMessages(client, session.id);
            if (!loaded) throw new Error(t('agent.runtime.reasonUnknown'));
            setRunView(null); setActiveSessionId(session.id); setInput(''); setHistoryOpen(false);
          }
          catch (error) { setSendError(error instanceof Error ? error.message : t('agent.runtime.reasonUnknown')); }
          finally { pendingRef.current = false; setPending(false); }
        }} />}

      {/* Workspace context chip */}
      <div className="felix-agent-context border-b mac-section-divider px-3 py-2">
        <ContextChip disabled={busy} />
      </div>

      {/* Scrollable body: tool activity, structured results, messages, live answer */}
      <div
        ref={bodyRef}
        onScroll={handleBodyScroll}
        className="felix-agent-body flex-1 overflow-y-auto scrollbar-hover"
      >
        <div className="flex flex-col gap-3 p-3">
          {runView?.infraError && (
            <RuntimeInfraBanner
              error={runView.infraError}
              onRetry={() => void handleRetry()}
            />
          )}
          {isRunning ? (
            <div className="felix-agent-activity-surface rounded-[10px] border border-border bg-surface-muted px-3 py-2" data-testid="agent-activity-surface">
              <AgentAmbientField state={agentMotionState} />
              <div className="relative flex items-center gap-2 text-[11px] text-foreground/64">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                <span className="font-medium">{runView?.toolCalls.some((toolCall) => toolCall.status === 'running') ? t('agent.tool.running') : t('agent.panel.agentRunning')}</span>
              </div>
              <div className="relative mt-2">
                <ToolActivity toolCalls={toolCalls} />
              </div>
            </div>
          ) : (
            <ToolActivity toolCalls={toolCalls} />
          )}
          {quote && <QuoteCard quote={quote} />}
          {portfolio && <PortfolioRiskCard portfolio={portfolio} />}
          {messages.length === 0 && !busy ? <AssistantWelcome onPick={(text) => {
            setInput(text); setSendError(null); inputRef.current?.focus();
          }} /> : <MessageList messages={messages} isLoading={busy} />}
          {isRunning && <StreamingBlock answer={runView?.answer ?? ''} />}
          <RunFooter
            lastRun={lastRun}
            activeSessionId={activeSessionId}
            onOpenTrace={() => void handleOpenTrace()}
          />
          <div ref={bodyEndRef} />
        </div>
      </div>

      {/* Input / send / stop — send lives inline in the composer (Stitch design) */}
      <div className="felix-agent-composer border-t mac-section-divider bg-surface px-3 py-3">
        <div className="relative">
          <textarea
            ref={inputRef}
            data-testid="agent-input"
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? t('agent.panel.inputRunningPlaceholder') : t('agent.panel.inputPlaceholder')}
            disabled={busy}
            rows={2}
            className="mac-input felix-agent-textarea w-full resize-none px-3 py-2.5 pr-11 text-[13px] leading-relaxed text-foreground placeholder:text-foreground/38 focus:border-[rgba(var(--accent-rgb),0.34)] focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
          />
          {!isRunning && (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim() || busy}
              className="mac-primary-button felix-agent-send absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full transition-smooth active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('agent.panel.sendMessage')}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
            </button>
          )}
        </div>
        {messages.length === 0 && !busy && <p className="felix-assistant-draft-hint">{t('agent.welcome.draftHint')}</p>}
        {sendError && <div className="mt-1.5 text-[11px] text-destructive">{sendError}</div>}
        {isRunning && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleStop()}
              className="flex items-center gap-1.5 rounded-full border border-destructive/30 px-3 py-1.5 text-[12px] font-semibold text-destructive transition-smooth hover:bg-destructive/10"
            >
              <Square className="h-3 w-3 fill-current" />
              {t('agent.panel.stop')}
            </button>
          </div>
        )}
      </div>
      {/* Trace Inspector (progressive disclosure — only from the footer) */}
      {traceDialog && (
        <TraceInspector
          trace={traceDialog.trace}
          onClose={() => setTraceDialog(null)}
          onOpenLangSmith={handleOpenLangSmith}
        />
      )}
    </aside>
  );
  return expanded ? createPortal(panel, document.body) : panel;
};

/**
 * Completed/failed run footer with the secondary Trace affordance (V9.1 §12).
 * The semantic activity above remains the primary experience.
 */
const RunFooter: React.FC<{
  lastRun: LastRunSummary | null;
  activeSessionId: string | null;
  onOpenTrace: () => void;
}> = ({ lastRun, activeSessionId, onOpenTrace }) => {
  const { t } = useTranslation();
  if (!lastRun || lastRun.status === 'running' || lastRun.sessionId !== activeSessionId) return null;
  const durationSec =
    lastRun.completedAt != null && lastRun.completedAt >= lastRun.startedAt
      ? Math.max(0, Math.round((lastRun.completedAt - lastRun.startedAt) / 100) / 10)
      : undefined;
  const failed = lastRun.status === 'failed';
  const summary = failed
    ? t('trace.footer.failed', { tools: lastRun.toolCount })
    : t('trace.footer.completed', { seconds: durationSec ?? 0, steps: lastRun.toolCount });
  return (
    <div
      data-testid="run-footer"
      className={`flex items-center justify-between gap-2 rounded-[10px] border px-3 py-2 ${
        failed ? 'border-destructive/24 bg-destructive/5' : 'border-border bg-surface-muted'
      }`}
    >
      <span className={`text-[11px] ${failed ? 'text-negative' : 'text-foreground/60'}`}>{summary}</span>
      <button
        type="button"
        onClick={onOpenTrace}
        data-testid="run-footer-trace"
        className="flex items-center gap-1 rounded-[7px] border border-border px-2 py-1 text-[11px] font-medium text-foreground/64 transition-smooth hover:border-border-strong hover:text-foreground"
      >
        {t('trace.footer.trace')}
        <ChevronRight className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </div>
  );
};
/** Live streaming answer block while a run is executing. */
const StreamingBlock: React.FC<{ answer: string }> = ({ answer }) => {
  const { t } = useTranslation();
  return (
    <div data-testid="run-panel" className="rounded-[10px] border mac-section-divider bg-surface px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-foreground/48">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        {t('agent.panel.agentRunning')}
      </div>
      {answer.length > 0 ? (
        <AnswerContent content={answer} streaming className="text-[13px] text-foreground/72" />
      ) : (
        <div className="text-[13px] italic text-foreground/40">{t('agent.panel.thinking')}</div>
      )}
    </div>
  );
};

/** Map a runtime infra code to a user-facing reason key (V8.1 §38). */
function runtimeReasonKey(code: string | undefined): string {
  switch (code) {
    case 'PI_LLM_ENV_MISSING':
      return 'agent.runtime.reasonEnvMissing';
    case 'PI_RUNTIME_NOT_FOUND':
      return 'agent.runtime.reasonCommand';
    default:
      return 'agent.runtime.reasonUnknown';
  }
}

/**
 * V8.1 §38–39 — persistent route for *infrastructure* failures. Rendered
 * instead of an assistant-style chat message: distinct styling, an actionable
 * reason, Retry, and a Diagnostics shortcut. A successful retry clears it via
 * the run_started event (runAtoms clears infraError).
 */
const RuntimeInfraBanner: React.FC<{ error: ApiError; onRetry: () => void }> = ({
  error,
  onRetry,
}) => {
  const { t } = useTranslation();
  const setNavSection = useSetAtom(navSectionAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const openDiagnostics = (): void => {
    setSettingsTab('diagnostics');
    setNavSection('settings');
  };

  return (
    <div
      data-testid="runtime-infra-banner"
      role="alert"
      className="rounded-[10px] border border-destructive/26 bg-destructive/6 px-3.5 py-3 text-[13px]"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        <span className="font-semibold text-foreground">{t('agent.runtime.unavailable')}</span>
      </div>
      <p className="text-foreground/76">{t('agent.runtime.failedToStart')}</p>
      <p className="mt-1 text-foreground/56">{t(runtimeReasonKey(error.code))}</p>
      {error.action && (
        <p className="mt-1 text-[12px] text-foreground/46">{error.action}</p>
      )}
      <p className="mt-2 text-[11px] select-text break-words text-foreground/38">
        {t('agent.runtime.detailsLabel')}: {error.message}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="mac-primary-button h-8 rounded-[9px] px-3 text-[12px] font-semibold transition-smooth active:scale-[0.985]"
        >
          {t('agent.runtime.retry')}
        </button>
        <button
          type="button"
          onClick={openDiagnostics}
          className="h-8 rounded-[9px] border mac-section-divider px-3 text-[12px] font-medium text-foreground/72 transition-smooth hover:bg-foreground/6"
        >
          {t('agent.runtime.openDiagnostics')}
        </button>
      </div>
    </div>
  );
};
