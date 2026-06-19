/**
 * Kōdo WebView — M5 UI.
 *
 * New in M5:
 *  - AutonomousToggle: pinned top-left, sends mode.set to server.
 *  - Global StopButton: pinned top-right, sends stop to server at any time.
 *  - ResumeBanner: shown when server emits resume_offer at connection time.
 */

import { h, render } from 'preact';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';

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

interface QuestionChoice {
  key: string;
  label: string;
}

interface QuestionData {
  requestId: string;
  question: string;
  mode: string;
  choices: QuestionChoice[] | null;
}

/**
 * A session entry is a JSON object in the session array.
 *
 * exclude_from_context: false → rendered AND included when building LLM context.
 * exclude_from_context: true  → rendered only; excluded from LLM context.
 *
 * Transient UI state (AwaitingIndicator, live streaming text) is never stored
 * as a session entry.
 */
type SessionEntry =
  | { type: 'user_message'; content: string; exclude_from_context: false }
  | { type: 'assistant_response'; content: string; exclude_from_context: false }
  | { type: 'tool_call'; toolName: string; description: string; exclude_from_context: false }
  | { type: 'thinking_block'; content: string; exclude_from_context: true }
  | { type: 'status_response'; durationMs: number; inputTokens: number; outputTokens: number; contextTokens: number; exclude_from_context: true }
  | { type: 'post_update'; content: string; exclude_from_context: true };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  connected: boolean;
  hasWorkspace: boolean;
  stage: string;
  agent: string | null;
  /** Committed session entries. Rendered in order; exclude_from_context entries excluded from LLM context. */
  session: SessionEntry[];
  /** Live text accumulating from the current LLM streaming call. Committed to session on usage/stream_end. */
  streamingTokens: string;
  /** Live thinking text accumulating from the current LLM call. Committed as thinking_block on usage/stream_end. */
  streamingThinking: string;
  /** True while ThinkingDelta events are arriving (cleared on first token or commit). */
  thinkingActive: boolean;
  streaming: boolean;
  lastPong: string | null;
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
  fileEvents: FileEventData[];
  pendingGate: GateData | null;
  pendingQuestion: QuestionData | null;
  autonomous: boolean;
  resumeSessionId: string | null;
  /** True while waiting for the first token of an LLM call (shows AwaitingIndicator). Never stored in session. */
  awaitingLlm: boolean;
}

type Action =
  | { type: 'workspace_status'; hasWorkspace: boolean }
  | { type: 'status'; connected: boolean }
  | { type: 'llm_turn_start' }
  | { type: 'tool_call'; toolName: string; description: string }
  | { type: 'token'; text: string }
  | { type: 'thinking_token'; text: string }
  | { type: 'stream_end' }
  | { type: 'pong' }
  | { type: 'stage'; stage: string; agent: string | null }
  | { type: 'agent_started'; agent: string }
  | { type: 'agent_finished'; agent: string }
  | { type: 'prompt_sent'; text: string }
  | { type: 'restore_prompt'; text: string }
  | { type: 'usage'; cumulativeUsd: number; lastCallTokens: LastCallTokens | null; durationSeconds: number }
  | { type: 'file_change'; path: string; kind: string }
  | { type: 'approval_request'; gateId: string; gateType: string; summary: string; artifactPath: string | null }
  | { type: 'approval_cleared' }
  | { type: 'question_request'; requestId: string; question: string; mode: string; choices: QuestionChoice[] | null }
  | { type: 'question_cleared' }
  | { type: 'autonomous_changed'; autonomous: boolean }
  | { type: 'resume_offer'; sessionId: string }
  | { type: 'resume_dismissed' }
  | { type: 'post_update'; message: string }
  | { type: 'session_history'; entries: Record<string, unknown>[] };

function commitStreaming(state: State): SessionEntry[] {
  let session = state.session;
  if (state.streamingThinking) {
    session = [...session, { type: 'thinking_block', content: state.streamingThinking, exclude_from_context: true }];
  }
  if (state.streamingTokens) {
    session = [...session, { type: 'assistant_response', content: state.streamingTokens, exclude_from_context: false }];
  }
  return session;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'workspace_status':
      return { ...state, hasWorkspace: action.hasWorkspace };
    case 'status':
      return { ...state, connected: action.connected };
    case 'llm_turn_start':
      return { ...state, awaitingLlm: true };
    case 'tool_call':
      return {
        ...state,
        session: [...state.session, { type: 'tool_call', toolName: action.toolName, description: action.description, exclude_from_context: false }],
      };
    case 'thinking_token':
      return { ...state, streamingThinking: state.streamingThinking + action.text, thinkingActive: true, awaitingLlm: false };
    case 'token':
      return { ...state, streamingTokens: state.streamingTokens + action.text, streaming: true, thinkingActive: false, awaitingLlm: false };
    case 'stream_end':
      return {
        ...state,
        session: commitStreaming(state),
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        streaming: false,
      };
    case 'pong':
      return { ...state, lastPong: new Date().toLocaleTimeString() };
    case 'stage': {
      const clearStreaming = action.stage !== 'IDLE' && !state.streaming;
      return {
        ...state,
        stage: action.stage,
        agent: action.agent,
        streamingTokens: clearStreaming ? '' : state.streamingTokens,
      };
    }
    case 'prompt_sent':
      return {
        ...state,
        session: [...state.session, { type: 'user_message', content: action.text, exclude_from_context: false }],
        streamingTokens: '',
        streaming: false,
        awaitingLlm: false,
      };
    case 'restore_prompt':
      if (state.session.length > 0) return state;
      return {
        ...state,
        session: [{ type: 'user_message', content: action.text, exclude_from_context: false }],
      };
    case 'agent_started':
      return { ...state, agent: action.agent };
    case 'agent_finished':
      return { ...state, agent: null };
    case 'usage': {
      const t = action.lastCallTokens;
      if (t === null) {
        return { ...state, cumulativeUsd: action.cumulativeUsd, lastCallTokens: null };
      }
      const baseSession = commitStreaming(state);
      const statusEntry: SessionEntry = {
        type: 'status_response',
        durationMs: action.durationSeconds * 1000,
        inputTokens: t?.input ?? 0,
        outputTokens: t?.output ?? 0,
        contextTokens: (t?.input ?? 0) + (t?.cache_read ?? 0) + (t?.cache_write ?? 0),
        exclude_from_context: true,
      };
      return {
        ...state,
        cumulativeUsd: action.cumulativeUsd,
        lastCallTokens: action.lastCallTokens,
        awaitingLlm: false,
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        streaming: false,
        session: [...baseSession, statusEntry],
      };
    }
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
    case 'question_request':
      return {
        ...state,
        pendingQuestion: {
          requestId: action.requestId,
          question: action.question,
          mode: action.mode,
          choices: action.choices,
        },
        streaming: false,
      };
    case 'question_cleared':
      return { ...state, pendingQuestion: null };
    case 'autonomous_changed':
      return { ...state, autonomous: action.autonomous };
    case 'resume_offer':
      return { ...state, resumeSessionId: action.sessionId };
    case 'resume_dismissed':
      return { ...state, resumeSessionId: null };
    case 'post_update':
      return {
        ...state,
        session: [...state.session, { type: 'post_update', content: action.message, exclude_from_context: true }],
      };
    case 'session_history': {
      if (state.session.length > 0) return state;
      const entries: SessionEntry[] = [];
      for (const e of action.entries) {
        const type = String(e.type ?? '');
        if (type === 'user_message' || type === 'assistant_response') {
          entries.push({ type, content: String(e.content ?? ''), exclude_from_context: false });
        } else if (type === 'tool_call') {
          entries.push({
            type: 'tool_call',
            toolName: String(e.toolName ?? ''),
            description: String(e.description ?? ''),
            exclude_from_context: false,
          });
        }
      }
      return { ...state, session: entries };
    }
    default:
      return state;
  }
}

const initial: State = {
  connected: false,
  hasWorkspace: false,
  stage: 'IDLE',
  agent: null,
  session: [],
  streamingTokens: '',
  streamingThinking: '',
  thinkingActive: false,
  streaming: false,
  lastPong: null,
  cumulativeUsd: 0,
  lastCallTokens: null,
  fileEvents: [],
  pendingGate: null,
  pendingQuestion: null,
  autonomous: false,
  resumeSessionId: null,
  awaitingLlm: false,
};

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the session feed to the bottom whenever a new entry is
  // appended (e.g. the user's just-sent message) so it stays visible.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.session.length]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data as Record<string, unknown>;
      switch (msg.type) {
        case 'workspace_status':
          dispatch({ type: 'workspace_status', hasWorkspace: Boolean(msg.hasWorkspace) });
          break;
        case 'status':
          dispatch({ type: 'status', connected: Boolean(msg.connected) });
          break;
        case 'token':
          dispatch({ type: 'token', text: String(msg.text ?? '') });
          break;
        case 'thinking_token':
          dispatch({ type: 'thinking_token', text: String(msg.text ?? '') });
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
        case 'llm_turn_start':
          dispatch({ type: 'llm_turn_start' });
          break;
        case 'session_history':
          dispatch({ type: 'session_history', entries: (msg.entries as Record<string, unknown>[]) ?? [] });
          break;
        case 'tool_call':
          dispatch({ type: 'tool_call', toolName: String(msg.toolName ?? ''), description: String(msg.description ?? '') });
          break;
        case 'usage':
          dispatch({
            type: 'usage',
            cumulativeUsd: Number(msg.cumulativeUsd ?? 0),
            lastCallTokens: (msg.lastCallTokens as LastCallTokens | null) ?? null,
            durationSeconds: Number(msg.durationSeconds ?? 0),
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
        case 'question_request': {
          const rawChoices = msg.choices;
          const choices: QuestionChoice[] | null = Array.isArray(rawChoices)
            ? rawChoices.map((c) => ({
                key: String((c as Record<string, unknown>).key ?? ''),
                label: String((c as Record<string, unknown>).label ?? ''),
              }))
            : null;
          dispatch({
            type: 'question_request',
            requestId: String(msg.requestId ?? ''),
            question: String(msg.question ?? ''),
            mode: String(msg.mode ?? 'free_text'),
            choices,
          });
          break;
        }
        case 'autonomous_changed':
          dispatch({ type: 'autonomous_changed', autonomous: Boolean(msg.autonomous) });
          break;
        case 'post_update':
          dispatch({ type: 'post_update', message: String(msg.message ?? '') });
          break;
        case 'resume_offer':
          dispatch({ type: 'resume_offer', sessionId: String(msg.sessionId ?? '') });
          break;
        case 'restore_prompt':
          dispatch({ type: 'restore_prompt', text: String(msg.text ?? '') });
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
    el.style.height = '';
    dispatch({ type: 'prompt_sent', text });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  }

  if (!state.hasWorkspace) {
    return (
      <div style={styles.root}>
        <div style={styles.inactiveMsg}>Open a workspace to use Kōdo.</div>
      </div>
    );
  }

  const isRunning = state.stage !== 'IDLE' && state.stage !== 'STOPPED' && state.stage !== 'ERROR';
  const isBlocked = state.pendingGate !== null || state.pendingQuestion !== null;

  function handleStop() {
    vscode.postMessage({ type: 'stop' });
  }

  function handleInput(e: Event) {
    const el = e.currentTarget as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleResume() {
    vscode.postMessage({ type: 'resume', sessionId: state.resumeSessionId ?? '' });
    dispatch({ type: 'resume_dismissed' });
  }

  const isEmpty = state.session.length === 0 && !state.streamingTokens && !state.streamingThinking && !state.awaitingLlm;

  return (
    <div style={styles.root}>
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

      {/* Session feed */}
      <div ref={streamRef} style={styles.stream}>
        {state.session.map((entry, i) => (
          <SessionEntryView key={i} entry={entry} />
        ))}
        {state.streamingThinking && (
          <ThinkingBlock content={state.streamingThinking} isActive={state.thinkingActive} />
        )}
        {state.streamingTokens && (
          <div style={styles.agentTokens}>{state.streamingTokens}</div>
        )}
        {state.awaitingLlm && <AwaitingIndicator />}
        {isEmpty && (
          state.connected ? 'Ready. Type a prompt below.' : 'Not connected to server.'
        )}
      </div>

      {/* File events */}
      {state.fileEvents.length > 0 && (
        <FileEventList events={state.fileEvents} />
      )}

      {/* Approval gate / question prompt (replaces prompt input when pending) */}
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
      ) : state.pendingQuestion !== null ? (
        <QuestionGate
          question={state.pendingQuestion}
          onRespond={(answerText, choiceKey) => {
            vscode.postMessage({
              type: 'question_respond',
              requestId: state.pendingQuestion!.requestId,
              mode: state.pendingQuestion!.mode,
              answerText,
              choiceKey,
            });
            dispatch({ type: 'question_cleared' });
          }}
        />
      ) : (
        <div style={styles.inputArea}>
          <textarea
            ref={inputRef}
            style={styles.input}
            placeholder="Type a prompt and press Enter…"
            disabled={!state.connected || isRunning || isBlocked}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
          />
          <div style={styles.inputFooter}>
            <div style={{ flex: 1 }} />
            <div style={styles.footerButtons}>
              <button
                style={styles.sendBtn}
                onClick={sendPrompt}
                disabled={!state.connected || isRunning || isBlocked}
                title="Send prompt (Enter)"
              >
                {isRunning ? '…' : '↑'}
              </button>
              <button
                style={styles.attachBtn}
                title="Attach files (coming soon)"
              >
                +
              </button>
              <button
                style={styles.globalStopBtn}
                onClick={handleStop}
                disabled={!state.connected || !isRunning}
                title="Stop all running agent work"
              >
                {'🛑'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BouncingDots / AwaitingIndicator components
// ---------------------------------------------------------------------------

function BouncingDots() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % 22), 150);
    return () => clearInterval(id);
  }, []);
  const dots = step <= 11 ? step + 1 : 23 - step;
  return <span>{'.'.repeat(dots)}</span>;
}

function AwaitingIndicator() {
  return (
    <div style={styles.awaitingLine}>
      {'Awaiting response '}<BouncingDots />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThinkingBlock component
// ---------------------------------------------------------------------------

interface ThinkingBlockProps {
  content: string;
  isActive: boolean;
}

function ThinkingBlock({ content, isActive }: ThinkingBlockProps) {
  return (
    <details style={styles.thinkingBlock}>
      <summary style={styles.thinkingSummary}>
        {isActive ? <span>{'Thinking '}<BouncingDots /></span> : 'Thinking'}
      </summary>
      <div style={styles.thinkingContent}>{content}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// SessionEntryView component
// ---------------------------------------------------------------------------

interface SessionEntryViewProps {
  entry: SessionEntry;
}

function SessionEntryView({ entry }: SessionEntryViewProps) {
  switch (entry.type) {
    case 'user_message':
      return <div style={styles.userPrompt}>{entry.content}</div>;
    case 'assistant_response':
      return <div style={styles.agentTokens}>{entry.content}</div>;
    case 'status_response': {
      const mins = Math.floor(entry.durationMs / 60000);
      const secs = Math.round((entry.durationMs % 60000) / 1000);
      const timeStr = mins > 0 ? `${mins} min ${secs} seconds` : `${secs} seconds`;
      return (
        <div style={styles.statusResponse}>
          {'Kodo responded in '}
          {timeStr}
          {`, ${entry.inputTokens} tokens sent, ${entry.outputTokens} tokens received, context window size ${entry.contextTokens}.`}
        </div>
      );
    }
    case 'thinking_block':
      return <ThinkingBlock content={entry.content} isActive={false} />;
    case 'tool_call':
      return (
        <div style={styles.toolCall}>
          <span style={styles.toolCallName}>{entry.toolName}</span>
          {entry.description && (
            <span style={styles.toolCallDesc}>{' — '}{entry.description}</span>
          )}
        </div>
      );
    case 'post_update':
      return <div style={styles.postUpdate}>{entry.content}</div>;
  }
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
// QuestionGate component
// ---------------------------------------------------------------------------

interface QuestionGateProps {
  question: QuestionData;
  onRespond: (answerText: string, choiceKey: string) => void;
}

function QuestionGate({ question, onRespond }: QuestionGateProps) {
  const answerRef = useRef<HTMLTextAreaElement>(null);

  function handleAnswer() {
    const text = answerRef.current?.value.trim() ?? '';
    if (!text) return;
    onRespond(text, '');
    if (answerRef.current) answerRef.current.value = '';
  }

  function handleAnswerKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAnswer();
    }
  }

  return (
    <div style={styles.gateCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>QUESTION</span>
      </div>
      {question.question && <div style={styles.gateSummary}>{question.question}</div>}
      {question.mode === 'choice' && question.choices ? (
        <div style={styles.gateTopRow}>
          {question.choices.map((c) => (
            <button key={c.key} style={styles.agreeBtn} onClick={() => onRespond('', c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <div style={styles.feedbackRow}>
          <textarea
            ref={answerRef}
            style={styles.feedbackInput}
            placeholder="Your answer (Enter to send)…"
            rows={2}
            onKeyDown={handleAnswerKey}
          />
          <button style={styles.feedbackBtn} onClick={handleAnswer}>
            ↵ Send
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
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
  inactiveMsg: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--vscode-descriptionForeground)',
    textAlign: 'center' as const,
    padding: '24px',
  },
  attachBtn: {
    background: '#c8a400',
    color: '#000000',
    border: 'none',
    borderRadius: '2px',
    width: '40px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  globalStopBtn: {
    background: 'transparent',
    color: 'var(--vscode-errorForeground)',
    border: '1px solid var(--vscode-errorForeground)',
    borderRadius: '2px',
    width: '40px',
    cursor: 'pointer',
    fontSize: '16px',
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
  userPrompt: {
    background: 'var(--vscode-input-background)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '4px',
    padding: '6px 10px',
    marginBottom: '10px',
    color: 'var(--vscode-input-foreground)',
    fontSize: '13px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  agentTokens: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  awaitingLine: {
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'italic',
    fontSize: '12px',
    marginTop: '6px',
    marginBottom: '4px',
    letterSpacing: '0.02em',
  },
  statusResponse: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginTop: '4px',
    marginBottom: '2px',
    fontStyle: 'italic',
  },
  thinkingBlock: {
    marginTop: '6px',
    marginBottom: '4px',
    fontSize: '12px',
  },
  thinkingSummary: {
    cursor: 'pointer',
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'italic',
    userSelect: 'none' as const,
    listStyle: 'none',
  },
  thinkingContent: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: '4px 0 4px 12px',
    borderLeft: '2px solid var(--vscode-panel-border)',
    marginTop: '4px',
  },
  toolCall: {
    fontSize: '12px',
    marginTop: '4px',
    marginBottom: '2px',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    alignItems: 'baseline',
  },
  toolCallName: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 5px',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  toolCallDesc: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
  },
  postUpdate: {
    background: 'var(--vscode-editorWidget-background, var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.12)))',
    borderRadius: '6px',
    padding: '6px 10px',
    marginTop: '6px',
    marginBottom: '4px',
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'italic',
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
  inputArea: {
    display: 'flex',
    flexDirection: 'column',
  },
  input: {
    width: '100%',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    resize: 'none',
    minHeight: '80px',
    maxHeight: '180px',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  inputFooter: {
    display: 'flex',
    alignItems: 'center',
    height: '50px',
    paddingTop: '6px',
  },
  footerButtons: {
    display: 'flex',
    gap: '10px',
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  sendBtn: {
    background: '#2ea043',
    color: '#ffffff',
    border: 'none',
    borderRadius: '2px',
    width: '40px',
    cursor: 'pointer',
    fontSize: '16px',
  },
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById('root');
if (root !== null) {
  render(<App />, root);
}
