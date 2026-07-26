/**
 * Shared types for the per-session controller and its delegate managers:
 * the Edit/Command/workflow control postures, the wire-shaped cache types
 * for each kind of pending prompt, and `SessionDeps` — the collaborators a
 * `SessionController` needs from its window-level host (`extension.ts`).
 */

import type * as vscode from 'vscode';
import type { Envelope } from '../envelope';
import type { ThinkingContext } from '../llm-registry-types';
import type { SessionController } from './controller';

/** Edit Control posture. `smart` is the default. */
export type EditControl = 'review_all' | 'allow_all' | 'smart';
/** Tool Control posture. `smart` is the default. */
export type CommandControl = 'defensive' | 'permissive' | 'smart';

/** Coerce an untyped wire value into a valid {@link EditControl} (default smart). */
export function coerceEditControl(value: unknown): EditControl {
  return value === 'review_all' || value === 'allow_all' ? value : 'smart';
}

/** Coerce an untyped wire value into a valid {@link CommandControl} (default smart). */
export function coerceCommandControl(value: unknown): CommandControl {
  return value === 'defensive' || value === 'permissive' ? value : 'smart';
}

/** The Edit/Command values forced while Autonomous mode is in effect. */
export const AUTONOMOUS_EDIT: EditControl = 'allow_all';
export const AUTONOMOUS_COMMAND: CommandControl = 'permissive';

/** The "Show Timestamps" flags (kodo-vsix-only, see settings-webview/GeneralSection.tsx's
 *  own copy of this shape and its doc comment on why it's duplicated rather
 *  than shared). */
export interface UiSettings {
  showTimestamps: boolean;
  timezone: string;
  clockFormat: string;
}

/** Coerce an untyped wire value into a workflow mode (default guided). */
export function coerceWorkflowMode(value: unknown): 'guided' | 'problem_solving' {
  return value === 'problem_solving' ? 'problem_solving' : 'guided';
}

/** Most attachments a prompt may carry (one per slot in the webview's area). */
export const MAX_ATTACHMENTS = 9;
/** Per-file and total-attachment text-content cap (128 KB). */
export const MAX_ATTACH_BYTES = 128 * 1024;

/**
 * A file staged for the next prompt. The host holds only display metadata and
 * the absolute path — the file's *content* is never read into the extension nor
 * shipped over the wire. On submit the path rides a control tag in the prompt
 * (see `AttachmentManager.composePrompt`); the server reads, validates, copies,
 * and injects the file. `size` is kept solely for the local running-total
 * pre-check that gives the user immediate feedback before the server's
 * authoritative gate.
 */
export interface AttachedFile {
  name: string;
  /** Absolute path on disk; used to build the attachment control tag. */
  path: string;
  size: number;
}

export interface LastCallTokens {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface UsageSummary {
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
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

export interface AskUserQuestion {
  question: string;
  kind: string;
  options: string[];
}

export interface QuestionData {
  requestId: string;
  /** The ask_user tool_use id backing this batch; correlates the interactive
   *  panel with the persisted feed entry. Empty for legacy frames. */
  toolCallId: string;
  questions: AskUserQuestion[];
}

/** One elementary command within a (possibly compound) `run_command` ask
 *  that still needs the user's attention (doc/SECURITY_RULES_PLAN.md §2.6). */
export interface PermissionPart {
  reason: string;
  /** The `(executable, subcommand)` shape this part may be permanently
   *  allowed as, or `null` when not offer-eligible — drives this part's
   *  "always allow" checkboxes. */
  ruleOffer: { executable: string; subcommand: string } | null;
}

/** The outstanding `prompt.permission` request — the security layer wants an
 *  allow/deny for one gated tool call (WS_PROTOCOL.md §6.5). */
export interface PermissionData {
  requestId: string;
  toolCallId: string;
  toolName: string;
  externalName: string;
  risk: string;
  intent: string;
  reason: string;
  params: { name: string; value: string }[];
  /** True when the gated call was salvaged from a malformed (plain-text) tool
   *  call — the panel shows a distinct "recovered" banner. */
  recovered: boolean;
  /** Every elementary command that still needs attention, in command order
   *  (doc/SECURITY_RULES_PLAN.md §2.6) — empty for an ordinary Allow/Deny-only
   *  prompt with no offer. */
  parts: PermissionPart[];
}

/** The outstanding `prompt.stuck_alert` request — the stuck-agent watchdog
 *  (doc/STUCK_DETECTION.md) wants to know whether to nudge a stalled agent. */
export interface StuckAlertData {
  requestId: string;
  agentName: string;
  displayName: string;
  /** One-sentence, user-facing description per matched red flag. */
  reasons: string[];
}

/** The outstanding `prompt.edit_review` request — the Edit Control review
 *  gate (WS_PROTOCOL.md §6.5b) wants an approve/reject/feedback decision for
 *  one create_file/edit_file call before it writes anything. */
export interface FileReviewData {
  requestId: string;
  toolCallId: string;
  toolName: string;
  path: string;
  mode: 'new_file' | 'modification';
  oldContent: string;
  newContent: string;
}

/** Collaborators the controller needs from the window-level host. */
export interface SessionDeps {
  context: vscode.ExtensionContext;
  windowId: string;
  wsUrl: string;
  getPhysicalRoot: () => string;
  getProjectRoot: () => string;
  hasWorkspace: () => boolean;
  buildFolderMap: () => Record<string, string>;
  /**
   * Absolute path of the `.code-workspace` file the window was opened from,
   * or `undefined` for a plain folder workspace — including VS Code's own
   * in-memory `untitled:` multi-root workspace, which has no file on disk a
   * future session could reopen. Pushed alongside `workspace.folders` so the
   * server can remember it for session-resume (WS_PROTOCOL.md).
   */
  getCodeWorkspaceFile: () => string | undefined;
  /**
   * Add a server-scaffolded project directory to the open workspace (the
   * `create_new_project` tool). The path already exists on disk; this only
   * registers it as a VS Code workspace folder (no-op if already present).
   */
  addWorkspaceFolder: (folderPath: string, name: string) => void;
  /**
   * Reload the current window into `sessionId`'s own remembered workspace
   * (the manual reconnect-workspace button's mechanism, doc/WS_PROTOCOL.md
   * §7.1b) — reuses the same reload/continuity plumbing as resuming a
   * mismatched session from the picker.
   */
  reconnectWorkspace: (sessionId: string) => Promise<void>;
  /** Shared SecretStorage-backed API-key prompt; replies on this session's WS. */
  handleApiKeyRequest: (vendor: string, requestId: string, send: (env: Envelope) => void) => void;
  /**
   * Native folder-picker dialog for `create_new_project`'s interactive
   * bootstrap path (no project/workspace bound yet, session not autonomous);
   * replies on this session's WS.
   */
  chooseProjectFolder: (requestId: string, send: (env: Envelope) => void) => void;
  /** Forget whichever key is currently active for `vendor` (server-initiated revoke). */
  revokeApiKey: (vendor: string) => void;
  /** Called once the server assigns/confirms this session's id. */
  onSessionAssigned: (c: SessionController, sessionId: string) => void;
  /**
   * The current thinking-tier context: which family (if any) the session's
   * active *local* model belongs to, and its tiers/default. The active
   * model is a machine-global selection, not per-session, so the host
   * supplies this fresh (read at construction, then pushed on every change
   * via {@link SessionController.updateThinkingContext}).
   */
  getThinkingContext: () => ThinkingContext;
  /**
   * Current "Show Timestamps" flags, read fresh from
   * `~/.kodo/etc/ui-settings.json` (extension.ts's `_readUiSettings`) at
   * construction, then re-pushed to this tab whenever they change via
   * {@link SessionController.updateUiSettings}.
   */
  getUiSettings: () => UiSettings;
  /**
   * Forward a window-global `llama.state` event to the host. llama.cpp is
   * auto-started inside an engine run, so the event arrives on THIS session's
   * socket (not the session-less control connection); the host owns the sidebar
   * mirror + "starting…" progress notification.
   */
  onLlamaState: (payload: Record<string, unknown>) => void;
  /** Called when the panel is disposed (user closed the tab, or reload). */
  onClosed: (c: SessionController) => void;
  /** True while the extension host is deactivating (window reload/close). */
  isDeactivating: () => boolean;
}
