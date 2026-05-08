/**
 * Kōdo WebView — M5 UI.
 *
 * New in M5:
 *  - AutonomousToggle: pinned top-left, sends mode.set to server.
 *  - Global StopButton: pinned top-right, sends stop to server at any time.
 *  - ResumeBanner: shown when server emits resume_offer at connection time.
 */

import { h, render } from 'preact';
import { useEffect, useReducer, useRef } from 'preact/hooks';

declare function acquireVsCodeApi(): {
  postMessage(msg: Record<string, unknown>): void;
};

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface LastCallTokens {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

interface FileEventData {
  path: string;
  kind: string;
}

interface GateData {
  gateId: string;
  gateType: string;
  summary: string;
  artifactPath: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  connected: boolean;
  stage: string;
  agent: string | null;
  tokens: string;
  lastPong: string | null;
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
  streaming: boolean;
  fileEvents: FileEventData[];
  pendingGate: GateData | null;
  autonomous: boolean;
  resumeSessionId: string | null;
}

type Action =
  | { type: 'status'; connected: boolean }
  | { type: 'token'; text: string }
  | { type: 'stream_end' }
  | { type: 'pong' }
  | { type: 'stage'; stage: string; agent: string | null }
  | { type: 'agent_started'; agent: string }
  | { type: 'agent_finished'; agent: string }
  | { type: 'usage'; cumulativeUsd: number; lastCallTokens: LastCallTokens | null }
  | { type: 'file_change'; path: string; kind: string }
  | { type: 'approval_request'; gateId: string; gateType: string; summary: string; artifactPath: string | null }
  | { type: 'approval_cleared' }
  | { type: 'autonomous_changed'; autonomous: boolean }
  | { type: 'resume_offer'; sessionId: string }
  | { type: 'resume_dismissed' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'status':
      return { ...state, connected: action.connected };
    case 'token':
      return { ...state, tokens: state.tokens + action.text, streaming: true };
    case 'stream_end':
      return { ...state, streaming: false };
    case 'pong':
      return { ...state, lastPong: new Date().toLocaleTimeString() };
    case 'stage': {
      const clearTokens = action.stage !== 'IDLE' && !state.streaming;
      return {
        ...state,
        stage: action.stage,
        agent: action.agent,
        tokens: clearTokens ? '' : state.tokens,
      };
    }
    case 'agent_started':
      return { ...state, agent: action.agent };
    case 'agent_finished':
      return { ...state, agent: null };
    case 'usage':
      return {
        ...state,
        cumulativeUsd: action.cumulativeUsd,
        lastCallTokens: action.lastCallTokens,
      };
    case 'file_change':
      return {
        ...state,
        fileEvents: [...state.fileEvents, { path: action.path, kind: action.kind }],
      };
    case 'approval_request':
      return {
        ...state,
        pendingGate: {
          gateId: action.gateId,
          gateType: action.gateType,
          summary: action.summary,
          artifactPath: action.artifactPath,
        },
        streaming: false,
      };
    case 'approval_cleared':
      return { ...state, pendingGate: null };
    case 'autonomous_changed':
      return { ...state, autonomous: action.autonomous };
    case 'resume_offer':
      return { ...state, resumeSessionId: action.sessionId };
    case 'resume_dismissed':
      return { ...state, resumeSessionId: null };
    default:
      return state;
  }
}

const initial: State = {
  connected: false,
  stage: 'IDLE',
  agent: null,
  tokens: '',
  lastPong: null,
  cumulativeUsd: 0,
  lastCallTokens: null,
  streaming: false,
  fileEvents: [],
  pendingGate: null,
  autonomous: false,
  resumeSessionId: null,
};

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data as Record<string, unknown>;
      switch (msg.type) {
        case 'status':
          dispatch({ type: 'status', connected: Boolean(msg.connected) });
          break;
        case 'token':
          dispatch({ type: 'token', text: String(msg.text ?? '') });
          break;
        case 'stream_end':
          dispatch({ type: 'stream_end' });
          break;
        case 'pong':
          dispatch({ type: 'pong' });
          break;
        case 'stage':
          dispatch({
            type: 'stage',
            stage: String(msg.stage ?? 'IDLE'),
            agent: msg.agent ? String(msg.agent) : null,
          });
          break;
        case 'agent_started':
          dispatch({ type: 'agent_started', agent: String(msg.agent ?? '') });
          break;
        case 'agent_finished':
          dispatch({ type: 'agent_finished', agent: String(msg.agent ?? '') });
          break;
        case 'usage':
          dispatch({
            type: 'usage',
            cumulativeUsd: Number(msg.cumulativeUsd ?? 0),
            lastCallTokens: (msg.lastCallTokens as LastCallTokens | null) ?? null,
          });
          break;
        case 'file_change':
          dispatch({
            type: 'file_change',
            path: String(msg.path ?? ''),
            kind: String(msg.kind ?? 'modify'),
          });
          break;
        case 'approval_request':
          dispatch({
            type: 'approval_request',
            gateId: String(msg.gateId ?? ''),
            gateType: String(msg.gateType ?? ''),
            summary: String(msg.summary ?? ''),
            artifactPath: msg.artifactPath ? String(msg.artifactPath) : null,
          });
          break;
        case 'autonomous_changed':
          dispatch({ type: 'autonomous_changed', autonomous: Boolean(msg.autonomous) });
          break;
        case 'resume_offer':
          dispatch({ type: 'resume_offer', sessionId: String(msg.sessionId ?? '') });
          break;
      }
    }
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function sendPrompt() {
    const el = inputRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || !state.connected) return;
    vscode.postMessage({ type: 'prompt', text });
    el.value = '';
    dispatch({ type: 'stage', stage: 'NARRATIVE', agent: null });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  }

  const connColor = state.connected ? '#4ec9b0' : '#f48771';
  const connLabel = state.connected ? '● Connected' : '○ Disconnected';
  const isRunning = state.stage !== 'IDLE' && state.stage !== 'STOPPED' && state.stage !== 'ERROR';
  const isBlocked = state.pendingGate !== null;

  const agentLabel = state.agent ? ` › ${state.agent}` : '';

  function handleStop() {
    vscode.postMessage({ type: 'stop' });
  }

  function handleToggleAutonomous() {
    const next = !state.autonomous;
    vscode.postMessage({ type: 'mode_set', autonomous: next });
    dispatch({ type: 'autonomous_changed', autonomous: next });
  }

  function handleResume() {
    vscode.postMessage({ type: 'resume', sessionId: state.resumeSessionId ?? '' });
    dispatch({ type: 'resume_dismissed' });
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <button
          style={{
            ...styles.autonomousBtn,
            background: state.autonomous
              ? 'var(--vscode-button-background)'
              : 'var(--vscode-button-secondaryBackground, var(--vscode-button-background))',
            opacity: state.autonomous ? 1 : 0.7,
          }}
          onClick={handleToggleAutonomous}
          title={state.autonomous ? 'Autonomous mode ON — click to disable' : 'Click to enable autonomous mode'}
        >
          {state.autonomous ? '⚡ Auto' : '⚡ Manual'}
        </button>

        <span style={{ ...styles.status, color: connColor }}>{connLabel}</span>
        <span style={styles.stageBadge}>{state.stage}{agentLabel}</span>

        <button
          style={styles.globalStopBtn}
          onClick={handleStop}
          disabled={!state.connected || !isRunning}
          title="Stop all running agent work"
        >
          ◼ Stop
        </button>
      </div>

      {/* Resume banner */}
      {state.resumeSessionId !== null && (
        <ResumeBanner onResume={handleResume} onDismiss={() => dispatch({ type: 'resume_dismissed' })} />
      )}

      {state.lastPong !== null && (
        <div style={styles.pongLine}>Pong at {state.lastPong}</div>
      )}

      {/* Usage panel */}
      <UsagePanel
        cumulativeUsd={state.cumulativeUsd}
        lastCallTokens={state.lastCallTokens}
      />

      {/* Token stream */}
      <div style={styles.stream}>
        {state.tokens.length > 0
          ? state.tokens
          : state.connected
          ? isRunning
            ? 'Waiting for agent response…'
            : 'Ready. Type a prompt below.'
          : 'Not connected to server.'}
      </div>

      {/* File events */}
      {state.fileEvents.length > 0 && (
        <FileEventList events={state.fileEvents} />
      )}

      {/* Approval gate (replaces prompt input when pending) */}
      {state.pendingGate !== null ? (
        <ApprovalGate
          gate={state.pendingGate}
          onRespond={(action, feedback) => {
            vscode.postMessage({
              type: 'approval_respond',
              gateId: state.pendingGate!.gateId,
              action,
              feedback,
            });
            dispatch({ type: 'approval_cleared' });
          }}
        />
      ) : (
        <div style={styles.inputRow}>
          <textarea
            ref={inputRef}
            style={styles.input}
            placeholder="Type a prompt and press Enter…"
            rows={2}
            disabled={!state.connected || isRunning || isBlocked}
            onKeyDown={handleKeyDown}
          />
          <button
            style={styles.sendBtn}
            onClick={sendPrompt}
            disabled={!state.connected || isRunning || isBlocked}
          >
            {isRunning ? '…' : '↑'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResumeBanner component
// ---------------------------------------------------------------------------

interface ResumeBannerProps {
  onResume: () => void;
  onDismiss: () => void;
}

function ResumeBanner({ onResume, onDismiss }: ResumeBannerProps) {
  return (
    <div style={styles.resumeBanner}>
      <span style={styles.resumeText}>
        An unfinished session was found. Resume where you left off?
      </span>
      <button style={styles.resumeBtn} onClick={onResume}>
        ↺ Resume
      </button>
      <button style={styles.resumeDismissBtn} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UsagePanel component
// ---------------------------------------------------------------------------

interface UsagePanelProps {
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
}

function UsagePanel({ cumulativeUsd, lastCallTokens }: UsagePanelProps) {
  if (cumulativeUsd === 0 && lastCallTokens === null) {
    return null;
  }
  return (
    <div style={styles.usagePanel}>
      <span style={styles.usageTotal}>
        Session cost: <strong>${cumulativeUsd.toFixed(4)}</strong>
      </span>
      {lastCallTokens !== null && (
        <span style={styles.usageDetail}>
          {' '}| last call: {lastCallTokens.input}↑ {lastCallTokens.output}↓
          {lastCallTokens.cache_read > 0 && ` ${lastCallTokens.cache_read}✦cached`}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileEventList component
// ---------------------------------------------------------------------------

interface FileEventListProps {
  events: FileEventData[];
}

function FileEventList({ events }: FileEventListProps) {
  return (
    <div style={styles.fileEvents}>
      <div style={styles.fileEventsHeader}>Files written</div>
      {events.map((fe, i) => (
        <div key={i} style={styles.fileEvent}>
          <span style={styles.fileEventKind}>{fe.kind}</span>
          <span style={styles.fileEventPath}>{fe.path}</span>
          <button
            style={styles.openBtn}
            onClick={() => vscode.postMessage({ type: 'open_file', path: fe.path })}
          >
            Open
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApprovalGate component
// ---------------------------------------------------------------------------

interface ApprovalGateProps {
  gate: GateData;
  onRespond: (action: string, feedback: string) => void;
}

function ApprovalGate({ gate, onRespond }: ApprovalGateProps) {
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  function handleAgree() {
    onRespond('agree', '');
  }

  function handleFeedback() {
    const text = feedbackRef.current?.value.trim() ?? '';
    if (!text) return;
    onRespond('feedback', text);
    if (feedbackRef.current) feedbackRef.current.value = '';
  }

  function handleFeedbackKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFeedback();
    }
  }

  return (
    <div style={styles.gateCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>{gate.gateType.toUpperCase()}</span>
        <span style={styles.gateTitle}>Approval Gate</span>
      </div>
      {gate.summary && <div style={styles.gateSummary}>{gate.summary}</div>}
      {gate.artifactPath && (
        <div style={styles.gateArtifact}>
          <button
            style={styles.openBtn}
            onClick={() => vscode.postMessage({ type: 'open_file', path: gate.artifactPath! })}
          >
            Open {gate.artifactPath}
          </button>
        </div>
      )}
      <div style={styles.gateActions}>
        <div style={styles.gateTopRow}>
          <button style={styles.agreeBtn} onClick={handleAgree}>
            ✓ Agree
          </button>
          <button style={styles.stopBtn} onClick={() => onRespond('stop', '')}>
            ◼ Stop
          </button>
        </div>
        <div style={styles.feedbackRow}>
          <textarea
            ref={feedbackRef}
            style={styles.feedbackInput}
            placeholder="Feedback (Enter to send)…"
            rows={2}
            onKeyDown={handleFeedbackKey}
          />
          <button style={styles.feedbackBtn} onClick={handleFeedback}>
            ↵ Feedback
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, h.JSX.CSSProperties> = {
  root: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 'var(--vscode-editor-font-size, 13px)',
    background: 'var(--vscode-editor-background)',
    color: 'var(--vscode-editor-foreground)',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    padding: '12px',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  status: { fontWeight: 'bold', flexShrink: 0 },
  stageBadge: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '11px',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  autonomousBtn: {
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '11px',
    flexShrink: 0,
  },
  globalStopBtn: {
    background: 'transparent',
    color: 'var(--vscode-errorForeground)',
    border: '1px solid var(--vscode-errorForeground)',
    borderRadius: '2px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  resumeBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'var(--vscode-notifications-background, var(--vscode-editor-background))',
    border: '1px solid var(--vscode-focusBorder)',
    borderRadius: '4px',
    padding: '6px 10px',
    marginBottom: '6px',
    fontSize: '12px',
  },
  resumeText: { flex: 1 },
  resumeBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  resumeDismissBtn: {
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    flexShrink: 0,
  },
  pingBtn: {
    background: 'var(--vscode-button-secondaryBackground, var(--vscode-button-background))',
    color: 'var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))',
    border: 'none',
    borderRadius: '2px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '11px',
  },
  pongLine: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginBottom: '4px',
  },
  usagePanel: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '6px',
    padding: '4px 0',
    borderBottom: '1px solid var(--vscode-panel-border)',
  },
  usageTotal: { fontVariantNumeric: 'tabular-nums' },
  usageDetail: { opacity: 0.8 },
  stream: {
    flex: 1,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    borderTop: '1px solid var(--vscode-panel-border)',
    paddingTop: '8px',
    marginBottom: '8px',
    minHeight: '80px',
  },
  // File events
  fileEvents: {
    borderTop: '1px solid var(--vscode-panel-border)',
    padding: '6px 0',
    marginBottom: '8px',
  },
  fileEventsHeader: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  fileEvent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    marginBottom: '2px',
  },
  fileEventKind: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 4px',
    fontSize: '10px',
    flexShrink: 0,
  },
  fileEventPath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
  },
  openBtn: {
    background: 'transparent',
    color: 'var(--vscode-textLink-foreground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    padding: '0 4px',
    textDecoration: 'underline',
    flexShrink: 0,
  },
  // Approval gate
  gateCard: {
    border: '1px solid var(--vscode-focusBorder)',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '8px',
    background: 'var(--vscode-editor-background)',
  },
  gateHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  gateType: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 5px',
    fontSize: '10px',
    fontWeight: 'bold',
  },
  gateTitle: { fontWeight: 'bold', fontSize: '13px' },
  gateSummary: {
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '8px',
    fontStyle: 'italic',
  },
  gateArtifact: { marginBottom: '8px' },
  gateActions: { display: 'flex', flexDirection: 'column', gap: '6px' },
  gateTopRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  agreeBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 'bold',
    alignSelf: 'flex-start',
  },
  stopBtn: {
    background: 'transparent',
    color: 'var(--vscode-errorForeground)',
    border: '1px solid var(--vscode-errorForeground)',
    borderRadius: '2px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 'bold',
    alignSelf: 'flex-start',
  },
  feedbackRow: { display: 'flex', gap: '6px', alignItems: 'flex-end' },
  feedbackInput: {
    flex: 1,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    resize: 'none',
  },
  feedbackBtn: {
    background: 'var(--vscode-button-secondaryBackground, var(--vscode-button-background))',
    color: 'var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))',
    border: 'none',
    borderRadius: '2px',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '12px',
    alignSelf: 'stretch',
  },
  // Prompt input
  inputRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    resize: 'none',
  },
  sendBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '16px',
    alignSelf: 'stretch',
  },
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById('root');
if (root !== null) {
  render(<App />, root);
}
