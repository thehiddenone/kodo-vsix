/**
 * Kōdo WebView — M2 UI.
 *
 * Renders inside a VS Code WebviewPanel (Chromium context).
 * Communicates with the extension host via acquireVsCodeApi().postMessage.
 *
 * New in M2:
 *  - Prompt input bar sends prompt.submit to the server via the extension host.
 *  - UsagePanel shows cumulative USD cost and per-call token breakdown.
 *  - Streaming tokens clear between prompts.
 */

import { h, render } from 'preact';
import { useEffect, useReducer, useRef } from 'preact/hooks';

// VS Code WebView API — injected by the extension host at runtime
declare function acquireVsCodeApi(): {
  postMessage(msg: Record<string, unknown>): void;
};

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface LastCallTokens {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

interface State {
  connected: boolean;
  stage: string;
  tokens: string;
  lastPong: string | null;
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
  streaming: boolean;
}

type Action =
  | { type: 'status'; connected: boolean }
  | { type: 'token'; text: string }
  | { type: 'stream_end' }
  | { type: 'pong' }
  | { type: 'stage'; stage: string }
  | { type: 'usage'; cumulativeUsd: number; lastCallTokens: LastCallTokens | null };

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
      // Clear token buffer when a new agent run starts
      const clearTokens = action.stage !== 'IDLE' && !state.streaming;
      return {
        ...state,
        stage: action.stage,
        tokens: clearTokens ? '' : state.tokens,
      };
    }
    case 'usage':
      return {
        ...state,
        cumulativeUsd: action.cumulativeUsd,
        lastCallTokens: action.lastCallTokens,
      };
    default:
      return state;
  }
}

const initial: State = {
  connected: false,
  stage: 'IDLE',
  tokens: '',
  lastPong: null,
  cumulativeUsd: 0,
  lastCallTokens: null,
  streaming: false,
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
          dispatch({ type: 'stage', stage: String(msg.stage ?? 'IDLE') });
          break;
        case 'usage':
          dispatch({
            type: 'usage',
            cumulativeUsd: Number(msg.cumulativeUsd ?? 0),
            lastCallTokens: (msg.lastCallTokens as LastCallTokens | null) ?? null,
          });
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
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  }

  function sendPing() {
    vscode.postMessage({ type: 'ping' });
  }

  const connColor = state.connected ? '#4ec9b0' : '#f48771';
  const connLabel = state.connected ? '● Connected' : '○ Disconnected';
  const isRunning = state.stage !== 'IDLE' && state.stage !== 'STOPPED' && state.stage !== 'ERROR';

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <span style={{ ...styles.status, color: connColor }}>{connLabel}</span>
        <span style={styles.stageBadge}>{state.stage}</span>
        <button style={styles.pingBtn} onClick={sendPing} disabled={!state.connected}>
          Ping
        </button>
      </div>

      {state.lastPong !== null && (
        <div style={styles.pongLine}>Pong at {state.lastPong}</div>
      )}

      {/* Usage panel (FR-COS-01) */}
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

      {/* Prompt input */}
      <div style={styles.inputRow}>
        <textarea
          ref={inputRef}
          style={styles.input}
          placeholder="Type a prompt and press Enter…"
          rows={2}
          disabled={!state.connected || isRunning}
          onKeyDown={handleKeyDown}
        />
        <button
          style={styles.sendBtn}
          onClick={sendPrompt}
          disabled={!state.connected || isRunning}
        >
          {isRunning ? '…' : '↑'}
        </button>
      </div>
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
// Minimal inline styles
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
    gap: '12px',
    marginBottom: '6px',
  },
  status: {
    fontWeight: 'bold',
  },
  stageBadge: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '11px',
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
  usageTotal: {
    fontVariantNumeric: 'tabular-nums',
  },
  usageDetail: {
    opacity: 0.8,
  },
  stream: {
    flex: 1,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    borderTop: '1px solid var(--vscode-panel-border)',
    paddingTop: '8px',
    marginBottom: '8px',
  },
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
