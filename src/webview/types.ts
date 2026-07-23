// Shared data, state, and action types for the Kōdo WebView.
import type { ThinkingFamily } from '../llm-registry-types';

/** Edit Control posture the Edit toggle cycles through. `smart` is the default. */
export type EditControl = 'review_all' | 'allow_all' | 'smart';
/** Tool Control posture the Tool Control toggle cycles through. `smart` is the default. */
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

/** One question in an ask_user batch. `options` are plain answer strings, the
 *  agent's top choice first; the UI always appends a free-text option itself.
 *  An empty `options` list means free-text-only (escalate_blocker's prompt). */
export interface AskUserQuestion {
  question: string;
  kind: 'single_choice' | 'multi_choice';
  options: string[];
}

/** The user's confirmed answer to one question: the selected option texts
 *  (verbatim) plus their free-text entry, or null when it wasn't used. */
export interface AskUserAnswer {
  selected: string[];
  free_text: string | null;
}

/** The outstanding prompt.question request (live, interactive). `toolCallId`
 *  correlates it with the persisted `ask_user` feed entry rebuilt from history. */
export interface QuestionData {
  requestId: string;
  toolCallId: string;
  questions: AskUserQuestion[];
}

/** One customer-visible parameter row shown in a permission prompt. */
export interface PermissionParamRow {
  name: string;
  value: string;
}

/** The generalized `(executable, subcommand)` shape a permission prompt may
 *  offer to permanently allow (doc/SECURITY_RULES_PLAN.md §2.2) — e.g.
 *  `{executable: 'git', subcommand: 'push'}` for `git push origin main`. A
 *  blank `subcommand` ("") means the executable alone is the shape. */
export interface RuleOffer {
  executable: string;
  subcommand: string;
}

/** One elementary command within a (possibly compound) `run_command` ask
 *  that still needs the user's attention (doc/SECURITY_RULES_PLAN.md §2.6).
 *  A simple, single-command ask carries exactly one; a pipeline/`&&`/`;`
 *  chain may carry several, each independently checkable. */
export interface PermissionPart {
  /** One user-facing sentence explaining why this part asks. */
  reason: string;
  /** The rule shape this part may be permanently allowed as, or `null` when
   *  this part isn't offer-eligible — the panel only shows this part's
   *  "always allow" checkboxes when set. */
  ruleOffer: RuleOffer | null;
}

/** The outstanding prompt.permission request — the security layer wants the
 *  user to allow or deny one gated tool call. Transient (never a session
 *  entry): once decided, the tool call's own card/result records the outcome. */
export interface PermissionData {
  requestId: string;
  /** The gated tool_use id (correlates with the tool_call feed entry). */
  toolCallId: string;
  toolName: string;
  externalName: string;
  /** The tool's SecurityImpact label ("High", …). */
  risk: string;
  /** The agent's declared intent ("" when the tool carries none). */
  intent: string;
  /** The security layer's one-sentence reason for asking — a summary when
   *  `parts.length > 1`. */
  reason: string;
  params: PermissionParamRow[];
  /** True when the gated call was salvaged from a malformed (plain-text) tool
   *  call the model emitted instead of a proper tool call. The panel renders a
   *  distinct "recovered" banner so the user reviews the inferred tool. */
  recovered: boolean;
  /** Every elementary command that still needs the user's attention, in
   *  command order (doc/SECURITY_RULES_PLAN.md §2.6) — empty for an
   *  ordinary Allow/Deny-only prompt with no offer. */
  parts: PermissionPart[];
}

/** The outstanding prompt.stuck_alert request — the stuck-agent watchdog
 *  (doc/STUCK_DETECTION.md) wants to know whether to nudge a stalled agent.
 *  Transient (never a session entry): once decided, an "unstick" produces its
 *  own agent_unstuck_nudge entry recording the outcome. */
export interface StuckAlertData {
  requestId: string;
  agentName: string;
  displayName: string;
  /** One-sentence, user-facing description per matched red flag. */
  reasons: string[];
}

/** `create_file` writes a brand-new file (no diff, just the proposed
 *  content); `edit_file` is a genuine modification of an existing one
 *  (rendered as a diff of old vs. new). */
export type FileReviewMode = 'new_file' | 'modification';

/** One note the user attached to a rejected review. A line-anchored note
 *  (`generalFeedback: false`) always targets the new/proposed content — the
 *  old/removed side of a diff is never selectable; a general note
 *  (`generalFeedback: true`, added via "+ Add feedback" with nothing
 *  selected) carries no line reference at all and applies to the file as a
 *  whole. */
export type FileReviewFeedbackEntry =
  | { generalFeedback: true; feedback: string }
  | { generalFeedback: false; lineFrom: number; lineTo: number; targetedCode: string; feedback: string };

/** The outstanding prompt.edit_review request — the Edit Control review gate
 *  (WS_PROTOCOL.md §6.5b) wants the user to approve or reject a
 *  create_file/edit_file call before it writes anything. Transient (never a
 *  session entry): once decided, the gated tool call's own card records the
 *  outcome. The host opens a companion read-only editor tab (the full
 *  content for a new file, a diff for a modification) alongside this panel —
 *  see session-controller.ts's `_openReviewTab`. */
export interface FileReviewData {
  requestId: string;
  /** The gated tool_use id (correlates with the tool_call feed entry). */
  toolCallId: string;
  toolName: string;
  /** The agent-supplied path, verbatim. */
  path: string;
  mode: FileReviewMode;
  /** Current file content; always "" for a new file. */
  oldContent: string;
  /** The proposed content. */
  newContent: string;
}

/** Live selection state pushed from the extension host while the review's
 *  companion tab has focus — drives the in-panel "Add feedback" button.
 *  Only a selection on the new/proposed side is ever reported; the host
 *  filters out the diff's old side entirely (see `handleActiveSelectionChanged`
 *  in session-controller.ts), so this type carries no old-vs-new flag. */
export interface FileReviewSelection {
  hasSelection: boolean;
  lineFrom: number;
  lineTo: number;
  targetedCode: string;
}

/** Drives the feedback composer modal in `FileReviewPanel`. `editingIndex`
 *  is null while composing a brand-new draft or the target draft's index
 *  when re-opened by clicking an existing feedback chip; `initialText` seeds
 *  the modal's textarea (empty for a new draft, the draft's current text for
 *  an edit). `generalFeedback: false` anchors the draft to the live
 *  selection at the time "+ Add feedback" was clicked; `generalFeedback:
 *  true` — clicked with nothing selected — carries no line reference, for a
 *  note that applies to the file as a whole. */
export type FileReviewComposerData =
  | { editingIndex: number | null; generalFeedback: true; initialText: string }
  | {
      editingIndex: number | null;
      generalFeedback: false;
      lineFrom: number;
      lineTo: number;
      targetedCode: string;
      initialText: string;
    };

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

/**
 * The mirror checkpoint commit a file-mutating tool call produced, backing its
 * undo/re-do and rollback/roll-forward controls. `root` names which per-root
 * `.kodo/checkpoints` mirror the `sha` belongs to.
 *
 * `index`/`currentIndex` are this checkpoint's and its root's positions in the
 * persisted, flat, chronological checkpoint list (`kodo.runtime._checkpoints.
 * CheckpointState`): `index <= currentIndex` means this entry is at or behind
 * the work tree's current state (eligible for undo/redo + "Rollback to this
 * state"); `index > currentIndex` means it's ahead (only "Roll forward to
 * this state" applies). `undone` toggles this entry's own link between
 * "undo this change" and "re-do this change". Both denormalized fields are
 * refreshed in lockstep across every entry sharing `root` whenever a
 * `checkpoint_state` event arrives (see reducer.ts).
 */
export interface CheckpointData {
  root: string;
  sha: string;
  parent: string;
  index: number;
  currentIndex: number;
  undone: boolean;
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
      /** Client clock (ms) when execution actually began (set on 'tool_call_in_progress',
       *  not at card creation, so the bar excludes any judging/permission wait); drives
       *  the progress bar. null until execution starts, and for history. */
      startedAt: number | null;
      /** Before/after file pair for this call (e.g. edit_file), or null if none was captured. */
      diff: DiffLinkData | null;
      /** Mirror checkpoint backing the undo/rollback controls, or null if this call made none. */
      checkpoint: CheckpointData | null;
      /** How long the model spent streaming this call's arguments (ms), shown as
       *  "Generated content for <tool> in Xs, …". null when unknown (history / no toolgen). */
      toolgenDurationMs: number | null;
      /** How many characters the model streamed for this call's arguments (the raw
       *  measure; the UI renders it as an approximate token count / tok/s via
       *  completionLabel). null when unknown. */
      toolgenChars: number | null;
      /** Live narration the `web_search` agent produced while researching (doc/WEB_SEARCH.md §6),
       *  in order. Drives the "Web Search is in progress"/"Web Search Completed" collapsible block;
       *  always [] for every other tool. Replayed from a best-effort sidecar file on reload — may be
       *  incomplete if the run was aborted mid-flight. */
      webSearchNotes: string[];
      exclude_from_context: false;
    }
  // An ask_user question batch rendered as a sequence of question boxes.
  // Interactive while `answers` is null AND the live pendingQuestion matches
  // this entry (by toolCallId); frozen (read-only, selections shown) once
  // answered. Rebuilt after reload purely from the persisted tool call +
  // result — the questions/answers here mirror the LLM-visible tool I/O.
  | { type: 'ask_user'; toolCallId: string; questions: AskUserQuestion[]; answers: AskUserAnswer[] | null; exclude_from_context: false }
  | { type: 'thinking_block'; content: string; durationMs: number | null; exclude_from_context: true }
  | { type: 'status_response'; durationMs: number; inputTokens: number; outputTokens: number; contextTokens: number; exclude_from_context: true }
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
  | { type: 'compaction_divider'; summaryExcerpt: string; summary: string; tokensBefore: number; tokensAfter: number; exclude_from_context: true }
  // Dropped into the feed when the user clicks Stop mid-turn. Display-only
  // marker (never sent to the LLM) — the actual cancellation already happened
  // server-side (see 'interrupted' action).
  | { type: 'interrupted'; exclude_from_context: true }
  // A runtime error surfaced from the server (EVT_ERROR) — e.g. an LLM API
  // failure that aborted the turn. Display-only; anchors the failure in the
  // feed so it is never silent. Persisted as an "error" marker in
  // session.jsonl and replayed via session_history on reload.
  | { type: 'error_notice'; message: string; recoverable: boolean; exclude_from_context: true }
  // The user's own record of a just-granted Phase 2 "always allow" security
  // rule (WS_PROTOCOL.md §5.9d) — distinct from the gated tool call's own
  // card. `offer` is the exact granted shape (same {executable, subcommand}
  // as a permission prompt's RuleOffer — subcommand holds a resolved
  // absolute path for a workspace-escape/path rule). Persisted as a
  // "security_rule_added" marker and replayed via session_history on reload.
  | { type: 'security_rule_added'; scope: 'session' | 'global'; offer: RuleOffer; exclude_from_context: true }
  // The stuck-agent watchdog's continuation nudge (doc/STUCK_DETECTION.md) —
  // a real user-role turn the agent responds to, but rendered as a distinct
  // notice (not a fake user-typed bubble), mirroring 'subagent_task'. `note`
  // is the user-facing explanation of what Kōdo observed; `reasons` are the
  // matched red-flag codes; `mode` is "auto" (autonomous/auto-unstuck) or
  // "manual" (the user clicked "Unstick it"). Persisted as an
  // "agent_unstuck_nudge"-kind message and replayed via session_history.
  | { type: 'agent_unstuck_nudge'; note: string; reasons: string[]; mode: string; exclude_from_context: true }
  // The stuck-agent watchdog gave up: an entry-agent turn stalled a second
  // consecutive time right after its one nudge, so the turn ended instead of
  // nudging (or asking) again. Display-only, like error_notice — rendered as
  // a <kodo_crit> callout. Persisted as an "agent_stuck_critical" marker and
  // replayed via session_history on reload.
  | { type: 'agent_stuck_critical'; message: string; exclude_from_context: true }
  // The mid-stream cyclic-thinking detector's strike-1 notice
  // (doc/STUCK_DETECTION.md §2.7): a thinking block degenerated into a
  // repetition loop and the stream was aborted before it could burn through
  // the rest of the budget. `message` is the same real, LLM-visible
  // course-correction turn the agent reads back next round — rendered here
  // as a <kodo_crit> callout, not a fake user-typed bubble, mirroring
  // 'agent_unstuck_nudge'. Persisted as a "cyclic_thinking_notice"-kind
  // message and replayed via session_history.
  | { type: 'cyclic_thinking_notice'; message: string; exclude_from_context: true }
  // Strike 2: the entry-agent's thinking hit a *second* detected repetition
  // loop right after the notice above, so the turn ended instead of trying
  // again. Display-only, mirroring 'agent_stuck_critical' — a distinct type
  // (not a reuse of that one) since the root cause and message differ.
  // Persisted as an "agent_cyclic_thinking_critical" marker and replayed via
  // session_history on reload.
  | { type: 'agent_cyclic_thinking_critical'; message: string; exclude_from_context: true };
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
  /** Outstanding security permission prompt, or null. Replaces the prompt
   *  input (like pendingGate) until the user allows or denies. */
  pendingPermission: PermissionData | null;
  /** Outstanding stuck-agent alarm, or null. Replaces the prompt input (like
   *  pendingGate) until the user unsticks the agent or dismisses it. */
  pendingStuckAlert: StuckAlertData | null;
  /** Outstanding create_file/edit_file review gate, or null. Replaces the
   *  prompt input (like pendingGate) until the user approves, rejects, or
   *  submits feedback. */
  pendingFileReview: FileReviewData | null;
  /** Live selection in the review's companion tab, pushed from the host;
   *  null until the first selection-change event for a pending review. */
  fileReviewSelection: FileReviewSelection | null;
  /** Draft feedback entries for the pending review, in the order added; not
   *  yet submitted. Cleared alongside pendingFileReview. */
  fileReviewDrafts: FileReviewFeedbackEntry[];
  /** Open feedback composer modal, or null when closed. Cleared alongside
   *  pendingFileReview. */
  fileReviewComposer: FileReviewComposerData | null;
  // The two *frozen* toggles are pairs: the user-facing *selected* value (flips
  // the instant the user clicks) and the per-turn frozen *effective* value the
  // server reports. While a turn runs and the two differ, the toggle is "queued
  // for the next prompt"; otherwise it is "in effect".
  autonomous: boolean;
  effectiveAutonomous: boolean;
  /** Per-session workflow mode; toggled in this tab's header. */
  workflowMode: 'guided' | 'problem_solving';
  effectiveWorkflowMode: 'guided' | 'problem_solving';
  // Edit/Tool Control are never frozen. The host owns them and sends the
  // *shown* value (forced to Allow All / Permissive while Autonomous is in
  // effect) plus `editCommandLocked`, which disables both toggles in the UI.
  editControl: EditControl;
  commandControl: CommandControl;
  editCommandLocked: boolean;
  // Thinking level is server-owned (doc/SESSIONS.md): the host adopts
  // whatever the server's `state` event reports verbatim, never computes it
  // client-side. `thinkingFamily`/`thinkingTiers` describe the session's
  // active *local* model's thinking mechanism (`null`/`[]` when on a cloud
  // model or a local model with none), letting the toggle compute the next
  // tier to request and render per-tier tooltips.
  thinkingLevel: string;
  thinkingFamily: ThinkingFamily | null;
  thinkingTiers: string[];
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
  | { type: 'tool_call_in_progress'; toolCallId: string }
  | { type: 'web_search_note'; toolCallId: string; text: string }
  | { type: 'tool_call_detail'; toolCallId: string; rows: ToolCallDetailRow[]; detailFile: string | null; schemaCompliance: boolean | null; success: boolean | null; diff: DiffLinkData | null; checkpoint: CheckpointData | null }
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
  | { type: 'question_request'; requestId: string; toolCallId: string; questions: AskUserQuestion[] }
  | { type: 'question_answered'; toolCallId: string; answers: AskUserAnswer[] }
  | { type: 'question_cleared' }
  | { type: 'permission_request'; requestId: string; toolCallId: string; toolName: string; externalName: string; risk: string; intent: string; reason: string; params: PermissionParamRow[]; recovered: boolean; parts: PermissionPart[] }
  | { type: 'permission_cleared' }
  | { type: 'stuck_alert_request'; requestId: string; agentName: string; displayName: string; reasons: string[] }
  | { type: 'stuck_alert_cleared' }
  | { type: 'file_review_request'; requestId: string; toolCallId: string; toolName: string; path: string; mode: FileReviewMode; oldContent: string; newContent: string }
  | { type: 'file_review_cleared' }
  | { type: 'file_review_selection'; hasSelection: boolean; lineFrom: number; lineTo: number; targetedCode: string }
  | { type: 'file_review_open_composer' }
  | { type: 'file_review_edit_draft'; index: number }
  | { type: 'file_review_close_composer' }
  | { type: 'file_review_apply_draft'; text: string }
  | { type: 'file_review_remove_draft'; index: number }
  | { type: 'agent_unstuck_nudge'; note: string; reasons: string[]; mode: string }
  | { type: 'agent_stuck_critical'; message: string }
  | { type: 'cyclic_thinking_notice'; message: string }
  | { type: 'agent_cyclic_thinking_critical'; message: string }
  | {
      type: 'mode_state';
      autonomous: boolean;
      effectiveAutonomous: boolean;
      workflowMode: 'guided' | 'problem_solving';
      effectiveWorkflowMode: 'guided' | 'problem_solving';
      editControl: EditControl;
      commandControl: CommandControl;
      editCommandLocked: boolean;
      thinkingLevel: string;
      thinkingFamily: ThinkingFamily | null;
      thinkingTiers: string[];
      running: boolean;
    }
  | { type: 'resume_offer'; sessionId: string }
  | { type: 'resume_dismissed' }
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
  | { type: 'session_history'; entries: Record<string, unknown>[]; subsessions: Record<string, Record<string, unknown>[]> }
  | { type: 'checkpoint_state'; root: string; currentIndex: number; entries: { sha: string; undone: boolean }[] }
  | { type: 'interrupted' }
  | { type: 'runtime_error'; message: string; recoverable: boolean }
  | { type: 'security_rule_added'; scope: 'session' | 'global'; offer: RuleOffer };
