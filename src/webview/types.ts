// Shared data, state, and action types for the Kōdo WebView.
/** Edit Control posture the Edit toggle cycles through. `smart` is the default. */
export type EditControl = 'review_all' | 'allow_all' | 'smart';
/** Command Control posture the Command toggle cycles through. `smart` is the default. */
export type CommandControl = 'defensive' | 'permissive' | 'smart';

/** Coerce an untyped wire value into a valid {@link EditControl} (default smart). */
export function coerceEditControl(value: unknown): EditControl {
  return value === 'review_all' || value === 'allow_all' ? value : 'smart';
}

/** Coerce an untyped wire value into a valid {@link CommandControl} (default smart). */
export function coerceCommandControl(value: unknown): CommandControl {
  return value === 'defensive' || value === 'permissive' ? value : 'smart';
}

export interface LastCallTokens {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface FileEventData {
  path: string;
  kind: string;
}

export interface GateData {
  gateId: string;
  gateType: string;
  summary: string;
  artifactPath: string | null;
}

export interface QuestionChoice {
  key: string;
  label: string;
}

export interface QuestionData {
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
export interface ToolCallDetailRow {
  name: string;
  value: string;
  source: 'input' | 'output';
  visibility: 'always' | 'visible';
}

/** A before/after file pair backing a tool call's "view diff" link. */
export interface DiffLinkData {
  label: string;
  prevPath: string;
  newPath: string;
}

export type SessionEntry =
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
  // `failed` is set on the 'end' divider when the sub-agent did not produce a
  // valid result (drives the red <kodo_crit> callout instead of green <kodo>).
  | { type: 'subsession_divider'; phase: 'start' | 'end'; displayName: string; parentDisplayName: string; failed?: boolean; exclude_from_context: true }
  // The structured task brief the engine handed a sub-agent on spawn. Rendered as
  // a distinct card (NOT the user's prompt bubble) even though it rides a user turn.
  | { type: 'subagent_task'; content: string; exclude_from_context: true }
  // Context-compaction divider: marks where the prior conversation was summarised
  // and the live LLM context reset. Everything above stays visible as history.
  | { type: 'compaction_divider'; summaryExcerpt: string; summary: string; tokensBefore: number; tokensAfter: number; exclude_from_context: true };
export interface State {
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
export interface ContextStats {
  currentTokens: number;
  limitTokens: number;
  percent: number;
  canCompact: boolean;
}

/** One staged attachment chip (id assigned by the host on validation). */
export interface AttachedFile {
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
export interface AttachedFileRef {
  name: string;
  path: string;
}

export type Action =
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
  | { type: 'subsession_ended'; displayName: string; parentDisplayName: string; failed: boolean }
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
