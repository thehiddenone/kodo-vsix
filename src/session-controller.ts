/**
 * SessionController — one Kōdo session bound to one WebView panel (a native VS
 * Code editor tab) and its own WebSocket connection to the singleton server.
 *
 * A VS Code window hosts many of these at once. Each owns:
 *   - a `WebviewPanel` (the visible tab),
 *   - a dedicated `WsClient` (one session == one connection, so the server
 *     detects this session's disconnect via the socket closing, exactly as
 *     before — see SessionManager.drop_connection),
 *   - the per-session UI state cache that rehydrates the webview on 'ready'.
 *
 * Window-global concerns (llama/model management, the cloud/local radio, the
 * session picker) live in extension.ts on a separate session-less *control*
 * connection; they are NOT handled here.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest, makeResponse } from './envelope';
import type { Envelope } from './envelope';
import { WsClient } from './ws-client';

const TOKEN_BUFFER_MAX = 64 * 1024;

/** Edit Control posture. `smart` is the default. */
type EditControl = 'review_all' | 'allow_all' | 'smart';
/** Command Control posture. `smart` is the default. */
type CommandControl = 'defensive' | 'permissive' | 'smart';

/** Coerce an untyped wire value into a valid {@link EditControl} (default smart). */
function coerceEditControl(value: unknown): EditControl {
  return value === 'review_all' || value === 'allow_all' ? value : 'smart';
}

/** Coerce an untyped wire value into a valid {@link CommandControl} (default smart). */
function coerceCommandControl(value: unknown): CommandControl {
  return value === 'defensive' || value === 'permissive' ? value : 'smart';
}

/** The Edit/Command values forced while Autonomous mode is in effect. */
const _AUTONOMOUS_EDIT: EditControl = 'allow_all';
const _AUTONOMOUS_COMMAND: CommandControl = 'permissive';

/** Coerce an untyped wire value into a workflow mode (default guided). */
function coerceWorkflowMode(value: unknown): 'guided' | 'problem_solving' {
  return value === 'problem_solving' ? 'problem_solving' : 'guided';
}

/** Most attachments a prompt may carry (one per slot in the webview's area). */
const MAX_ATTACHMENTS = 9;
/** Per-file and total-attachment text-content cap (128 KB). */
const MAX_ATTACH_BYTES = 128 * 1024;

/**
 * A file staged for the next prompt. The host holds only display metadata and
 * the absolute path — the file's *content* is never read into the extension nor
 * shipped over the wire. On submit the path rides a control tag in the prompt
 * (see {@link _composePrompt}); the server reads, validates, copies, and injects
 * the file. `size` is kept solely for the local running-total pre-check that
 * gives the user immediate feedback before the server's authoritative gate.
 */
interface AttachedFile {
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

interface UsageSummary {
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
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

/** Collaborators the controller needs from the window-level host. */
export interface SessionDeps {
  context: vscode.ExtensionContext;
  windowId: string;
  wsUrl: string;
  getPhysicalRoot: () => string;
  getProjectRoot: () => string;
  hasWorkspace: () => boolean;
  buildFolderMap: () => Record<string, string>;
  /** Guided project picker (returns {root,name} or null if cancelled). */
  pickProject: () => Promise<{ root: string; name: string } | null>;
  /** Shared SecretStorage-backed API-key prompt; replies on this session's WS. */
  handleApiKeyRequest: (vendor: string, requestId: string, send: (env: Envelope) => void) => void;
  /** Called once the server assigns/confirms this session's id. */
  onSessionAssigned: (c: SessionController, sessionId: string) => void;
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

let _keySeq = 0;

export class SessionController {
  readonly key: string;
  /** Server-assigned session id; '' until the first hello.ack. */
  sessionId = '';
  /** True when opened blank (no id) → apply new-session defaults on hello.ack. */
  private readonly isNewSession: boolean;

  private readonly panel: vscode.WebviewPanel;
  private readonly ws: WsClient;
  private connected = false;
  private disposed = false;
  /** True between sending `session.delete` and the socket closing (success). */
  private deleting = false;
  /** Resolves the "Deleting this session…" progress notification early on error. */
  private resolveDeleteProgress: (() => void) | null = null;

  // Per-session UI cache (rehydrates the webview on 'ready').
  private stage = 'IDLE';
  private agent: string | null = null;
  private tokens = '';
  private lastPrompt = '';
  private usage: UsageSummary = { cumulativeUsd: 0, lastCallTokens: null };
  /** Latest context gauge for the header (current/limit/percent + compactability). */
  private contextStats: { currentTokens: number; limitTokens: number; percent: number; canCompact: boolean } | null = null;
  /** True while a compaction run is in flight (drives the "Compacting…" banner). */
  private compacting = false;
  private fileEvents: FileEventData[] = [];
  private pendingGate: GateData | null = null;
  private pendingQuestion: QuestionData | null = null;
  private sessionHistory: Record<string, unknown>[] | null = null;
  private sessionName = '';
  // The two *frozen* toggles come in pairs: the user-facing *selected* value
  // (flips the instant the user clicks) and the per-turn frozen *effective*
  // value the server reports (what the in-flight prompt actually runs under).
  // The webview uses the pair to show "in effect" vs "queued for the next
  // prompt".
  private autonomous = false;
  private effectiveAutonomous = false;
  private workflowMode: 'guided' | 'problem_solving' = 'problem_solving';
  private effectiveWorkflowMode: 'guided' | 'problem_solving' = 'problem_solving';
  // Edit/Command Control are NEVER frozen. The host owns them: it keeps the
  // user's *selected* posture, and derives the *shown* value — which equals the
  // selection unless Autonomous mode is currently in effect, in which case it is
  // forced to Allow All / Permissive (the toggles also lock in the UI). `running`
  // (derived from the server's `phase`) decides whether "in effect" means the
  // frozen `effectiveAutonomous` (mid-turn) or the selected `autonomous` (idle),
  // so a switch to Autonomous only locks them once the next turn actually starts.
  private editControl: EditControl = 'smart';
  private commandControl: CommandControl = 'smart';
  private running = false;
  // The last shown values pushed to the server, so we resend only on change
  // (`undefined` until the first sync forces an initial send).
  private sentEditControl: EditControl | undefined;
  private sentCommandControl: CommandControl | undefined;
  private currentProject: { root: string; name: string } | null = null;
  private resumeSessionId: string | null = null;
  /** Validated files staged to be prepended to the next prompt, keyed by chip id. */
  private readonly attachedFiles = new Map<string, AttachedFile>();
  private _attachSeq = 0;

  constructor(
    private readonly deps: SessionDeps,
    panel: vscode.WebviewPanel,
    sessionId: string,
  ) {
    this.key = `session-${++_keySeq}`;
    this.sessionId = sessionId;
    this.isNewSession = sessionId === '';
    this.panel = panel;

    panel.iconPath = vscode.Uri.file(
      path.join(deps.context.extensionPath, 'images', 'kodo16px.svg'),
    );
    const webviewJsUri = panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(deps.context.extensionPath, 'dist', 'webview.js')),
    );
    panel.webview.html = buildHtml(webviewJsUri, generateNonce());
    panel.webview.onDidReceiveMessage((msg: Record<string, unknown>) => this._onWebviewMessage(msg));
    panel.onDidDispose(() => this._onDispose());

    this.ws = new WsClient(
      deps.wsUrl,
      (env) => this._onEnvelope(env),
      (connected) => this._onStatus(connected),
    );
    this.ws.connect();
  }

  /** Bring this session's tab to the foreground. */
  reveal(): void {
    this.panel.reveal();
  }

  // ------------------------------------------------------------------
  // Connection lifecycle
  // ------------------------------------------------------------------

  private _onStatus(connected: boolean): void {
    this.connected = connected;
    this._post({ type: 'status', connected });
    if (connected) {
      this._sendHello();
    } else if (this.deleting) {
      // The server closed the socket after deleting the session → success.
      // Close the tab (the progress notification clears as the panel disposes).
      this.panel.dispose();
    }
  }

  private _sendHello(): void {
    const payload: Record<string, unknown> = {
      client: 'vsix',
      version: '0.2.0',
      window_id: this.deps.windowId,
    };
    if (this.sessionId) {
      payload.session_id = this.sessionId;
    }
    this._sendStamped(makeRequest('hello', payload));
  }

  /**
   * Whether Autonomous mode is currently *in effect* (not merely selected).
   * While a turn runs this is the frozen `effectiveAutonomous`; when idle it is
   * the live `autonomous` selection, so a mid-turn switch to Autonomous defers
   * its lock until the next turn starts, and a switch to Interactive unlocks
   * only once the running turn finishes.
   */
  private _autonomousInEffect(): boolean {
    return this.running ? this.effectiveAutonomous : this.autonomous;
  }

  /** Edit Control value the UI shows — forced to Allow All under Autonomous. */
  private _editShown(): EditControl {
    return this._autonomousInEffect() ? _AUTONOMOUS_EDIT : this.editControl;
  }

  /** Command Control value the UI shows — forced to Permissive under Autonomous. */
  private _commandShown(): CommandControl {
    return this._autonomousInEffect() ? _AUTONOMOUS_COMMAND : this.commandControl;
  }

  /**
   * Mirror the shown Edit/Command values to the server, resending only on a
   * change. The server stores exactly what the UI shows (the host is the single
   * source of truth for these never-frozen toggles), so this is called whenever
   * a shown value can move: a user flip, an autonomous toggle, a phase change.
   */
  private _syncEditCommandToServer(): void {
    const edit = this._editShown();
    if (edit !== this.sentEditControl) {
      this.sentEditControl = edit;
      this._sendStamped(makeRequest('edit_control.set', { edit_control: edit }));
    }
    const command = this._commandShown();
    if (command !== this.sentCommandControl) {
      this.sentCommandControl = command;
      this._sendStamped(makeRequest('command_control.set', { command_control: command }));
    }
  }

  /**
   * Push the full mode-toggle snapshot to the webview. The two frozen toggles
   * carry their selected + effective pair; Edit/Command carry the single shown
   * value plus `editCommandLocked` (true while Autonomous is in effect, which
   * disables those two toggles). `running` lets the frozen toggles render "in
   * effect" vs "queued for the next prompt".
   */
  private _postModeState(): void {
    this._post({
      type: 'mode_state',
      autonomous: this.autonomous,
      effectiveAutonomous: this.effectiveAutonomous,
      workflowMode: this.workflowMode,
      effectiveWorkflowMode: this.effectiveWorkflowMode,
      editControl: this._editShown(),
      commandControl: this._commandShown(),
      editCommandLocked: this._autonomousInEffect(),
      running: this.running,
    });
  }

  /**
   * Stamp this session's id onto every request except `hello`, so the singleton
   * server routes the frame to this session's engine.
   */
  private _sendStamped(env: Envelope): void {
    if (env.kind === 'request' && env.payload.type !== 'hello') {
      env.payload.session_id = this.sessionId;
    }
    this.ws.send(env);
  }

  private _post(msg: Record<string, unknown>): void {
    void this.panel.webview.postMessage(msg);
  }

  // ------------------------------------------------------------------
  // Tab close → release the session (free for any window) — but NOT on a
  // window reload, where the serializer restores the tab and grace lets it
  // reclaim/resume from disk.
  // ------------------------------------------------------------------

  private _onDispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.resolveDeleteProgress) {
      this.resolveDeleteProgress();
      this.resolveDeleteProgress = null;
    }
    if (!this.deps.isDeactivating() && this.sessionId && !this.deleting) {
      // Explicit user close: free immediately (skip the disconnect grace).
      // (When deleting, the session is already gone — no release needed.)
      this._sendStamped(makeRequest('session.release', { session_id: this.sessionId }));
    }
    this.ws.dispose();
    this.deps.onClosed(this);
  }

  /** Tear down without releasing (window reload / extension deactivate). */
  dispose(): void {
    this.disposed = true;
    this.ws.dispose();
  }

  // ------------------------------------------------------------------
  // WebView → controller
  // ------------------------------------------------------------------

  private _onWebviewMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'ready':
        this._rehydrate();
        break;
      case 'ping':
        this._sendStamped(makeRequest('ping'));
        break;
      case 'prompt': {
        const text = String(msg.text ?? '').trim();
        if (text) {
          void this._submitPrompt(text);
        }
        break;
      }
      case 'approval_respond':
        this._sendStamped(
          makeResponse(String(msg.gateId ?? ''), {
            type: 'prompt.approval.response',
            action: String(msg.action ?? 'agree'),
            feedback_text: String(msg.feedback ?? '') || null,
          }),
        );
        this.pendingGate = null;
        break;
      case 'question_respond': {
        const payload: Record<string, unknown> = { type: 'prompt.question.response' };
        if (String(msg.mode ?? 'free_text') === 'choice') {
          payload.choice_key = String(msg.choiceKey ?? '');
        } else {
          payload.answer_text = String(msg.answerText ?? '');
        }
        this._sendStamped(makeResponse(String(msg.requestId ?? ''), payload));
        this.pendingQuestion = null;
        break;
      }
      case 'stop':
        this._sendStamped(makeRequest('stop', {}));
        break;
      case 'compact_now':
        this._sendStamped(makeRequest('compact.now', {}));
        break;
      case 'delete_session':
        void this._confirmAndDelete();
        break;
      case 'attach_file':
        void this._attachFiles();
        break;
      case 'remove_attachment':
        this.attachedFiles.delete(String(msg.id ?? ''));
        break;
      case 'mode_set': {
        const autonomous = Boolean(msg.autonomous);
        this.autonomous = autonomous;
        this._sendStamped(makeRequest('mode.set', { autonomous }));
        // A switch while idle locks/unlocks Edit & Command immediately; while a
        // turn runs the shown values stay put (gated on `effectiveAutonomous`).
        this._syncEditCommandToServer();
        this._postModeState();
        break;
      }
      case 'workflow_set': {
        const mode = coerceWorkflowMode(msg.mode);
        this.workflowMode = mode;
        this._sendStamped(makeRequest('workflow.set', { mode }));
        this._postModeState();
        break;
      }
      case 'edit_control_set': {
        // Only reachable while unlocked (the webview disables the toggle under
        // Autonomous), so the click always sets the user's selection.
        if (!this._autonomousInEffect()) {
          this.editControl = coerceEditControl(msg.editControl);
          this._syncEditCommandToServer();
          this._postModeState();
        }
        break;
      }
      case 'command_control_set': {
        if (!this._autonomousInEffect()) {
          this.commandControl = coerceCommandControl(msg.commandControl);
          this._syncEditCommandToServer();
          this._postModeState();
        }
        break;
      }
      case 'open_file': {
        const filePath = String(msg.path ?? '');
        const projectRoot = this.deps.getProjectRoot();
        if (filePath && (path.isAbsolute(filePath) || projectRoot)) {
          const resolved = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
          void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolved)).then(
            () => undefined,
            (err: unknown) => vscode.window.showErrorMessage(`Kōdo: Cannot open file — ${String(err)}`),
          );
        }
        break;
      }
      case 'open_diff': {
        const prevPath = String(msg.prevPath ?? '');
        const newPath = String(msg.newPath ?? '');
        if (prevPath && newPath) {
          void vscode.commands
            .executeCommand('vscode.diff', vscode.Uri.file(prevPath), vscode.Uri.file(newPath), String(msg.label ?? ''))
            .then(
              () => undefined,
              (err: unknown) => vscode.window.showErrorMessage(`Kōdo: Cannot open diff — ${String(err)}`),
            );
        }
        break;
      }
    }
  }

  /**
   * Submit a prompt. In Guided mode with no project locked yet, force the
   * project picker first and bind it on the server before sending (WS frames
   * are processed in order, so the bind completes before the prompt dequeues).
   */
  private async _submitPrompt(text: string): Promise<void> {
    if (this.workflowMode === 'guided' && this.currentProject === null) {
      const project = await this.deps.pickProject();
      if (project === null) {
        return;
      }
      this.currentProject = project;
      this._sendStamped(makeRequest('project.set', { root: project.root, name: project.name }));
    }
    this.lastPrompt = text;
    this.tokens = '';
    this.fileEvents = [];
    this.pendingGate = null;
    this.pendingQuestion = null;
    this._sendStamped(makeRequest('prompt.submit', { text: this._composePrompt(text) }));
    this._clearAttachments();
  }

  /**
   * Prepend a single machine-generated control line listing the staged
   * attachment paths, which the server parses, strips, and replaces with the
   * files' content when prepping the prompt for the LLM. The content itself is
   * never embedded here, so it never lands in `session.jsonl`. Format:
   *
   *   <!--KODO_ATTACHMENTS:["/abs/a.py","/abs/b.md"]-->
   *   <the user's prompt>
   *
   * Kept byte-compatible with `kodo.runtime._attachments.parse_attachment_marker`.
   */
  private _composePrompt(text: string): string {
    if (this.attachedFiles.size === 0) {
      return text;
    }
    const paths = [...this.attachedFiles.values()].map((f) => f.path);
    return `<!--KODO_ATTACHMENTS:${JSON.stringify(paths)}-->\n${text}`;
  }

  /** Forget all staged attachments and clear their chips in the webview. */
  private _clearAttachments(): void {
    if (this.attachedFiles.size === 0) {
      return;
    }
    this.attachedFiles.clear();
    this._post({ type: 'attachments_cleared' });
  }

  /**
   * Open a file picker and stage each chosen file after a sanity check: it must
   * be a text file (no binary/NUL bytes), at most 128 KB on its own, and must
   * not push the combined attachment size to/over 128 KB. Rejections surface a
   * native error message explaining why; accepted files post `attachment_added`.
   */
  private async _attachFiles(): Promise<void> {
    if (this.attachedFiles.size >= MAX_ATTACHMENTS) {
      void vscode.window.showWarningMessage(`Kōdo: You can attach at most ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: 'Attach',
      title: 'Attach text files to your prompt',
    });
    if (!uris || uris.length === 0) {
      return;
    }
    for (const uri of uris) {
      if (this.attachedFiles.size >= MAX_ATTACHMENTS) {
        void vscode.window.showWarningMessage(
          `Kōdo: You can attach at most ${MAX_ATTACHMENTS} files — some files were not attached.`,
        );
        break;
      }
      await this._tryAttachOne(uri);
    }
  }

  /**
   * Validate a single file for instant user feedback and, if it passes, stage
   * its path + chip. The content is read here only to validate (text + size);
   * it is discarded — the server re-reads, re-validates, and copies the file at
   * submit time and is the authoritative gate (the original may change before
   * the prompt is sent).
   */
  private async _tryAttachOne(uri: vscode.Uri): Promise<void> {
    const name = path.basename(uri.fsPath);
    let data: Buffer;
    try {
      data = await fs.promises.readFile(uri.fsPath);
    } catch (err) {
      void vscode.window.showErrorMessage(`Kōdo: Cannot attach "${name}" — ${String(err)}`);
      return;
    }
    // A NUL byte (or a UTF-8 decode failure) means this is not a text file.
    if (data.includes(0) || !_isValidUtf8(data)) {
      void vscode.window.showErrorMessage(
        `Kōdo: Cannot attach "${name}" — it appears to be a binary file. Only text files can be attached.`,
      );
      return;
    }
    const size = data.byteLength;
    if (size > MAX_ATTACH_BYTES) {
      void vscode.window.showErrorMessage(
        `Kōdo: Cannot attach "${name}" — its text content is larger than 128 KB.`,
      );
      return;
    }
    if (this._attachedBytes() + size > MAX_ATTACH_BYTES) {
      void vscode.window.showErrorMessage(
        `Kōdo: Cannot attach "${name}" — the combined size of attached files would exceed the 128 KB limit.`,
      );
      return;
    }
    const id = `att-${++this._attachSeq}`;
    this.attachedFiles.set(id, { name, path: uri.fsPath, size });
    this._post({ type: 'attachment_added', id, name, path: uri.fsPath });
  }

  /** Total text-content bytes across all staged attachments. */
  private _attachedBytes(): number {
    let total = 0;
    for (const f of this.attachedFiles.values()) {
      total += f.size;
    }
    return total;
  }

  /**
   * Delete this session after a yes/no confirmation. On confirm: show a ~5s
   * progress notification, clear the webview, and ask the server to delete the
   * session's files. The server closes the socket on success (→ close the tab)
   * or replies `session.delete.error` (→ hide the progress, show the error).
   */
  private async _confirmAndDelete(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      'Delete this Kōdo session?',
      {
        modal: true,
        detail:
          'This is a destructive action that cannot be undone. All agent history ' +
          'associated with this session will be permanently deleted.\n\n' +
          'The project this session was working on will not be affected.',
      },
      'Yes',
    );
    if (choice !== 'Yes') {
      return;
    }

    if (!this.sessionId) {
      // Nothing persisted on the server yet — just close the tab.
      this.panel.dispose();
      return;
    }

    this.deleting = true;
    // (1) Progress notification, shown for ~5s (resolved early on a server error).
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Deleting this session…',
        cancellable: false,
      },
      () =>
        new Promise<void>((resolve) => {
          this.resolveDeleteProgress = resolve;
          setTimeout(resolve, 5000);
        }),
    );
    // (2) Clear the webview content.
    this._post({ type: 'session_cleared' });
    // (3) Ask the server to delete the session's files.
    this._sendStamped(makeRequest('session.delete', { session_id: this.sessionId }));
  }

  private _rehydrate(): void {
    // Re-persist the session id now that the webview is provably listening (it
    // just posted 'ready'). The live `persist_session_id` from _onHelloAck can
    // fire before the webview attaches its message listener — the hello round-
    // trip to the localhost server routinely beats the first React mount — and
    // is then lost. Without this, the id is never written to VS Code webview
    // state, so on the next window restore the panel deserializes with no id
    // and the server mints a brand-new session instead of resuming this one.
    if (this.sessionId) {
      this._post({ type: 'persist_session_id', sessionId: this.sessionId });
    }
    this._post({ type: 'workspace_status', hasWorkspace: this.deps.hasWorkspace() });
    this._post({ type: 'status', connected: this.connected });
    this._post({ type: 'stage', stage: this.stage, agent: this.agent });
    this._postModeState();
    if (this.sessionHistory !== null) {
      this._post({ type: 'session_history', entries: this.sessionHistory });
    }
    if (this.sessionName) {
      this._post({ type: 'session_name', name: this.sessionName });
    }
    if (this.currentProject !== null) {
      this._post({ type: 'current_project', ...this.currentProject });
    }
    if (this.lastPrompt) {
      this._post({ type: 'restore_prompt', text: this.lastPrompt });
    }
    if (this.tokens) {
      this._post({ type: 'token', text: this.tokens });
    }
    if (this.usage.lastCallTokens !== null || this.usage.cumulativeUsd > 0) {
      this._post({ type: 'usage', ...this.usage });
    }
    if (this.contextStats !== null) {
      this._post({ type: 'context_stats', ...this.contextStats });
    }
    if (this.compacting) {
      this._post({ type: 'context_compacting', active: true });
    }
    for (const fe of this.fileEvents) {
      this._post({ type: 'file_change', ...fe });
    }
    if (this.pendingGate !== null) {
      this._post({ type: 'approval_request', ...this.pendingGate });
    }
    if (this.pendingQuestion !== null) {
      this._post({ type: 'question_request', ...this.pendingQuestion });
    }
    if (this.resumeSessionId !== null) {
      this._post({ type: 'resume_offer', sessionId: this.resumeSessionId });
    }
    // Staged attachments live on the host, so restore their chips on reload.
    for (const [id, f] of this.attachedFiles) {
      this._post({ type: 'attachment_added', id, name: f.name, path: f.path });
    }
  }

  // ------------------------------------------------------------------
  // Server → controller cache → WebView
  // ------------------------------------------------------------------

  private _onEnvelope(env: Envelope): void {
    if (env.kind === 'stream_chunk') {
      const text = String(env.payload.text ?? '');
      this.tokens += text;
      if (this.tokens.length > TOKEN_BUFFER_MAX) {
        this.tokens = this.tokens.slice(-TOKEN_BUFFER_MAX / 2);
      }
      this._post({ type: 'token', text });
      return;
    }
    if (env.kind === 'thinking_chunk') {
      this._post({ type: 'thinking_token', text: String(env.payload.text ?? '') });
      return;
    }
    if (env.kind === 'toolgen_chunk') {
      this._post({
        type: 'toolgen_token',
        toolName: String(env.payload.tool_name ?? ''),
        text: String(env.payload.text ?? ''),
      });
      return;
    }
    if (env.kind === 'stream_end') {
      this._post({ type: 'stream_end' });
      return;
    }

    const evtType = String(env.payload.type ?? '');

    if (env.kind === 'response' && evtType === 'pong') {
      this._post({ type: 'pong' });
      return;
    }

    if (env.kind === 'response' && evtType === 'hello.ack') {
      this._onHelloAck(env);
      return;
    }

    if (env.kind === 'response' && evtType === 'session.delete.error') {
      // The server could not delete the session: hide the progress, keep the
      // tab open, and surface the error. (Nothing else happens.)
      this.deleting = false;
      if (this.resolveDeleteProgress) {
        this.resolveDeleteProgress();
        this.resolveDeleteProgress = null;
      }
      const message = String(env.payload.message ?? 'Unknown error');
      void vscode.window.showErrorMessage(`Kōdo: failed to delete this session — ${message}`);
      return;
    }

    if (env.kind === 'event' && evtType === 'state') {
      this.stage = String(env.payload.stage ?? 'IDLE');
      this.agent = env.payload.agent ? String(env.payload.agent) : null;
      this._post({ type: 'stage', stage: this.stage, agent: this.agent });
      // A turn is in progress iff the server reports phase "running"; this is the
      // authoritative signal the Edit/Command lock and the frozen-toggle "queued"
      // status hang off (the legacy `stage` field above is vestigial/always IDLE).
      this.running = String(env.payload.phase ?? '') === 'running';
      // Adopt the server's authoritative snapshot for the two *frozen* toggles —
      // both the selected values and the per-turn frozen effective values it just
      // froze/reported. Edit/Command are host-owned (never adopted from the
      // server, which only echoes back the shown value we last sent).
      this.autonomous = Boolean(env.payload.autonomous ?? false);
      this.effectiveAutonomous = Boolean(env.payload.effective_autonomous ?? this.autonomous);
      this.workflowMode = coerceWorkflowMode(env.payload.workflow_mode);
      this.effectiveWorkflowMode = coerceWorkflowMode(
        env.payload.effective_workflow_mode ?? env.payload.workflow_mode,
      );
      // The turn boundary may have just locked/unlocked Edit & Command (a turn
      // starting under Autonomous forces Allow All/Permissive; a turn ending
      // unlocks to the user's selection) — resync the shown values if so.
      this._syncEditCommandToServer();
      this._postModeState();
      return;
    }

    if (env.kind === 'event' && evtType === 'project.bound') {
      const root = String(env.payload.root ?? '');
      const name = String(env.payload.name ?? root);
      if (root) {
        this.currentProject = { root, name };
        this._post({ type: 'current_project', root, name });
      }
      return;
    }

    if (env.kind === 'event' && evtType === 'session.history') {
      const entries = env.payload.entries;
      if (Array.isArray(entries)) {
        this.sessionHistory = entries as Record<string, unknown>[];
        this._post({ type: 'session_history', entries: this.sessionHistory });
      }
      return;
    }

    if (env.kind === 'event' && evtType === 'session.name') {
      const name = String(env.payload.name ?? '');
      this.sessionName = name;
      this.panel.title = name || 'Kōdo';
      this._post({ type: 'session_name', name });
      return;
    }

    if (env.kind === 'event' && evtType === 'session.naming') {
      this._post({ type: 'session_naming', active: Boolean(env.payload.active) });
      return;
    }

    if (env.kind === 'event' && evtType === 'agent.started') {
      this.agent = String(env.payload.agent ?? '');
      this._post({ type: 'agent_started', agent: this.agent });
      return;
    }

    if (env.kind === 'event' && evtType === 'agent.finished') {
      this._post({ type: 'agent_finished', agent: String(env.payload.agent ?? '') });
      return;
    }

    if (env.kind === 'event' && evtType === 'subsession.started') {
      this._post({
        type: 'subsession_started',
        agent: String(env.payload.agent ?? ''),
        displayName: String(env.payload.display_name ?? ''),
        task: String(env.payload.task ?? ''),
      });
      return;
    }

    if (env.kind === 'event' && evtType === 'subsession.ended') {
      this._post({
        type: 'subsession_ended',
        agent: String(env.payload.agent ?? ''),
        displayName: String(env.payload.display_name ?? ''),
        parentDisplayName: String(env.payload.parent_display_name ?? ''),
      });
      return;
    }

    if (env.kind === 'event' && evtType === 'file.change') {
      const fe: FileEventData = {
        path: String(env.payload.path ?? ''),
        kind: String(env.payload.kind ?? 'modify'),
      };
      this.fileEvents.push(fe);
      this._post({ type: 'file_change', ...fe });
      return;
    }

    if (env.kind === 'request' && evtType === 'prompt.approval') {
      this.pendingGate = {
        gateId: env.id,
        gateType: String(env.payload.gate_type ?? ''),
        summary: String(env.payload.summary ?? ''),
        artifactPath: env.payload.artifact_path ? String(env.payload.artifact_path) : null,
      };
      this._post({ type: 'approval_request', ...this.pendingGate });
      return;
    }

    if (env.kind === 'request' && evtType === 'prompt.question') {
      const rawChoices = env.payload.choices;
      const choices: QuestionChoice[] | null = Array.isArray(rawChoices)
        ? rawChoices.map((c) => ({
            key: String((c as Record<string, unknown>).key ?? ''),
            label: String((c as Record<string, unknown>).label ?? ''),
          }))
        : null;
      this.pendingQuestion = {
        requestId: env.id,
        question: String(env.payload.question ?? ''),
        mode: String(env.payload.mode ?? 'free_text'),
        choices,
      };
      this._post({ type: 'question_request', ...this.pendingQuestion });
      return;
    }

    if (env.kind === 'event' && evtType === 'autonomous.changed') {
      // A Guide-driven disable clears both the selected and effective values
      // immediately (it accompanies a fresh `state` event carrying the same).
      const autonomous = Boolean(env.payload.autonomous ?? false);
      this.autonomous = autonomous;
      if (!autonomous) {
        this.effectiveAutonomous = false;
      }
      // Clearing Autonomous unlocks Edit & Command back to the user's selection.
      this._syncEditCommandToServer();
      this._postModeState();
      if (!autonomous) {
        void vscode.window.showInformationMessage('Kōdo: Autonomous mode has been turned off.');
      }
      return;
    }

    if (env.kind === 'event' && evtType === 'post.update') {
      this._post({ type: 'post_update', message: String(env.payload.message ?? '') });
      return;
    }

    // The server stored this prompt's attachments and copied them into the
    // session. Hand the absolute stored-copy paths to the webview so the chips
    // on the just-sent bubble open the durable copies (not the originals).
    if (env.kind === 'event' && evtType === 'user.attachments') {
      const raw = Array.isArray(env.payload.attachments) ? env.payload.attachments : [];
      const attachments = raw.map((a) => {
        const rec = a as Record<string, unknown>;
        return { name: String(rec.name ?? ''), path: String(rec.path ?? '') };
      });
      this._post({ type: 'sent_attachments', attachments });
      return;
    }

    // llama.cpp is auto-started inside this session's engine run, so its state
    // events land here rather than on the control connection. Hand them to the
    // host's window-global handler (sidebar mirror + "starting…" progress).
    if (env.kind === 'event' && evtType === 'llama.state') {
      this.deps.onLlamaState(env.payload);
      return;
    }

    if (env.kind === 'event' && evtType === 'llm.turn_start') {
      this._post({ type: 'llm_turn_start' });
      return;
    }

    if (env.kind === 'event' && evtType === 'llm.waiting') {
      const waiting = Boolean(env.payload.waiting);
      const reason = String(env.payload.reason ?? 'queued');
      const retryIn = typeof env.payload.retry_in_seconds === 'number' ? env.payload.retry_in_seconds : null;
      this._post({ type: 'llm_waiting', waiting, reason, retryIn });
      if (waiting && reason === 'throttled' && retryIn) {
        const mins = Math.max(1, Math.round(retryIn / 60));
        void vscode.window
          .withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Kōdo: rate-limited by the LLM provider — retrying in ~${mins} min`,
              cancellable: false,
            },
            () => new Promise<void>((resolve) => setTimeout(resolve, 60_000)),
          )
          .then(undefined, () => undefined);
      }
      return;
    }

    if (env.kind === 'event' && evtType === 'agent.tool_call') {
      this._post({
        type: 'tool_call',
        toolName: String(env.payload.tool_name ?? ''),
        description: String(env.payload.description ?? ''),
        toolCallId: String(env.payload.tool_call_id ?? ''),
        timeoutSeconds: typeof env.payload.timeout_seconds === 'number' ? env.payload.timeout_seconds : null,
      });
      return;
    }

    if (env.kind === 'event' && evtType === 'agent.tool_call_detail') {
      const rawDiff = env.payload.diff as Record<string, unknown> | null | undefined;
      const diff =
        rawDiff && typeof rawDiff === 'object'
          ? {
              label: String(rawDiff.label ?? ''),
              prevPath: String(rawDiff.prev_path ?? ''),
              newPath: String(rawDiff.new_path ?? ''),
            }
          : null;
      this._post({
        type: 'tool_call_detail',
        toolCallId: String(env.payload.tool_call_id ?? ''),
        detailFile: typeof env.payload.file === 'string' ? env.payload.file : null,
        rows: Array.isArray(env.payload.rows) ? env.payload.rows : [],
        schemaCompliance: typeof env.payload.schema_compliance === 'boolean' ? env.payload.schema_compliance : null,
        success: typeof env.payload.success === 'boolean' ? env.payload.success : null,
        diff,
      });
      return;
    }

    if (env.kind === 'event' && evtType === 'tool.incompliant') {
      const externalName = String(env.payload.external_name ?? 'A tool');
      const desc = String(env.payload.user_description ?? '');
      const internalName = String(env.payload.tool_name ?? '');
      void vscode.window.showErrorMessage(
        `Kōdo: the "${externalName}" tool returned output that does not match its declared ` +
          `schema, so Kōdo had to repair it.${desc ? ` (${desc})` : ''} ` +
          `Internal tool name: ${internalName}.`,
      );
      return;
    }

    if (env.kind === 'event' && evtType === 'usage.update') {
      const cumulativeUsd = Number(env.payload.cumulative_usd ?? 0);
      const durationSeconds = Number(env.payload.duration_seconds ?? 0);
      const raw = env.payload.last_call_tokens;
      const lastCallTokens: LastCallTokens | null =
        raw && typeof raw === 'object'
          ? {
              input: Number((raw as Record<string, unknown>).input ?? 0),
              output: Number((raw as Record<string, unknown>).output ?? 0),
              cache_write: Number((raw as Record<string, unknown>).cache_write ?? 0),
              cache_read: Number((raw as Record<string, unknown>).cache_read ?? 0),
            }
          : null;
      this.usage = { cumulativeUsd, lastCallTokens };
      this._post({ type: 'usage', cumulativeUsd, lastCallTokens, durationSeconds });
      return;
    }

    if (env.kind === 'event' && evtType === 'context.stats') {
      const stats = {
        currentTokens: Number(env.payload.current_tokens ?? 0),
        limitTokens: Number(env.payload.limit_tokens ?? 0),
        percent: Number(env.payload.percent ?? 0),
        canCompact: Boolean(env.payload.can_compact ?? false),
      };
      this.contextStats = stats;
      this._post({ type: 'context_stats', ...stats });
      return;
    }

    if (env.kind === 'event' && evtType === 'context.compacting') {
      this.compacting = Boolean(env.payload.active ?? false);
      this._post({ type: 'context_compacting', active: this.compacting });
      return;
    }

    if (env.kind === 'event' && evtType === 'context.compacted') {
      this._post({
        type: 'context_compacted',
        summaryExcerpt: String(env.payload.summary_excerpt ?? ''),
        summary: String(env.payload.summary ?? env.payload.summary_excerpt ?? ''),
        tokensBefore: Number(env.payload.tokens_before ?? 0),
        tokensAfter: Number(env.payload.tokens_after ?? 0),
      });
      return;
    }

    if (env.kind === 'event' && evtType === 'error') {
      const message = String(env.payload.message ?? 'Unknown server error');
      if (!Boolean(env.payload.recoverable ?? true)) {
        void vscode.window.showErrorMessage(
          `Kōdo: an error occurred and the workflow cannot proceed — ${message}`,
        );
      }
      return;
    }

    if (env.kind === 'event' && evtType === 'resume_offer') {
      this.resumeSessionId = String(env.payload.session_id ?? '');
      this._post({ type: 'resume_offer', sessionId: this.resumeSessionId });
      return;
    }

    // Server-initiated API-key request for THIS session's LLM call. Reply on
    // this session's connection via the shared SecretStorage-backed handler.
    if (env.kind === 'request' && evtType === 'api_key.request') {
      this.deps.handleApiKeyRequest(String(env.payload.vendor ?? ''), env.id, (e) => this._sendStamped(e));
      return;
    }

    if (env.kind === 'event' && evtType === 'api_key.revoke') {
      const vendor = String(env.payload.vendor ?? '');
      if (vendor) {
        void this.deps.context.secrets.delete(`kodo.apiKey.${vendor}`).then(undefined, () => undefined);
      }
      return;
    }
  }

  private _onHelloAck(env: Envelope): void {
    if (env.payload.error === 'session_in_use') {
      // A restored/resumed tab whose session is now held by another window.
      void vscode.window.showWarningMessage(
        'This Kōdo session is open in another window. Close it there first to reopen it here.',
      );
      this.panel.dispose();
      return;
    }

    const assigned = env.payload.session_id;
    if (typeof assigned === 'string' && assigned) {
      this.sessionId = assigned;
      this.deps.onSessionAssigned(this, assigned);
      // Persist the id INTO the webview so the panel serializer can resume this
      // exact session after a window reload / workspace reopen.
      this._post({ type: 'persist_session_id', sessionId: assigned });
    }

    // Per-session syncs now that the id is confirmed.
    this._sendStamped(
      makeRequest('workspace.folders', {
        physical_root: this.deps.getPhysicalRoot(),
        folders: this.deps.buildFolderMap(),
      }),
    );

    if (this.isNewSession) {
      // A blank session starts interactive, problem-solving, with Edit & Command
      // Control at their Smart default — selected == effective, nothing locked.
      this.workflowMode = 'problem_solving';
      this.effectiveWorkflowMode = 'problem_solving';
      this.autonomous = false;
      this.effectiveAutonomous = false;
      this.running = false;
      this.editControl = 'smart';
      this.commandControl = 'smart';
      this._sendStamped(makeRequest('workflow.set', { mode: 'problem_solving' }));
      this._syncEditCommandToServer();
      this._postModeState();
    } else {
      // Resumed: adopt the session's own persisted prefs from hello.ack state.
      const state = env.payload.state as Record<string, unknown> | undefined;
      if (state) {
        this.autonomous = Boolean(state.autonomous ?? false);
        this.effectiveAutonomous = Boolean(state.effective_autonomous ?? this.autonomous);
        this.workflowMode = coerceWorkflowMode(state.workflow_mode);
        this.effectiveWorkflowMode = coerceWorkflowMode(
          state.effective_workflow_mode ?? state.workflow_mode,
        );
        // A resumed tab is never mid-turn (the worker is idle on connect), so
        // the lock follows the resumed `autonomous` selection. Hydrate the
        // Edit/Command selection from the persisted value only when *not* locked;
        // while locked the persisted value is the forced Allow All/Permissive, so
        // we leave the selection at its Smart default (it would otherwise show a
        // stale forced value on the next unlock).
        this.running = false;
        if (this.autonomous) {
          this.editControl = 'smart';
          this.commandControl = 'smart';
        } else {
          this.editControl = coerceEditControl(state.edit_control);
          this.commandControl = coerceCommandControl(state.command_control);
        }
        this._syncEditCommandToServer();
        this._postModeState();
      }
    }

    const cp = env.payload.current_project as { root?: unknown; name?: unknown } | null | undefined;
    if (cp && typeof cp.root === 'string' && cp.root) {
      this.currentProject = { root: cp.root, name: typeof cp.name === 'string' ? cp.name : cp.root };
      this._post({ type: 'current_project', ...this.currentProject });
    }
  }

  /** Re-push the folder map (e.g. after onDidChangeWorkspaceFolders). */
  pushWorkspaceFolders(): void {
    if (!this.connected || !this.sessionId) {
      return;
    }
    this._sendStamped(
      makeRequest('workspace.folders', {
        physical_root: this.deps.getPhysicalRoot(),
        folders: this.deps.buildFolderMap(),
      }),
    );
  }

  /** Notify the webview of a workspace open/close gate change. */
  postWorkspaceStatus(hasWorkspace: boolean): void {
    this._post({ type: 'workspace_status', hasWorkspace });
  }
}

/**
 * True iff `data` decodes cleanly as UTF-8. Used (alongside a NUL-byte scan) to
 * reject binary files: `Buffer.toString('utf8')` silently substitutes U+FFFD on
 * malformed input, so a fatal TextDecoder is needed to actually detect it.
 */
function _isValidUtf8(data: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// WebView HTML
// ---------------------------------------------------------------------------

function generateNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function buildHtml(webviewJsUri: vscode.Uri, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}';">
  <title>Kōdo</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
}
