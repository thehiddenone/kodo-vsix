/**
 * Kōdo WebView — M1 demo UI.
 *
 * Renders inside a VS Code WebviewPanel (Chromium context).
 * Communicates with the extension host via acquireVsCodeApi().postMessage.
 */

import { h, render } from 'preact';
import { useEffect, useReducer } from 'preact/hooks';

// VS Code WebView API — injected by the extension host at runtime
declare function acquireVsCodeApi(): {
  postMessage(msg: Record<string, unknown>): void;
};

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  connected: boolean;
  stage: string;
  tokens: string;
  lastPong: string | null;
}

type Action =
  | { type: 'status'; connected: boolean }
  | { type: 'token'; text: string }
  | { type: 'pong' }
  | { type: 'stage'; stage: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'status':
      return { ...state, connected: action.connected };
    case 'token':
      return { ...state, tokens: state.tokens + action.text };
    case 'pong':
      return { ...state, lastPong: new Date().toLocaleTimeString() };
    case 'stage':
      return { ...state, stage: action.stage };
    default:
      return state;
  }
}

const initial: State = {
  connected: false,
  stage: 'IDLE',
  tokens: '',
  lastPong: null,
};

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  const [state, dispatch] = useReducer(reducer, initial);

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
        case 'pong':
          dispatch({ type: 'pong' });
          break;
        case 'stage':
          dispatch({ type: 'stage', stage: String(msg.stage ?? 'IDLE') });
          break;
      }
    }
    window.addEventListener('message', onMessage);
    // Tell the extension host the listener is live; it replies with the
    // cached connection state so a reopened panel shows live status.
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function sendPing() {
    vscode.postMessage({ type: 'ping' });
  }

  const connColor = state.connected ? '#4ec9b0' : '#f48771';
  const connLabel = state.connected ? '● Connected' : '○ Disconnected';

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={{ ...styles.status, color: connColor }}>{connLabel}</span>
        <span style={styles.stage}>{state.stage}</span>
        <button style={styles.pingBtn} onClick={sendPing} disabled={!state.connected}>
          Ping
        </button>
      </div>

      {state.lastPong !== null && (
        <div style={styles.pongLine}>Pong received at {state.lastPong}</div>
      )}

      <div style={styles.stream}>
        {state.tokens.length > 0
          ? state.tokens
          : state.connected
          ? 'Waiting for stream…'
          : 'Not connected to server.'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal inline styles (no external CSS required)
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
    marginBottom: '8px',
  },
  status: {
    fontWeight: 'bold',
  },
  stage: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '11px',
  },
  pingBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 'inherit',
  },
  pongLine: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginBottom: '8px',
  },
  stream: {
    flex: 1,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    borderTop: '1px solid var(--vscode-panel-border)',
    paddingTop: '8px',
  },
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById('root');
if (root !== null) {
  render(<App />, root);
}
