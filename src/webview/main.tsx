/**
 * Kōdo WebView — M5 UI.
 *
 * New in M5:
 *  - AutonomousToggle: pinned top-left, sends mode.set to server.
 *  - Global StopButton: pinned top-right, sends stop to server at any time.
 *  - ResumeBanner: shown when server emits resume_offer at connection time.
 */

import { h, render } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';

declare function acquireVsCodeApi(): {
  postMessage(msg: Record<string, unknown>): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** Edit Control posture the Edit toggle cycles through. `smart` is the default. */
type EditControl = 'review_all' | 'allow_all' | 'smart';
/** Command Control posture the Command toggle cycles through. `smart` is the default. */
type CommandControl = 'defensive' | 'permissive' | 'smart';

/** Coerce an untyped wire value into a valid {@link EditControl} (default smart). */
function coerceEditControl(value: unknown): EditControl {
  return value === 'review_all' || value === 'allow_all' ? value : 'smart';
}

/** Coerce an untyped wire value into a valid {@link CommandControl} (default smart). */
function coerceCommandControl(value: unknown): CommandControl {
  return value === 'defensive' || value === 'permissive' ? value : 'smart';
}

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
 * This array is display-only — the WebView never assembles LLM context itself,
 * the server's session.jsonl is the source of truth there — so the flag is an
 * architectural annotation, not a literal mechanism. `thinking_block` is
 * marked `true` on that basis even though the server now persists and
 * replays thinking as real LLM context (see kodo/doc/SESSIONS.md).
 *
 * Transient UI state (AwaitingIndicator, live streaming text) is never stored
 * as a session entry.
 */
/**
 * One customer-visible parameter row in a tool call's detail box. Projected by
 * the server from the tool's input/output via its visibility maps: `always`
 * rows are shown in full, `visible` rows are cropped client-side.
 */
interface ToolCallDetailRow {
  name: string;
  value: string;
  source: 'input' | 'output';
  visibility: 'always' | 'visible';
}

/** A before/after file pair backing a tool call's "view diff" link. */
interface DiffLinkData {
  label: string;
  prevPath: string;
  newPath: string;
}

type SessionEntry =
  | { type: 'user_message'; content: string; attachments: AttachedFileRef[]; exclude_from_context: false }
  | { type: 'assistant_response'; content: string; exclude_from_context: false }
  | {
      type: 'tool_call';
      toolName: string;
      description: string;
      /** Correlates the post-dispatch detail event back to this entry. */
      toolCallId: string;
      /** Customer-visible input/output rows (empty until the detail arrives). */
      rows: ToolCallDetailRow[];
      /** Absolute path to the persisted Markdown doc, or null if not yet known. */
      detailFile: string | null;
      /** False when the engine had to repair the tool's output (null until known). */
      schemaCompliance: boolean | null;
      /** Whether the call succeeded: true ✓ / false ✗ / null = still running (no badge). */
      success: boolean | null;
      /** run_command's mandatory timeout (seconds); null for other tools / history. */
      timeoutSeconds: number | null;
      /** Client clock (ms) when this call started; drives the progress bar. null for history. */
      startedAt: number | null;
      /** Before/after file pair for this call (e.g. edit_file), or null if none was captured. */
      diff: DiffLinkData | null;
      /** How long the model spent streaming this call's arguments (ms), shown as
       *  "Generated content for <tool> in Xs, …". null when unknown (history / no toolgen). */
      toolgenDurationMs: number | null;
      /** How many characters the model streamed for this call's arguments. null when unknown. */
      toolgenChars: number | null;
      exclude_from_context: false;
    }
  | { type: 'thinking_block'; content: string; durationMs: number | null; exclude_from_context: true }
  | { type: 'status_response'; durationMs: number; inputTokens: number; outputTokens: number; contextTokens: number; exclude_from_context: true }
  | { type: 'post_update'; content: string; exclude_from_context: true }
  // Sub-agent takeover dividers. 'start' marks a sub-agent taking over from the
  // main agent; 'end' marks the main agent resuming. Display-only.
  | { type: 'subsession_divider'; phase: 'start' | 'end'; displayName: string; parentDisplayName: string; exclude_from_context: true }
  // The structured task brief the engine handed a sub-agent on spawn. Rendered as
  // a distinct card (NOT the user's prompt bubble) even though it rides a user turn.
  | { type: 'subagent_task'; content: string; exclude_from_context: true }
  // Context-compaction divider: marks where the prior conversation was summarised
  // and the live LLM context reset. Everything above stays visible as history.
  | { type: 'compaction_divider'; summaryExcerpt: string; summary: string; tokensBefore: number; tokensAfter: number; exclude_from_context: true };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  connected: boolean;
  hasWorkspace: boolean;
  /** Human-readable session name shown in the header; empty until named. */
  sessionName: string;
  /** Locked current project name (Guided), or empty when none is bound. */
  currentProject: string;
  /** True while the silent session-titler call is running (shows a naming indicator). */
  namingSession: boolean;
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
  /** Client clock (ms) when the current thinking block began; drives its elapsed timer. Reset when committed. */
  thinkingStartedAt: number | null;
  streaming: boolean;
  lastPong: string | null;
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
  fileEvents: FileEventData[];
  pendingGate: GateData | null;
  pendingQuestion: QuestionData | null;
  // The two *frozen* toggles are pairs: the user-facing *selected* value (flips
  // the instant the user clicks) and the per-turn frozen *effective* value the
  // server reports. While a turn runs and the two differ, the toggle is "queued
  // for the next prompt"; otherwise it is "in effect".
  autonomous: boolean;
  effectiveAutonomous: boolean;
  /** Per-session workflow mode; toggled in this tab's header. */
  workflowMode: 'guided' | 'problem_solving';
  effectiveWorkflowMode: 'guided' | 'problem_solving';
  // Edit/Command Control are never frozen. The host owns them and sends the
  // *shown* value (forced to Allow All / Permissive while Autonomous is in
  // effect) plus `editCommandLocked`, which disables both toggles in the UI.
  editControl: EditControl;
  commandControl: CommandControl;
  editCommandLocked: boolean;
  /** True while a turn is in progress (server phase "running"); gates the frozen toggles' "queued" status. */
  running: boolean;
  resumeSessionId: string | null;
  /** True while waiting for the first token of an LLM call (shows AwaitingIndicator). Never stored in session. */
  awaitingLlm: boolean;
  /** Gateway queue/throttle wait state, or null when not waiting. Transient. */
  llmWaiting: { reason: string; retryIn: number | null } | null;
  /** Live tool-call argument text accumulating from the current call. Transient. */
  streamingToolgen: string;
  /** True while ToolCallArgDelta fragments are arriving (shows ToolgenBlock). */
  toolgenActive: boolean;
  /** Name of the tool whose arguments are currently streaming. */
  toolgenToolName: string;
  /** Client clock (ms) when tool-arg streaming began; drives the elapsed timer. */
  toolgenStartedAt: number | null;
  /**
   * Files staged to be injected ahead of the next prompt. Display metadata only
   * — the file content lives in the extension host (it reads + validates the
   * files and prepends them to prompt.submit). Capacity is capped at 9.
   */
  attachedFiles: AttachedFile[];
  /** Live context-window gauge shown in the header, or null until first reported. */
  contextStats: ContextStats | null;
  /** True while the engine is running the compactor (shows a "Compacting…" banner). */
  compacting: boolean;
}

/** Header context-window gauge: current/limit tokens, percent, and whether a manual compaction is allowed right now. */
interface ContextStats {
  currentTokens: number;
  limitTokens: number;
  percent: number;
  canCompact: boolean;
}

/** One staged attachment chip (id assigned by the host on validation). */
interface AttachedFile {
  id: string;
  name: string;
  /** Absolute path on disk; preserved so the sent chip can re-open the file. */
  path: string;
}

/**
 * A file attachment baked into a sent user message. Unlike a staged
 * {@link AttachedFile} it has no id (it can no longer be removed) but keeps the
 * path so its chip stays clickable (opens the file in VS Code).
 */
interface AttachedFileRef {
  name: string;
  path: string;
}

type Action =
  | { type: 'workspace_status'; hasWorkspace: boolean }
  | { type: 'status'; connected: boolean }
  | { type: 'llm_turn_start' }
  | { type: 'llm_waiting'; waiting: boolean; reason: string; retryIn: number | null }
  | { type: 'tool_call'; toolName: string; description: string; toolCallId: string; timeoutSeconds: number | null }
  | { type: 'tool_call_detail'; toolCallId: string; rows: ToolCallDetailRow[]; detailFile: string | null; schemaCompliance: boolean | null; success: boolean | null; diff: DiffLinkData | null }
  | { type: 'token'; text: string }
  | { type: 'thinking_token'; text: string }
  | { type: 'toolgen_token'; toolName: string; text: string }
  | { type: 'stream_end' }
  | { type: 'pong' }
  | { type: 'stage'; stage: string; agent: string | null }
  | { type: 'agent_started'; agent: string }
  | { type: 'agent_finished'; agent: string }
  | { type: 'subsession_started'; displayName: string; task: string }
  | { type: 'subsession_ended'; displayName: string; parentDisplayName: string }
  | { type: 'prompt_sent'; text: string }
  | { type: 'restore_prompt'; text: string }
  | { type: 'usage'; cumulativeUsd: number; lastCallTokens: LastCallTokens | null; durationSeconds: number }
  | { type: 'file_change'; path: string; kind: string }
  | { type: 'approval_request'; gateId: string; gateType: string; summary: string; artifactPath: string | null }
  | { type: 'approval_cleared' }
  | { type: 'question_request'; requestId: string; question: string; mode: string; choices: QuestionChoice[] | null }
  | { type: 'question_cleared' }
  | {
      type: 'mode_state';
      autonomous: boolean;
      effectiveAutonomous: boolean;
      workflowMode: 'guided' | 'problem_solving';
      effectiveWorkflowMode: 'guided' | 'problem_solving';
      editControl: EditControl;
      commandControl: CommandControl;
      editCommandLocked: boolean;
      running: boolean;
    }
  | { type: 'resume_offer'; sessionId: string }
  | { type: 'resume_dismissed' }
  | { type: 'post_update'; message: string }
  | { type: 'session_name'; name: string }
  | { type: 'current_project'; name: string }
  | { type: 'session_naming'; active: boolean }
  | { type: 'session_cleared' }
  | { type: 'attachment_added'; id: string; name: string; path: string }
  | { type: 'attachment_removed'; id: string }
  | { type: 'attachments_cleared' }
  | { type: 'sent_attachments'; attachments: AttachedFileRef[] }
  | { type: 'context_stats'; currentTokens: number; limitTokens: number; percent: number; canCompact: boolean }
  | { type: 'context_compacting'; active: boolean }
  | { type: 'context_compacted'; summaryExcerpt: string; summary: string; tokensBefore: number; tokensAfter: number }
  | { type: 'session_history'; entries: Record<string, unknown>[] };

function commitStreaming(state: State): SessionEntry[] {
  let session = state.session;
  if (state.streamingThinking) {
    const durationMs = state.thinkingStartedAt !== null ? Date.now() - state.thinkingStartedAt : null;
    session = [...session, { type: 'thinking_block', content: state.streamingThinking, durationMs, exclude_from_context: true }];
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
    case 'session_name':
      return { ...state, sessionName: action.name, namingSession: false };
    case 'current_project':
      return { ...state, currentProject: action.name };
    case 'session_naming':
      return { ...state, namingSession: action.active };
    case 'session_cleared':
      // Wipe the visible feed + all transient streaming state (the session is
      // being deleted). Connection/mode/header fields are left as-is.
      return {
        ...state,
        session: [],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        awaitingLlm: false,
        llmWaiting: null,
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
        fileEvents: [],
        pendingGate: null,
        pendingQuestion: null,
        namingSession: false,
        attachedFiles: [],
      };
    case 'attachment_added':
      // Host validated the file and assigned it an id; show its chip.
      if (state.attachedFiles.some((f) => f.id === action.id)) return state;
      return { ...state, attachedFiles: [...state.attachedFiles, { id: action.id, name: action.name, path: action.path }] };
    case 'attachment_removed':
      return { ...state, attachedFiles: state.attachedFiles.filter((f) => f.id !== action.id) };
    case 'attachments_cleared':
      // Host consumed the staged files (injected them into the submitted prompt).
      return { ...state, attachedFiles: [] };
    case 'sent_attachments': {
      // The server stored the just-sent prompt's attachments and copied them
      // into the session. Retarget the most recent user_message's chips to the
      // durable stored copies (and reflect any the server dropped). Walk from
      // the end so the freshest bubble — the one we optimistically rendered on
      // prompt_sent — is the one updated.
      const idx = [...state.session].reverse().findIndex((e) => e.type === 'user_message');
      if (idx === -1) return state;
      const at = state.session.length - 1 - idx;
      const target = state.session[at];
      if (target.type !== 'user_message') return state;
      const session = [...state.session];
      session[at] = { ...target, attachments: action.attachments };
      return { ...state, session };
    }
    case 'llm_turn_start':
      // A new turn begins; clear any leftover toolgen indicator (e.g. from a
      // cancelled prior turn that never produced a tool_call entry).
      return { ...state, llmWaiting: null, awaitingLlm: true, thinkingStartedAt: null, streamingToolgen: '', toolgenActive: false, toolgenToolName: '', toolgenStartedAt: null };
    case 'llm_waiting':
      return {
        ...state,
        llmWaiting: action.waiting ? { reason: action.reason, retryIn: action.retryIn } : null,
      };
    case 'tool_call': {
      // The tool call is now fully assembled, so any in-progress "Generating…"
      // indicator is done: bake its elapsed time into the entry as
      // "Generated <tool> in Xm Ys" and clear the transient streaming state.
      const toolgenDurationMs =
        state.toolgenActive && state.toolgenStartedAt !== null ? Date.now() - state.toolgenStartedAt : null;
      const toolgenChars = state.toolgenActive ? state.streamingToolgen.length : null;
      return {
        ...state,
        session: [...state.session, { type: 'tool_call', toolName: action.toolName, description: action.description, toolCallId: action.toolCallId, rows: [], detailFile: null, schemaCompliance: null, success: null, timeoutSeconds: action.timeoutSeconds, startedAt: Date.now(), diff: null, toolgenDurationMs, toolgenChars, exclude_from_context: false }],
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
      };
    }
    case 'tool_call_detail': {
      // Attach the detail to the matching tool_call entry (most recent match).
      let patched = false;
      const session = [...state.session];
      for (let i = session.length - 1; i >= 0; i--) {
        const e = session[i];
        if (e.type === 'tool_call' && e.toolCallId === action.toolCallId) {
          session[i] = { ...e, rows: action.rows, detailFile: action.detailFile, schemaCompliance: action.schemaCompliance, success: action.success, diff: action.diff };
          patched = true;
          break;
        }
      }
      return patched ? { ...state, session } : state;
    }
    case 'thinking_token':
      return { ...state, streamingThinking: state.streamingThinking + action.text, thinkingActive: true, thinkingStartedAt: state.thinkingStartedAt ?? Date.now(), awaitingLlm: false };
    case 'token':
      return { ...state, streamingTokens: state.streamingTokens + action.text, streaming: true, thinkingActive: false, awaitingLlm: false, llmWaiting: null };
    case 'toolgen_token': {
      // On the first fragment, commit the visible thinking/text streamed so far
      // (the sentence is complete) so the "Generating…" block sits below it.
      const starting = !state.toolgenActive;
      const session = starting ? commitStreaming(state) : state.session;
      return {
        ...state,
        session,
        streamingTokens: starting ? '' : state.streamingTokens,
        streamingThinking: starting ? '' : state.streamingThinking,
        thinkingActive: false,
        thinkingStartedAt: starting ? null : state.thinkingStartedAt,
        awaitingLlm: false,
        streaming: false,
        toolgenActive: true,
        toolgenToolName: action.toolName || state.toolgenToolName,
        toolgenStartedAt: state.toolgenStartedAt ?? Date.now(),
        streamingToolgen: state.streamingToolgen + action.text,
      };
    }
    case 'stream_end':
      return {
        ...state,
        session: commitStreaming(state),
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        llmWaiting: null,
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
      // Bake the staged attachments into this user message so the fact that
      // files rode along is preserved in the feed, then clear the staging area.
      return {
        ...state,
        session: [...state.session, { type: 'user_message', content: action.text, attachments: state.attachedFiles.map((f) => ({ name: f.name, path: f.path })), exclude_from_context: false }],
        attachedFiles: [],
        streamingTokens: '',
        streaming: false,
        awaitingLlm: false,
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
      };
    case 'restore_prompt':
      if (state.session.length > 0) return state;
      return {
        ...state,
        session: [{ type: 'user_message', content: action.text, attachments: [], exclude_from_context: false }],
      };
    case 'agent_started':
      return { ...state, agent: action.agent };
    case 'agent_finished':
      return { ...state, agent: null };
    case 'subsession_started': {
      // A sub-agent takes over: commit any in-flight main streaming first, then
      // drop a "took over from" divider into the feed, followed by the structured
      // task brief the sub-agent was handed (a distinct card, not a user bubble).
      const baseSession = commitStreaming(state);
      const startEntries: SessionEntry[] = [
        { type: 'subsession_divider', phase: 'start', displayName: action.displayName, parentDisplayName: '', exclude_from_context: true },
      ];
      if (action.task) {
        startEntries.push({ type: 'subagent_task', content: action.task, exclude_from_context: true });
      }
      return {
        ...state,
        session: [...baseSession, ...startEntries],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
      };
    }
    case 'subsession_ended': {
      const baseSession = commitStreaming(state);
      return {
        ...state,
        session: [
          ...baseSession,
          { type: 'subsession_divider', phase: 'end', displayName: action.displayName, parentDisplayName: action.parentDisplayName, exclude_from_context: true },
        ],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
      };
    }
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
        thinkingStartedAt: null,
        streaming: false,
        session: [...baseSession, statusEntry],
      };
    }
    case 'context_stats':
      return {
        ...state,
        contextStats: {
          currentTokens: action.currentTokens,
          limitTokens: action.limitTokens,
          percent: action.percent,
          canCompact: action.canCompact,
        },
      };
    case 'context_compacting':
      return { ...state, compacting: action.active };
    case 'context_compacted':
      return {
        ...state,
        session: [
          ...commitStreaming(state),
          {
            type: 'compaction_divider',
            summaryExcerpt: action.summaryExcerpt,
            summary: action.summary,
            tokensBefore: action.tokensBefore,
            tokensAfter: action.tokensAfter,
            exclude_from_context: true,
          },
        ],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
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
    case 'mode_state':
      return {
        ...state,
        autonomous: action.autonomous,
        effectiveAutonomous: action.effectiveAutonomous,
        workflowMode: action.workflowMode,
        effectiveWorkflowMode: action.effectiveWorkflowMode,
        editControl: action.editControl,
        commandControl: action.commandControl,
        editCommandLocked: action.editCommandLocked,
        running: action.running,
      };
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
        if (type === 'user_message') {
          // The server persists attachments as links (name + absolute path of
          // the session's stored copy), never inline content, so rebuild the
          // clickable chips from those links.
          const rawAtts = Array.isArray(e.attachments) ? e.attachments : [];
          const attachments = rawAtts.map((a) => {
            const rec = a as Record<string, unknown>;
            return { name: String(rec.name ?? ''), path: String(rec.path ?? '') };
          });
          entries.push({ type, content: String(e.content ?? ''), attachments, exclude_from_context: false });
        } else if (type === 'assistant_response') {
          entries.push({ type, content: String(e.content ?? ''), exclude_from_context: false });
        } else if (type === 'thinking_block') {
          entries.push({ type: 'thinking_block', content: String(e.content ?? ''), durationMs: typeof e.durationMs === 'number' ? e.durationMs : null, exclude_from_context: true });
        } else if (type === 'tool_call') {
          const rawRows = Array.isArray(e.rows) ? e.rows : [];
          const rows: ToolCallDetailRow[] = rawRows.map((r) => {
            const row = r as Record<string, unknown>;
            return {
              name: String(row.name ?? ''),
              value: String(row.value ?? ''),
              source: row.source === 'output' ? 'output' : 'input',
              visibility: row.visibility === 'always' ? 'always' : 'visible',
            };
          });
          const rawDiff = e.diff as Record<string, unknown> | null | undefined;
          const diff: DiffLinkData | null =
            rawDiff && typeof rawDiff === 'object'
              ? {
                  label: String(rawDiff.label ?? ''),
                  prevPath: String(rawDiff.prevPath ?? ''),
                  newPath: String(rawDiff.newPath ?? ''),
                }
              : null;
          entries.push({
            type: 'tool_call',
            toolName: String(e.toolName ?? ''),
            description: String(e.description ?? ''),
            toolCallId: String(e.toolCallId ?? ''),
            rows,
            detailFile: typeof e.detailFile === 'string' ? e.detailFile : null,
            schemaCompliance: typeof e.schemaCompliance === 'boolean' ? e.schemaCompliance : null,
            success: typeof e.success === 'boolean' ? e.success : null,
            // History: the call already finished, so no live progress bar.
            timeoutSeconds: null,
            startedAt: null,
            diff,
            // Generation timing is a live-only nicety; not persisted to history.
            toolgenDurationMs: null,
            toolgenChars: null,
            exclude_from_context: false,
          });
        } else if (type === 'subagent_task') {
          entries.push({ type: 'subagent_task', content: String(e.content ?? ''), exclude_from_context: true });
        } else if (type === 'subsession_start' || type === 'subsession_end') {
          entries.push({
            type: 'subsession_divider',
            phase: type === 'subsession_start' ? 'start' : 'end',
            displayName: String(e.displayName ?? ''),
            parentDisplayName: String(e.parentDisplayName ?? ''),
            exclude_from_context: true,
          });
        } else if (type === 'context_compacted') {
          entries.push({
            type: 'compaction_divider',
            summaryExcerpt: String(e.summaryExcerpt ?? ''),
            summary: String(e.summary ?? e.summaryExcerpt ?? ''),
            tokensBefore: typeof e.tokensBefore === 'number' ? e.tokensBefore : 0,
            tokensAfter: typeof e.tokensAfter === 'number' ? e.tokensAfter : 0,
            exclude_from_context: true,
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
  sessionName: '',
  currentProject: '',
  namingSession: false,
  stage: 'IDLE',
  agent: null,
  session: [],
  streamingTokens: '',
  streamingThinking: '',
  thinkingActive: false,
  thinkingStartedAt: null,
  streaming: false,
  lastPong: null,
  cumulativeUsd: 0,
  lastCallTokens: null,
  fileEvents: [],
  pendingGate: null,
  pendingQuestion: null,
  autonomous: false,
  effectiveAutonomous: false,
  workflowMode: 'problem_solving',
  effectiveWorkflowMode: 'problem_solving',
  editControl: 'smart',
  commandControl: 'smart',
  editCommandLocked: false,
  running: false,
  resumeSessionId: null,
  awaitingLlm: false,
  llmWaiting: null,
  streamingToolgen: '',
  toolgenActive: false,
  toolgenToolName: '',
  toolgenStartedAt: null,
  attachedFiles: [],
  contextStats: null,
  compacting: false,
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
        case 'workspace_status':
          dispatch({ type: 'workspace_status', hasWorkspace: Boolean(msg.hasWorkspace) });
          break;
        case 'status':
          dispatch({ type: 'status', connected: Boolean(msg.connected) });
          break;
        case 'session_name':
          dispatch({ type: 'session_name', name: String(msg.name ?? '') });
          break;
        case 'current_project':
          dispatch({ type: 'current_project', name: String(msg.name ?? '') });
          break;
        case 'session_naming':
          dispatch({ type: 'session_naming', active: Boolean(msg.active) });
          break;
        case 'session_cleared':
          dispatch({ type: 'session_cleared' });
          break;
        case 'attachment_added':
          dispatch({ type: 'attachment_added', id: String(msg.id ?? ''), name: String(msg.name ?? ''), path: String(msg.path ?? '') });
          break;
        case 'attachments_cleared':
          dispatch({ type: 'attachments_cleared' });
          break;
        case 'sent_attachments': {
          const raw = Array.isArray(msg.attachments) ? msg.attachments : [];
          const attachments = raw.map((a) => {
            const rec = a as Record<string, unknown>;
            return { name: String(rec.name ?? ''), path: String(rec.path ?? '') };
          });
          dispatch({ type: 'sent_attachments', attachments });
          break;
        }
        case 'token':
          dispatch({ type: 'token', text: String(msg.text ?? '') });
          break;
        case 'thinking_token':
          dispatch({ type: 'thinking_token', text: String(msg.text ?? '') });
          break;
        case 'toolgen_token':
          dispatch({ type: 'toolgen_token', toolName: String(msg.toolName ?? ''), text: String(msg.text ?? '') });
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
        case 'subsession_started':
          dispatch({ type: 'subsession_started', displayName: String(msg.displayName ?? ''), task: String(msg.task ?? '') });
          break;
        case 'subsession_ended':
          dispatch({
            type: 'subsession_ended',
            displayName: String(msg.displayName ?? ''),
            parentDisplayName: String(msg.parentDisplayName ?? ''),
          });
          break;
        case 'llm_turn_start':
          dispatch({ type: 'llm_turn_start' });
          break;
        case 'llm_waiting':
          dispatch({
            type: 'llm_waiting',
            waiting: Boolean(msg.waiting),
            reason: String(msg.reason ?? 'queued'),
            retryIn: typeof msg.retryIn === 'number' ? msg.retryIn : null,
          });
          break;
        case 'session_history':
          dispatch({ type: 'session_history', entries: (msg.entries as Record<string, unknown>[]) ?? [] });
          break;
        case 'tool_call':
          dispatch({ type: 'tool_call', toolName: String(msg.toolName ?? ''), description: String(msg.description ?? ''), toolCallId: String(msg.toolCallId ?? ''), timeoutSeconds: typeof msg.timeoutSeconds === 'number' ? msg.timeoutSeconds : null });
          break;
        case 'tool_call_detail': {
          const rawRows = Array.isArray(msg.rows) ? (msg.rows as Record<string, unknown>[]) : [];
          const rows: ToolCallDetailRow[] = rawRows.map((row) => ({
            name: String(row.name ?? ''),
            value: String(row.value ?? ''),
            source: row.source === 'output' ? 'output' : 'input',
            visibility: row.visibility === 'always' ? 'always' : 'visible',
          }));
          const rawDiff = msg.diff as Record<string, unknown> | null | undefined;
          const diff: DiffLinkData | null =
            rawDiff && typeof rawDiff === 'object'
              ? {
                  label: String(rawDiff.label ?? ''),
                  prevPath: String(rawDiff.prevPath ?? ''),
                  newPath: String(rawDiff.newPath ?? ''),
                }
              : null;
          dispatch({
            type: 'tool_call_detail',
            toolCallId: String(msg.toolCallId ?? ''),
            rows,
            detailFile: typeof msg.detailFile === 'string' ? msg.detailFile : null,
            schemaCompliance: typeof msg.schemaCompliance === 'boolean' ? msg.schemaCompliance : null,
            success: typeof msg.success === 'boolean' ? msg.success : null,
            diff,
          });
          break;
        }
        case 'usage':
          dispatch({
            type: 'usage',
            cumulativeUsd: Number(msg.cumulativeUsd ?? 0),
            lastCallTokens: (msg.lastCallTokens as LastCallTokens | null) ?? null,
            durationSeconds: Number(msg.durationSeconds ?? 0),
          });
          break;
        case 'context_stats':
          dispatch({
            type: 'context_stats',
            currentTokens: Number(msg.currentTokens ?? 0),
            limitTokens: Number(msg.limitTokens ?? 0),
            percent: Number(msg.percent ?? 0),
            canCompact: Boolean(msg.canCompact ?? false),
          });
          break;
        case 'context_compacting':
          dispatch({ type: 'context_compacting', active: Boolean(msg.active ?? false) });
          break;
        case 'context_compacted':
          dispatch({
            type: 'context_compacted',
            summaryExcerpt: String(msg.summaryExcerpt ?? ''),
            summary: String(msg.summary ?? msg.summaryExcerpt ?? ''),
            tokensBefore: Number(msg.tokensBefore ?? 0),
            tokensAfter: Number(msg.tokensAfter ?? 0),
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
        case 'mode_state':
          dispatch({
            type: 'mode_state',
            autonomous: Boolean(msg.autonomous),
            effectiveAutonomous: Boolean(msg.effectiveAutonomous),
            workflowMode: msg.workflowMode === 'guided' ? 'guided' : 'problem_solving',
            effectiveWorkflowMode: msg.effectiveWorkflowMode === 'guided' ? 'guided' : 'problem_solving',
            editControl: coerceEditControl(msg.editControl),
            commandControl: coerceCommandControl(msg.commandControl),
            editCommandLocked: Boolean(msg.editCommandLocked),
            running: Boolean(msg.running),
          });
          break;
        case 'persist_session_id':
          // Stash the id so VS Code's panel serializer can resume this exact
          // session after a window reload / workspace reopen.
          vscode.setState({ sessionId: String(msg.sessionId ?? '') });
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

  function handleCompact() {
    vscode.postMessage({ type: 'compact_now' });
  }

  function handleDelete() {
    // Confirmation + deletion are driven by the extension host (native dialog).
    vscode.postMessage({ type: 'delete_session' });
  }

  function handleAttach() {
    // The open dialog, validation, and file reading all live in the host; it
    // posts back `attachment_added` for each accepted file.
    vscode.postMessage({ type: 'attach_file' });
  }

  function removeAttachment(id: string) {
    // Drop the chip locally and tell the host to forget the file's content.
    dispatch({ type: 'attachment_removed', id });
    vscode.postMessage({ type: 'remove_attachment', id });
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

  const isEmpty = state.session.length === 0 && !state.streamingTokens && !state.streamingThinking && !state.awaitingLlm && !state.llmWaiting && !state.namingSession && !state.toolgenActive && !state.compacting;

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
        sessionName={state.sessionName}
        currentProject={state.currentProject}
        cumulativeUsd={state.cumulativeUsd}
        lastCallTokens={state.lastCallTokens}
        contextStats={state.contextStats}
        compacting={state.compacting}
        onCompact={handleCompact}
      />

      {/* Session feed */}
      <div style={styles.stream}>
        {state.session.map((entry, i) => (
          <SessionEntryView key={i} entry={entry} />
        ))}
        {state.streamingThinking && (
          <ThinkingBlock content={state.streamingThinking} isActive={state.thinkingActive} startedAt={state.thinkingStartedAt} />
        )}
        {state.streamingTokens && (
          <div style={styles.agentTokens}><Markdown content={state.streamingTokens} /></div>
        )}
        {state.toolgenActive && (
          <ToolgenBlock
            toolName={state.toolgenToolName}
            content={state.streamingToolgen}
            startedAt={state.toolgenStartedAt}
          />
        )}
        {state.namingSession && <NamingIndicator />}
        {state.compacting && <CompactingIndicator />}
        {state.llmWaiting && <LlmWaitingIndicator waiting={state.llmWaiting} />}
        {state.awaitingLlm && !state.llmWaiting && <AwaitingIndicator />}
        {isEmpty && (
          state.connected ? "Hello there. I'm Kodo. Ready to build something awesome." : 'Not connected to server.'
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
          {/* Per-session mode toggles (apply to the next prompt) */}
          <ModeControls
            autonomous={state.autonomous}
            effectiveAutonomous={state.effectiveAutonomous}
            workflowMode={state.workflowMode}
            effectiveWorkflowMode={state.effectiveWorkflowMode}
            editControl={state.editControl}
            commandControl={state.commandControl}
            editCommandLocked={state.editCommandLocked}
            connected={state.connected}
            running={state.running}
          />
          <div style={styles.inputFooter}>
            <AttachedFilesArea files={state.attachedFiles} onRemove={removeAttachment} />
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
                onClick={handleAttach}
                disabled={!state.connected || state.attachedFiles.length >= 9}
                title="Attach text files to the next prompt"
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
              <button
                style={styles.deleteBtn}
                onClick={handleDelete}
                disabled={!state.connected}
                title="Delete this session (permanently removes all its history)"
              >
                {'🗑'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachedFilesArea — staged-attachment chips, left of the footer buttons
// ---------------------------------------------------------------------------

/**
 * The space to the left of the footer buttons. Holds up to 9 attachment chips,
 * each a hollow yellow-bordered rounded rectangle showing the (truncated) file
 * name and a clickable 🗑 that removes it. File content is owned by the host.
 */
function AttachedFilesArea({ files, onRemove }: { files: AttachedFile[]; onRemove: (id: string) => void }) {
  return (
    <div style={styles.attachArea}>
      {files.map((f) => (
        <div key={f.id} style={styles.attachChip} title={f.name}>
          <span style={styles.attachChipName}>{f.name}</span>
          <span
            style={styles.attachChipRemove}
            title="Remove attachment"
            role="button"
            onClick={() => onRemove(f.id)}
          >
            {'🗑'}
          </span>
        </div>
      ))}
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

/**
 * Gateway queue/throttle indicator. While a request is queued behind the serial
 * local gate / a saturated cloud feed it reads "LLM is busy, waiting"; while a
 * 429 backoff is in effect it reads "Getting throttled, waiting for X minutes".
 */
function LlmWaitingIndicator({ waiting }: { waiting: { reason: string; retryIn: number | null } }) {
  const label =
    waiting.reason === 'throttled'
      ? `Getting throttled, waiting for ${Math.max(1, Math.round((waiting.retryIn ?? 60) / 60))} minute${
          Math.max(1, Math.round((waiting.retryIn ?? 60) / 60)) === 1 ? '' : 's'
        } `
      : 'LLM is busy, waiting ';
  return (
    <div style={styles.awaitingLine}>
      {label}<BouncingDots />
    </div>
  );
}

/**
 * Progress bar shown under a live `run_command` call while it runs. The filled
 * `===>` segment advances from empty toward full over the command's timeout
 * window (`|======>.......|`), so it reaches the right edge exactly when the
 * command would be killed. Removed once the tool's detail (result) arrives.
 */
const RUN_COMMAND_BAR_WIDTH = 24;

function RunCommandProgress({ timeoutSeconds, startedAt }: { timeoutSeconds: number; startedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
  const frac = timeoutSeconds > 0 ? Math.min(elapsed / timeoutSeconds, 1) : 1;
  const filled = Math.round(frac * RUN_COMMAND_BAR_WIDTH);
  const bar =
    (filled > 0 ? '='.repeat(filled - 1) + '>' : '') +
    '.'.repeat(RUN_COMMAND_BAR_WIDTH - filled);
  const shown = Math.min(Math.floor(elapsed), Math.floor(timeoutSeconds));
  return (
    <div style={styles.runCommandProgress}>
      {'Waiting for tool output '}
      <span style={styles.runCommandBar}>{`|${bar}|`}</span>
      {` ${shown}s / ${Math.floor(timeoutSeconds)}s`}
    </div>
  );
}

function NamingIndicator() {
  return (
    <div style={styles.awaitingLine}>
      {'Starting a new session '}<BouncingDots />
    </div>
  );
}

function CompactingIndicator() {
  return (
    <div style={styles.awaitingLine}>
      {'Compacting context, please hold on '}<BouncingDots />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThinkingBlock component
// ---------------------------------------------------------------------------

/**
 * "<prefix> in Xs, N chars, R chars/s" — the completion summary shown once a
 * thinking block or tool-arg generation finishes. Falls back to "<prefix>, N
 * chars" when the duration is unknown (e.g. rehydrated history) so we never
 * divide by zero or render a bogus rate.
 */
function completionLabel(prefix: string, chars: number, durationMs: number | null): string {
  if (durationMs === null || durationMs <= 0) {
    return `${prefix}, ${chars.toLocaleString()} chars`;
  }
  const secs = durationMs / 1000;
  const rate = (chars / secs).toFixed(1);
  return `${prefix} in ${Math.round(secs)}s, ${chars.toLocaleString()} chars, ${rate} chars/s`;
}

/** Re-render on a 250ms tick so a live elapsed timer stays current. */
function useElapsedTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [active]);
}

/** "<N> chars · <S>s" line shown under a live streaming summary. */
function StreamingMeta({ content, startedAt }: { content: string; startedAt: number | null }) {
  const elapsed = startedAt !== null ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return <div style={styles.toolgenMeta}>{`${content.length.toLocaleString()} chars · ${elapsed}s`}</div>;
}

interface ThinkingBlockProps {
  content: string;
  isActive: boolean;
  startedAt?: number | null;
  durationMs?: number | null;
}

function ThinkingBlock({ content, isActive, startedAt = null, durationMs = null }: ThinkingBlockProps) {
  useElapsedTick(isActive);
  return (
    <details style={styles.thinkingBlock}>
      <summary style={styles.thinkingSummary}>
        {isActive ? (
          <>
            <span>{'Thinking '}<BouncingDots /></span>
            <StreamingMeta content={content} startedAt={startedAt} />
          </>
        ) : completionLabel('Thinking completed', content.length, durationMs)}
      </summary>
      <div style={styles.thinkingContent}>{content}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// CompactionBlock component
// ---------------------------------------------------------------------------

/**
 * Marks where the prior conversation was summarised and the live LLM context
 * reset. Rendered as a collapsible block in the same visual language as
 * ThinkingBlock: the summary line shows "✦ Context compacted (before → after
 * tokens)" and expanding it reveals the full summary — i.e. the exact context
 * the conversation continues from after compaction. Everything above the block
 * stays visible as history but is no longer part of the LLM context.
 */
function CompactionBlock({ summary, tokensBefore, tokensAfter }: { summary: string; tokensBefore: number; tokensAfter: number }) {
  const reduction =
    tokensBefore > 0 && tokensAfter > 0
      ? ` (${formatTokens(tokensBefore)} → ${formatTokens(tokensAfter)} tokens)`
      : '';
  return (
    <details style={styles.thinkingBlock}>
      <summary style={styles.thinkingSummary}>{`✦ Context compacted${reduction}`}</summary>
      <div style={styles.thinkingContent}>{summary || '(no summary recorded)'}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// ToolgenBlock component
// ---------------------------------------------------------------------------

/**
 * Live indicator shown while the model streams a tool call's arguments (which
 * can be a whole file and take minutes). The summary line bounces dots and
 * ticks an elapsed timer so it is obvious the model is still working; the
 * collapsible body reveals the raw arguments arriving so far. Removed once the
 * call completes — at which point the tool_call entry shows "Generated … in …".
 */
function ToolgenBlock({ toolName, content, startedAt }: { toolName: string; content: string; startedAt: number | null }) {
  useElapsedTick(true);
  const label = toolName || 'tool call';
  return (
    <details style={styles.thinkingBlock}>
      <summary style={styles.thinkingSummary}>
        <span>{'Generating content for '}<span style={styles.toolgenName}>{label}</span>{' '}<BouncingDots /></span>
        <StreamingMeta content={content} startedAt={startedAt} />
      </summary>
      <div style={styles.thinkingContent}>{content || '…'}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// SessionEntryView component
// ---------------------------------------------------------------------------

/** Crop a `visible` parameter value to at most 3 lines / 200 characters. */
function cropVisibleValue(value: string): string {
  const lines = value.split('\n');
  let text = lines.slice(0, 3).join('\n');
  if (lines.length > 3) {
    text += '\n…';
  }
  if (text.length > 200) {
    text = text.slice(0, 200) + '…';
  }
  return text;
}

/**
 * The clickable detail box shown beneath a tool-call one-liner. Renders the
 * customer-visible parameters as a two-column table (`always` in full,
 * `visible` cropped); clicking opens the persisted Markdown doc with the full
 * input and output.
 */
function ToolCallDetail({ entry }: { entry: Extract<SessionEntry, { type: 'tool_call' }> }) {
  if (entry.rows.length === 0) {
    return null;
  }
  const clickable = entry.detailFile !== null;
  const openDoc = () => {
    if (entry.detailFile !== null) {
      vscode.postMessage({ type: 'open_file', path: entry.detailFile });
    }
  };
  return (
    <div
      style={{ ...styles.toolCallBox, ...(clickable ? styles.toolCallBoxClickable : {}) }}
      onClick={clickable ? openDoc : undefined}
      title={clickable ? 'Open the full tool input & output' : undefined}
    >
      {entry.schemaCompliance === false && (
        <div style={styles.toolCallWarn}>
          ⚠️ Output did not match the tool&apos;s schema and was repaired.
        </div>
      )}
      <table style={styles.toolCallTable}>
        <tbody>
          {entry.rows.map((r, i) => (
            <tr key={i}>
              <td style={styles.toolCallParamName}>{r.name}</td>
              <td style={styles.toolCallParamValue}>
                {r.visibility === 'always' ? r.value : cropVisibleValue(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Clickable rounded-box link offering a before/after diff for a tool call
 * (e.g. edit_file). Rendered between the standard tool name/description line
 * and the parameters detail box. Posts 'open_diff' so the extension host can
 * open it via the standard `vscode.diff` command.
 */
function DiffLink({ diff }: { diff: DiffLinkData }) {
  const openDiff = () => {
    vscode.postMessage({ type: 'open_diff', prevPath: diff.prevPath, newPath: diff.newPath, label: diff.label });
  };
  return (
    <div
      style={{ ...styles.toolCallBox, ...styles.toolCallBoxClickable, ...styles.diffLinkBox }}
      onClick={openDiff}
      title="Open a diff view comparing the file before and after this change"
    >
      Click here to open a diff view of {diff.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown rendering
//
// A small, best-effort markdown renderer for agent message text. It is built
// to cope with *streamed*, partially-complete content: any unterminated
// block-level construct (a fenced code block or one of the kodo callout tags
// below) is treated as if it were auto-closed at the end of the text. Inline
// emphasis (**bold**, *italic*, `code`) is rendered only when properly paired,
// so transient half-typed markers and incidental characters such as the `*` in
// `2 * 3` or the `_` in snake_case identifiers are left as literal text rather
// than being force-closed and mangled.
//
// Four special callout tags are recognised on top of markdown:
//   <kodo_info>…</kodo_info>  ℹ️  blue    — progress / informational notes
//   <kodo_warn>…</kodo_warn>  ⚠️  yellow  — potential problems / contradictions
//   <kodo_crit>…</kodo_crit>  💥  red     — errors / blocking failures
//   <kodo>…</kodo>            ド  green   — good news / solved problems
// ---------------------------------------------------------------------------

type KodoVariant = 'kodo_info' | 'kodo_warn' | 'kodo_crit' | 'kodo';

const KODO_META = {
  kodo_info: {
    symbol: 'ℹ️',
    block: {
      margin: '10px 0',
      border: '1px solid rgba(74, 158, 255, 0.6)',
      background: 'rgba(74, 158, 255, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '20px', lineHeight: 1.3, flexShrink: 0 },
  },
  kodo_warn: {
    symbol: '⚠️',
    block: {
      margin: '15px 0',
      border: '1px solid rgba(230, 184, 0, 0.7)',
      background: 'rgba(230, 184, 0, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '20px', lineHeight: 1.3, flexShrink: 0 },
  },
  kodo_crit: {
    symbol: '💥',
    block: {
      margin: '20px 0',
      border: '1px solid rgba(255, 92, 92, 0.7)',
      background: 'rgba(255, 92, 92, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '20px', lineHeight: 1.3, flexShrink: 0 },
  },
  kodo: {
    symbol: 'ド',
    block: {
      margin: '20px 0',
      border: '1px solid rgba(63, 185, 80, 0.7)',
      background: 'rgba(63, 185, 80, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '22px', lineHeight: 1.2, flexShrink: 0, color: '#3fb950', fontWeight: 700 },
  },
};

// Opening tag of any kodo callout. More specific names come first so that, e.g.
// `<kodo_info>` is never mis-read as `<kodo>` followed by stray text.
const KODO_OPEN_RE = /<(kodo_info|kodo_warn|kodo_crit|kodo)>/;

// Inline patterns, tried in priority order. The earliest match in the text
// wins; ties are broken by this order (so `**` beats `*` at the same index).
const INLINE_PATTERNS: { re: RegExp; kind: 'code' | 'bold' | 'italic' | 'link' }[] = [
  { re: /`([^`]+)`/, kind: 'code' },
  { re: /\*\*([\s\S]+?)\*\*/, kind: 'bold' },
  { re: /(?<![A-Za-z0-9])__([\s\S]+?)__(?![A-Za-z0-9])/, kind: 'bold' },
  { re: /\*([\s\S]+?)\*/, kind: 'italic' },
  { re: /(?<![A-Za-z0-9])_([\s\S]+?)_(?![A-Za-z0-9])/, kind: 'italic' },
  { re: /\[([^\]]*)\]\(([^)\s]+)\)/, kind: 'link' },
];

function headingStyle(level: number): Record<string, unknown> {
  const sizes = ['1.5em', '1.35em', '1.2em', '1.1em', '1em', '0.95em'];
  return { ...styles.mdHeadingBase, fontSize: sizes[level - 1] };
}

// Render inline markdown (emphasis, code spans, links) inside a single span of
// text. Returns an array of preact children.
function parseInline(text: string, kp: string): ComponentChildren[] {
  const nodes: ComponentChildren[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    let bestStart = Infinity;
    let bestKind: 'code' | 'bold' | 'italic' | 'link' | null = null;
    let bestMatch: RegExpExecArray | null = null;
    for (const p of INLINE_PATTERNS) {
      const m = p.re.exec(rest);
      if (m && m.index < bestStart) {
        bestStart = m.index;
        bestKind = p.kind;
        bestMatch = m;
      }
    }
    if (!bestMatch || bestKind === null) {
      nodes.push(rest);
      break;
    }
    if (bestStart > 0) nodes.push(rest.slice(0, bestStart));
    const m = bestMatch;
    const key = `${kp}-${k++}`;
    switch (bestKind) {
      case 'code':
        nodes.push(<code key={key} style={styles.mdCode}>{m[1]}</code>);
        break;
      case 'bold':
        nodes.push(<strong key={key} style={styles.mdBold}>{parseInline(m[1], key)}</strong>);
        break;
      case 'italic':
        nodes.push(<em key={key}>{parseInline(m[1], key)}</em>);
        break;
      case 'link':
        nodes.push(
          <a key={key} href={m[2]} style={styles.mdLink} target="_blank" rel="noreferrer">
            {parseInline(m[1], key)}
          </a>,
        );
        break;
    }
    rest = rest.slice(bestStart + m[0].length);
  }
  return nodes;
}

// Render block-level markdown (headings, lists, quotes, code fences,
// paragraphs, rules). Returns an array of preact children.
function parseBlocks(text: string, kp: string): ComponentChildren[] {
  const lines = text.split('\n');
  const blocks: ComponentChildren[] = [];
  let i = 0;
  let k = 0;
  const nextKey = () => `${kp}-${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    // Fenced code block (auto-closes at end of text if the closing fence is
    // missing — handles content still being streamed).
    if (/^\s*```/.test(line)) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      blocks.push(
        <pre key={nextKey()} style={styles.mdPre}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    // Heading
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      blocks.push(h(`h${level}`, { key: nextKey(), style: headingStyle(level) }, parseInline(hm[2], nextKey())));
      i++;
      continue;
    }
    // Horizontal rule (---, ***, ___, possibly spaced)
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={nextKey()} style={styles.mdHr} />);
      i++;
      continue;
    }
    // Blockquote
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={nextKey()} style={styles.mdQuote}>
          {parseBlocks(quote.join('\n'), nextKey())}
        </blockquote>,
      );
      continue;
    }
    // List (unordered or ordered) — single-level, best-effort.
    const listM = /^(\s*)([-*+]|\d+\.)\s+/.exec(line);
    if (listM) {
      const ordered = /\d+\./.test(listM[2]);
      const items: ComponentChildren[] = [];
      while (i < lines.length) {
        const lm = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!lm) break;
        const ik = nextKey();
        items.push(
          <li key={ik} style={styles.mdLi}>
            {parseInline(lm[3], ik)}
          </li>,
        );
        i++;
      }
      blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey(), style: ordered ? styles.mdOl : styles.mdUl }, items));
      continue;
    }
    // Paragraph — gather consecutive lines until a blank line or another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const pk = nextKey();
    const inlineNodes: ComponentChildren[] = [];
    para.forEach((pl, idx) => {
      if (idx > 0) inlineNodes.push(<br key={`${pk}-br-${idx}`} />);
      inlineNodes.push(...parseInline(pl, `${pk}-${idx}`));
    });
    blocks.push(
      <p key={pk} style={styles.mdP}>
        {inlineNodes}
      </p>,
    );
  }
  return blocks;
}

function KodoBlock({ variant, inner }: { variant: KodoVariant; inner: string }) {
  const meta = KODO_META[variant];
  return (
    <div style={meta.block}>
      <span style={meta.icon}>{meta.symbol}</span>
      <div style={styles.kodoBody}>{parseBlocks(inner.trim(), 'kodo')}</div>
    </div>
  );
}

// Split top-level content into kodo callout blocks and plain markdown spans,
// then render each. An unterminated kodo tag consumes the rest of the text.
function renderContent(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const m = KODO_OPEN_RE.exec(rest);
    if (!m) {
      out.push(...parseBlocks(rest, `md-${key++}`));
      break;
    }
    const before = rest.slice(0, m.index);
    if (before.trim() !== '') out.push(...parseBlocks(before, `md-${key++}`));
    const variant = m[1] as KodoVariant;
    const afterOpen = rest.slice(m.index + m[0].length);
    const cm = new RegExp(`</${variant}>`).exec(afterOpen);
    let inner: string;
    if (cm) {
      inner = afterOpen.slice(0, cm.index);
      rest = afterOpen.slice(cm.index + cm[0].length);
    } else {
      inner = afterOpen; // unclosed → take the remainder of the text
      rest = '';
    }
    out.push(<KodoBlock key={`kodo-${key++}`} variant={variant} inner={inner} />);
  }
  return out;
}

function Markdown({ content }: { content: string }) {
  return <div style={styles.mdRoot}>{renderContent(content)}</div>;
}

interface SessionEntryViewProps {
  entry: SessionEntry;
}

function SessionEntryView({ entry }: SessionEntryViewProps) {
  switch (entry.type) {
    case 'user_message':
      return (
        <div style={styles.userPrompt}>
          <div style={styles.userPromptText}>{entry.content}</div>
          {entry.attachments.length > 0 && (
            <div style={styles.userPromptAttachments}>
              {entry.attachments.map((a, i) => (
                <div
                  key={i}
                  style={styles.sentAttachChip}
                  title={`Open ${a.path}`}
                  role="button"
                  onClick={() => vscode.postMessage({ type: 'open_file', path: a.path })}
                >
                  <span style={styles.sentAttachIcon}>📄</span>
                  <span style={styles.attachChipName}>{a.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    case 'assistant_response':
      return <div style={styles.agentTokens}><Markdown content={entry.content} /></div>;
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
      return <ThinkingBlock content={entry.content} isActive={false} durationMs={entry.durationMs} />;
    case 'tool_call': {
      // The result hasn't arrived until the detail event fills these in.
      const resultArrived =
        entry.rows.length > 0 || entry.detailFile !== null || entry.schemaCompliance !== null;
      const showProgress =
        entry.toolName === 'run_command' &&
        entry.startedAt !== null &&
        entry.timeoutSeconds !== null &&
        !resultArrived;
      return (
        <div>
          {entry.toolgenDurationMs !== null && (
            <div style={styles.toolgenDone}>
              {completionLabel(`Generated content for ${entry.toolName}`, entry.toolgenChars ?? 0, entry.toolgenDurationMs)}
            </div>
          )}
          <div style={styles.toolCall}>
            {entry.success === true && <span style={styles.toolCallOk}>{'✅ '}</span>}
            {entry.success === false && <span style={styles.toolCallFail}>{'⚠️ '}</span>}
            <span style={styles.toolCallName}>
              {entry.toolName}
            </span>
            {entry.description && (
              <span style={styles.toolCallDesc}>{' — '}{entry.description}</span>
            )}
          </div>
          {showProgress && (
            <RunCommandProgress timeoutSeconds={entry.timeoutSeconds!} startedAt={entry.startedAt!} />
          )}
          {entry.diff !== null && <DiffLink diff={entry.diff} />}
          <ToolCallDetail entry={entry} />
        </div>
      );
    }
    case 'post_update':
      return <div style={styles.postUpdate}>{entry.content}</div>;
    case 'subsession_divider': {
      const label =
        entry.phase === 'start'
          ? `Delegating the task to ${entry.displayName} subagent`
          : `${entry.displayName} subagent has finished working on the task.`;
      return (
        <div style={styles.subsessionDivider}>
          <span style={styles.subsessionDividerLine} />
          <span style={styles.subsessionDividerLabel}>{label}</span>
          <span style={styles.subsessionDividerLine} />
        </div>
      );
    }
    case 'subagent_task':
      return (
        <div style={styles.subagentTask}>
          <div style={styles.subagentTaskLabel}>Task brief</div>
          <div style={styles.subagentTaskText}>{entry.content}</div>
        </div>
      );
    case 'compaction_divider':
      return (
        <CompactionBlock
          summary={entry.summary}
          tokensBefore={entry.tokensBefore}
          tokensAfter={entry.tokensAfter}
        />
      );
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

// ---------------------------------------------------------------------------
// ModeControls — per-session autonomous + workflow toggles (tab header)
// ---------------------------------------------------------------------------

// Base, status-free description of what each toggle controls. The dynamic
// status line ("in effect" / "queued for the next prompt" / "locked by
// Autonomous") is appended at render time by the build*Tooltip helpers.
const _MODE_DESC = {
  interactive: 'Interactive — agents work alongside you, asking questions before key decisions.',
  autonomous: 'Autonomous — agents work on their own, making reasonable assumptions instead of pausing.',
  problem_solving: 'Problem Solving — one generalist agent tackles your request end to end.',
  guided: 'Guided Development — Kōdo walks through design, tests and implementation phases.',
  editControl:
    'Edit Control — how Kōdo handles file edits. Review All pauses for your sign-off on every edit; Allow All applies edits without pausing; Smart lets Kōdo decide per edit.',
  commandControl:
    'Command Control — how much Kōdo restricts potentially risky commands. Defensive blocks risky commands; Permissive allows them; Smart decides per command.',
};

/** Button label per Edit Control posture. */
const _EDIT_LABEL: Record<EditControl, string> = {
  smart: '🧠 Edit Control: Smart',
  review_all: '🔍 Edit Control: Review All',
  allow_all: '✅ Edit Control: Allow All',
};

/** Short posture name used inside tooltips. */
const _EDIT_NAME: Record<EditControl, string> = {
  smart: 'Smart',
  review_all: 'Review All',
  allow_all: 'Allow All',
};

/** Click-cycle order, default-first: Smart → Review All → Allow All → Smart. */
const _EDIT_NEXT: Record<EditControl, EditControl> = {
  smart: 'review_all',
  review_all: 'allow_all',
  allow_all: 'smart',
};

/** Button label per Command Control posture. */
const _COMMAND_LABEL: Record<CommandControl, string> = {
  smart: '🧠 Command Control: Smart',
  defensive: '🛡️ Command Control: Defensive',
  permissive: '🔓 Command Control: Permissive',
};

/** Short posture name used inside tooltips. */
const _COMMAND_NAME: Record<CommandControl, string> = {
  smart: 'Smart',
  defensive: 'Defensive',
  permissive: 'Permissive',
};

/** Click-cycle order, default-first: Smart → Defensive → Permissive → Smart. */
const _COMMAND_NEXT: Record<CommandControl, CommandControl> = {
  smart: 'defensive',
  defensive: 'permissive',
  permissive: 'smart',
};

/**
 * Tooltip for the two *frozen* toggles (workflow, autonomous): the description
 * plus a status line. The effective value only changes when a new turn starts,
 * so while a turn is running and the user's selection differs from the frozen
 * effective value the toggle is "queued for the next prompt"; otherwise it is
 * "in effect". When idle a flip takes effect immediately, so it reads as in
 * effect.
 *
 * @param desc Status-free description of the selected position.
 * @param effectiveName Human name of the value the in-flight turn is using.
 * @param pending True when running and the selection diverges from effective.
 */
function buildModeTooltip(desc: string, effectiveName: string, pending: boolean): string {
  return pending
    ? `${desc} Will be applied to the next prompt, current mode: ${effectiveName}.`
    : `${desc} This mode is in effect.`;
}

/**
 * Tooltip for the two *never-frozen* toggles (Edit/Command Control). They are
 * locked to a forced posture while Autonomous mode is in effect; otherwise they
 * apply immediately (no per-turn freeze).
 *
 * @param desc Status-free description of the toggle.
 * @param locked True while Autonomous mode is in effect.
 * @param lockedName The forced posture name shown when locked.
 */
function buildLockTooltip(desc: string, locked: boolean, lockedName: string): string {
  return locked
    ? `${desc} Locked to ${lockedName} while Autonomous mode is in effect.`
    : `${desc} This setting is in effect.`;
}

/**
 * Custom hover tooltip. Native `title` is unreliable in VS Code webviews (no
 * tooltip on disabled buttons, inconsistent timing), so the ⓘ marker renders
 * its own positioned bubble. Shown above the trigger to avoid clipping at the
 * panel footer where the mode bar lives.
 */
function Tooltip({ text, children }: { text: string; children: ComponentChildren }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={styles.tooltipWrap}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={styles.tooltipBox} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * One toggle cell: the cycling button plus a trailing ⓘ marker that owns the
 * tooltip (the button itself has none — hovering ⓘ is how you read what the
 * toggle does, which also works while the button is disabled/locked).
 */
function ModeButton({
  label,
  tip,
  disabled,
  onClick,
}: {
  label: string;
  tip: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <span style={styles.modeBtnWrap}>
      <button
        style={disabled ? { ...styles.modeBtn, ...styles.modeBtnDisabled } : styles.modeBtn}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
      <Tooltip text={tip}>
        <span style={styles.modeInfo} role="img" aria-label="info">
          ⓘ
        </span>
      </Tooltip>
    </span>
  );
}

interface ModeControlsProps {
  autonomous: boolean;
  effectiveAutonomous: boolean;
  workflowMode: 'guided' | 'problem_solving';
  effectiveWorkflowMode: 'guided' | 'problem_solving';
  editControl: EditControl;
  commandControl: CommandControl;
  /** True while Autonomous is in effect: Edit/Command are forced and locked. */
  editCommandLocked: boolean;
  connected: boolean;
  /** True while a turn is in flight; gates the frozen toggles' "queued" status. */
  running: boolean;
}

function ModeControls({
  autonomous,
  effectiveAutonomous,
  workflowMode,
  effectiveWorkflowMode,
  editControl,
  commandControl,
  editCommandLocked,
  connected,
  running,
}: ModeControlsProps) {
  const isPS = workflowMode === 'problem_solving';

  const wfTip = buildModeTooltip(
    isPS ? _MODE_DESC.problem_solving : _MODE_DESC.guided,
    effectiveWorkflowMode === 'problem_solving' ? 'Problem Solving' : 'Guided Development',
    running && workflowMode !== effectiveWorkflowMode,
  );
  const autoTip = buildModeTooltip(
    autonomous ? _MODE_DESC.autonomous : _MODE_DESC.interactive,
    effectiveAutonomous ? 'Autonomous' : 'Interactive',
    running && autonomous !== effectiveAutonomous,
  );
  const editTip = buildLockTooltip(_MODE_DESC.editControl, editCommandLocked, _EDIT_NAME.allow_all);
  const commandTip = buildLockTooltip(
    _MODE_DESC.commandControl,
    editCommandLocked,
    _COMMAND_NAME.permissive,
  );

  return (
    <div style={styles.modeControls}>
      <ModeButton
        label={isPS ? '💡 Problem Solving' : '🧩 Guided Development'}
        tip={wfTip}
        disabled={!connected}
        onClick={() => vscode.postMessage({ type: 'workflow_set', mode: isPS ? 'guided' : 'problem_solving' })}
      />
      <ModeButton
        label={autonomous ? '⚡ Autonomous' : '💬 Interactive'}
        tip={autoTip}
        disabled={!connected}
        onClick={() => vscode.postMessage({ type: 'mode_set', autonomous: !autonomous })}
      />
      <ModeButton
        label={_EDIT_LABEL[editControl]}
        tip={editTip}
        disabled={!connected || editCommandLocked}
        onClick={() => vscode.postMessage({ type: 'edit_control_set', editControl: _EDIT_NEXT[editControl] })}
      />
      <ModeButton
        label={_COMMAND_LABEL[commandControl]}
        tip={commandTip}
        disabled={!connected || editCommandLocked}
        onClick={() => vscode.postMessage({ type: 'command_control_set', commandControl: _COMMAND_NEXT[commandControl] })}
      />
    </div>
  );
}

interface UsagePanelProps {
  sessionName: string;
  currentProject: string;
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
  contextStats: ContextStats | null;
  compacting: boolean;
  onCompact: () => void;
}

function UsagePanel({ sessionName, currentProject, cumulativeUsd, lastCallTokens, contextStats, compacting, onCompact }: UsagePanelProps) {
  // Always render both header lines so the session name and running cost are
  // visible from the very first frame — before a title is generated and before
  // any cost has accrued.
  return (
    <div style={styles.usagePanel}>
      <div style={styles.usageName}>
        Session name: <strong>{sessionName || 'Unnamed Session'}</strong>
      </div>
      {currentProject && (
        <div style={styles.usageName}>
          Project: <strong>{currentProject}</strong> <span style={styles.usageDetail}>(locked for this session)</span>
        </div>
      )}
      <div style={styles.usageCostLine}>
        <span style={styles.usageTotal}>
          Session cost: <strong>${cumulativeUsd.toFixed(4)}</strong>
        </span>
        {lastCallTokens !== null && (
          <span style={styles.usageDetail}>
            {' '}| last call: {lastCallTokens.input}↑ {lastCallTokens.output}↓
            {lastCallTokens.cache_read > 0 && ` ${lastCallTokens.cache_read}✦cached`}
          </span>
        )}
        {contextStats !== null && (
          <>
            <span style={styles.usageDetail}>
              {' '}| context: <strong>{formatTokens(contextStats.currentTokens)}</strong>
              {' / '}{formatTokens(contextStats.limitTokens)}
              {' ('}{contextStats.percent.toFixed(0)}%)
            </span>
            <button
              style={contextStats.canCompact && !compacting ? styles.compactBtn : styles.compactBtnDisabled}
              onClick={onCompact}
              disabled={!contextStats.canCompact || compacting}
              title={compacting ? 'Compaction in progress' : contextStats.canCompact ? 'Summarise and reset the LLM context now' : 'Available once the current turn has finished'}
            >
              Compact now
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Compact a token count for the header: 1234 → "1,234", 25600 → "25.6K". */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
  return n.toLocaleString();
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
  attachArea: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignContent: 'flex-start',
    alignItems: 'flex-start',
    gap: '4px',
    overflowY: 'auto' as const,
    paddingRight: '8px',
  },
  attachChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    maxWidth: '140px',
    boxSizing: 'border-box' as const,
    padding: '2px 6px',
    border: '1px solid #c8a400',
    borderRadius: '6px',
    background: 'transparent',
    fontSize: '11px',
    height: '22px',
  },
  attachChipName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  attachChipRemove: {
    flexShrink: 0,
    cursor: 'pointer',
    fontSize: '11px',
    lineHeight: 1,
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
  deleteBtn: {
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
  usageName: { marginBottom: '2px', color: 'var(--vscode-foreground)' },
  usageCostLine: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: '2px' },
  usageTotal: { fontVariantNumeric: 'tabular-nums' },
  usageDetail: { opacity: 0.8 },
  compactBtn: {
    marginLeft: '8px',
    background: 'transparent',
    color: 'var(--vscode-textLink-foreground)',
    border: '1px solid var(--vscode-textLink-foreground)',
    borderRadius: '2px',
    padding: '1px 8px',
    cursor: 'pointer',
    fontSize: '10px',
    flexShrink: 0,
  },
  compactBtnDisabled: {
    marginLeft: '8px',
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '2px',
    padding: '1px 8px',
    cursor: 'default',
    fontSize: '10px',
    opacity: 0.6,
    flexShrink: 0,
  },
  modeControls: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
    marginTop: '6px',
    marginBottom: '8px',
  },
  // Toggle cell — the flex item that shares the row evenly, holding the button
  // (which fills it) plus the trailing ⓘ marker.
  modeBtnWrap: {
    flex: 1,
    minWidth: '150px',
    display: 'flex',
    alignItems: 'center',
    // Fixed gap between the button and its trailing ⓘ marker (the button no
    // longer stretches, so this is the actual visible spacing).
    gap: '1px',
  },
  modeBtn: {
    // Size to content so the ⓘ sits a fixed gap away instead of being pushed
    // to the far edge of the (stretched) cell.
    minWidth: 0,
    padding: '4px 8px',
    fontSize: '14px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    background: 'var(--vscode-button-secondaryBackground, var(--vscode-button-background))',
    color: 'var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))',
  },
  // Greyed-out look applied when a toggle is disabled — most notably when Edit/
  // Command Control are auto-locked to their forced posture under Autonomous —
  // so the user gets a visual cue that the state is fixed and not clickable.
  modeBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed' as const,
  },
  // The ⓘ marker, rendered one step larger than the button text (+2px) and
  // dimmed; it is the sole tooltip trigger for each toggle.
  modeInfo: {
    fontSize: '16px',
    lineHeight: 1,
    cursor: 'help',
    opacity: 0.7,
    flex: 'none' as const,
  },
  // Tooltip wrapper — wraps only the ⓘ marker, anchoring its bubble.
  tooltipWrap: {
    position: 'relative' as const,
    display: 'inline-flex',
  },
  tooltipBox: {
    position: 'absolute' as const,
    bottom: 'calc(100% + 6px)',
    right: 0,
    width: '230px',
    maxWidth: '90vw',
    padding: '6px 9px',
    fontSize: '12px',
    lineHeight: 1.4,
    whiteSpace: 'normal' as const,
    textAlign: 'left' as const,
    background: 'var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background))',
    color: 'var(--vscode-editorHoverWidget-foreground, var(--vscode-editorWidget-foreground))',
    border: '1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border))',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
    zIndex: 1000,
    pointerEvents: 'none' as const,
  },
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
    // Shrink-to-fit chat bubble pinned to the right edge (marginLeft:auto), so
    // it no longer spans the full WebView width and grows with its content
    // (including any attached-file chips below the text).
    background: 'var(--vscode-input-background)',
    // Yellow-ish accent matching the active prompt edit box / attach-file chips.
    border: '1px solid #c8a400',
    borderRadius: '6px',
    padding: '12px 20px',
    marginTop: '40px',
    marginBottom: '40px',
    marginLeft: 'auto',
    width: 'fit-content',
    maxWidth: '85%',
    boxSizing: 'border-box' as const,
    color: 'var(--vscode-input-foreground)',
    // Match the agent-response font (inherited editor font), one notch larger.
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 'calc(var(--vscode-editor-font-size, 13px) + 2px)',
    textAlign: 'right',
  },
  userPromptText: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  userPromptAttachments: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    justifyContent: 'flex-end',
    marginTop: '8px',
  },
  sentAttachChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    maxWidth: '160px',
    boxSizing: 'border-box' as const,
    padding: '2px 8px',
    border: '1px solid #c8a400',
    borderRadius: '6px',
    background: 'transparent',
    fontSize: '11px',
    height: '22px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  sentAttachIcon: {
    flexShrink: 0,
    fontSize: '11px',
    lineHeight: 1,
  },
  agentTokens: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  mdRoot: {
    whiteSpace: 'normal' as const,
    wordBreak: 'break-word' as const,
    lineHeight: 1.5,
  },
  mdP: {
    margin: '0.4em 0',
  },
  mdHeadingBase: {
    fontWeight: 600,
    lineHeight: 1.3,
    margin: '0.6em 0 0.3em',
  },
  mdBold: {
    fontWeight: 600,
  },
  mdCode: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: '0.9em',
    background: 'var(--vscode-textCodeBlock-background, rgba(127,127,127,0.18))',
    padding: '0.1em 0.3em',
    borderRadius: '3px',
  },
  mdPre: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: '0.9em',
    background: 'var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12))',
    padding: '8px 10px',
    borderRadius: '4px',
    overflowX: 'auto' as const,
    margin: '0.5em 0',
    whiteSpace: 'pre' as const,
  },
  mdUl: {
    margin: '0.3em 0',
    paddingLeft: '1.4em',
  },
  mdOl: {
    margin: '0.3em 0',
    paddingLeft: '1.4em',
  },
  mdLi: {
    margin: '0.15em 0',
  },
  mdQuote: {
    borderLeft: '3px solid var(--vscode-textBlockQuote-border, rgba(127,127,127,0.4))',
    margin: '0.5em 0',
    padding: '0.2em 0 0.2em 0.8em',
    color: 'var(--vscode-descriptionForeground)',
  },
  mdHr: {
    border: 'none',
    borderTop: '1px solid var(--vscode-panel-border, rgba(127,127,127,0.3))',
    margin: '0.8em 0',
  },
  mdLink: {
    color: 'var(--vscode-textLink-foreground)',
    textDecoration: 'underline' as const,
  },
  kodoBody: {
    flex: 1,
    minWidth: 0,
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
  toolgenName: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 5px',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 'bold' as const,
    fontStyle: 'normal' as const,
  },
  toolgenMeta: {
    fontVariantNumeric: 'tabular-nums' as const,
    opacity: 0.8,
    marginTop: '2px',
    fontSize: '11px',
  },
  toolgenDone: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    fontStyle: 'italic',
    marginTop: '4px',
    marginBottom: '2px',
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
  toolCallOk: {
    color: 'var(--vscode-charts-green, var(--vscode-testing-iconPassed, #3fb950))',
    fontWeight: 'bold' as const,
  },
  toolCallFail: {
    color: 'var(--vscode-charts-red, var(--vscode-testing-iconFailed, #f85149))',
    fontWeight: 'bold' as const,
  },
  toolCallDesc: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
  },
  runCommandProgress: {
    fontSize: '11px',
    fontFamily: 'monospace',
    color: 'var(--vscode-descriptionForeground)',
    marginLeft: '4px',
    marginTop: '2px',
    marginBottom: '4px',
    whiteSpace: 'pre' as const,
  },
  runCommandBar: {
    color: 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))',
  },
  toolCallBox: {
    border: '1px solid var(--vscode-widget-border, rgba(128,128,128,0.25))',
    borderRadius: '6px',
    padding: '4px 8px',
    marginTop: '3px',
    marginBottom: '4px',
    marginLeft: '4px',
    background: 'var(--vscode-editorWidget-background, var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08)))',
  },
  toolCallBoxClickable: {
    cursor: 'pointer',
  },
  diffLinkBox: {
    color: 'var(--vscode-textLink-foreground)',
    fontSize: '12px',
  },
  toolCallWarn: {
    color: 'var(--vscode-editorWarning-foreground, #cca700)',
    fontSize: '11px',
    marginBottom: '4px',
  },
  toolCallTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '11px',
  },
  toolCallParamName: {
    verticalAlign: 'top' as const,
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    color: 'var(--vscode-descriptionForeground)',
    padding: '1px 8px 1px 0',
    whiteSpace: 'nowrap' as const,
    width: '1%',
  },
  toolCallParamValue: {
    verticalAlign: 'top' as const,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    padding: '1px 0',
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
  // Sub-agent takeover dividers
  subsessionDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: '10px 0',
  },
  subsessionDividerLine: {
    flex: 1,
    height: '1px',
    background: 'var(--vscode-panel-border)',
  },
  subsessionDividerLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase' as const,
    color: 'var(--vscode-descriptionForeground)',
    whiteSpace: 'nowrap' as const,
  },
  // Sub-agent task brief — the structured task handed to a spawned sub-agent.
  // Left-aligned card, deliberately distinct from the user's prompt bubble.
  subagentTask: {
    alignSelf: 'flex-start' as const,
    maxWidth: '85%',
    margin: '2px 0 8px',
    padding: '6px 10px',
    borderLeft: '3px solid var(--vscode-panel-border)',
    background: 'var(--vscode-textBlockQuote-background)',
    borderRadius: '4px',
  },
  subagentTaskLabel: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '4px',
  },
  subagentTaskText: {
    whiteSpace: 'pre-wrap' as const,
    fontSize: '12px',
    color: 'var(--vscode-foreground)',
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
