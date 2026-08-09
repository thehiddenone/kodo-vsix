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
 *
 * The state and behavior this class used to hold as one ~1740-line body now
 * live partly in composed delegates, each owning one cohesive slice:
 *   - {@link AttachmentManager} — staged prompt attachments.
 *   - {@link PromptGateManager} — the approval/permission/stuck-alert/question
 *     request-response pairs.
 *   - {@link ReviewGateController} — the Edit Control review gate and its
 *     companion editor tab.
 *   - {@link ModeToggleController} — Autonomous/workflow/Edit/Tool
 *     Control/Thinking level.
 *   - {@link ActivityCache} — stage/tokens/usage/context/file-events/
 *     history/name, the passive cache `rehydrate()` replays.
 * This class remains the connection lifecycle, the webview-message and
 * server-envelope dispatchers, the confirm-dialog flows, and `_rehydrate`'s
 * orchestration of the delegates above (in their original posting order).
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest, makeResponse } from '../envelope';
import type { Envelope } from '../envelope';
import type { SamplingContext, SamplingValues, ThinkingContext } from '../llm-registry-types';
import { parseSamplingValues } from '../llm-registry-types';
import { resolveLogicalPath } from '../logical-path';
import { WsClient } from '../ws-client';
import { handleStatelessEnvelope } from './agent-event-translation';
import { ActivityCache } from './activity-cache';
import { AttachmentManager } from './attachment-manager';
import { ModeToggleController } from './mode-toggle-controller';
import { PromptGateManager } from './prompt-gate-manager';
import { ReviewGateController } from './review-gate-controller';
import type { SessionDeps, UiSettings } from './types';
import { buildHtml, generateNonce } from './webview-html';

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

  private deleting = false;
  private resolveDeleteProgress: (() => void) | null = null;

  private readonly attachments: AttachmentManager;
  private readonly gates: PromptGateManager;
  private readonly review: ReviewGateController;
  private readonly modeToggle: ModeToggleController;
  private readonly activity: ActivityCache;

  private lastPrompt = '';
  private uiSettings: UiSettings;
  // Window-global half of the footer sampling control (which quant, its
  // launch-arg values, the parameter table) — refreshed by the host via
  // `updateSamplingContext` whenever the active model/registry changes.
  private samplingContext: SamplingContext;
  // Per-session half: this session's own per-quant overrides, straight off
  // the server's `state.sampling`. Server-owned like `thinkingLevel` — never
  // optimistically updated here, so a parameter the server dropped or
  // clamped shows its real stored value rather than what was typed.
  private samplingValues: Record<string, SamplingValues> = {};

  private readonly _pendingProjectCreate = new Map<string, (payload: Record<string, unknown>) => void>();

  constructor(
    private readonly deps: SessionDeps,
    panel: vscode.WebviewPanel,
    sessionId: string,
  ) {
    this.key = `session-${++_keySeq}`;
    this.sessionId = sessionId;
    this.isNewSession = sessionId === '';
    this.panel = panel;
    this.uiSettings = deps.getUiSettings();
    this.samplingContext = deps.getSamplingContext();

    const post = (msg: Record<string, unknown>) => this._post(msg);
    const send = (env: Envelope) => this._sendStamped(env);
    this.attachments = new AttachmentManager(post, deps.getProjectRoot);
    this.gates = new PromptGateManager(post);
    this.review = new ReviewGateController(panel, post);
    this.modeToggle = new ModeToggleController(deps.getThinkingContext(), post, send);
    this.activity = new ActivityCache(panel, post);

    panel.iconPath = vscode.Uri.file(
      path.join(deps.context.extensionPath, 'images', 'kodo16px.png'),
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

  /** True when this session's tab is the foreground tab and its connection is ready. */
  get isActiveAndReady(): boolean {
    return this.panel.active && this.connected && this.sessionId !== '';
  }

  /** Mirrors the private field's doc comment — read by `createProject()`'s
   *  disconnected-aware branch in extension.ts. */
  get workspaceConnected(): boolean {
    return this.modeToggle.workspaceConnected;
  }

  /**
   * Send a `project.create` request over this session's connection and await
   * the server's `project.create.done` / `project.create.error` response.
   * Backs the "Create Project" command: `{ path }` when the user picked a
   * concrete folder directly (that folder becomes the project root); `{ name
   * }` alone when a workspace is already open (the server reserves a fresh
   * sibling directory under the session's `physical_root` — the identical
   * has-workspace placement `CreateNewProjectTool` uses, see
   * `EngineCore._create_project`/doc/WS_PROTOCOL.md).
   */
  createProject(
    payload: { path: string; force?: boolean } | { name: string },
    timeoutMs = 15_000,
  ): Promise<Record<string, unknown>> {
    const env = makeRequest('project.create', payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingProjectCreate.delete(env.id);
        reject(new Error('Timed out waiting for project.create response'));
      }, timeoutMs);
      this._pendingProjectCreate.set(env.id, (p) => {
        clearTimeout(timer);
        resolve(p);
      });
      this._sendStamped(env);
    });
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
    // Best-effort: don't leave an orphaned review companion tab behind for a
    // session that's gone.
    void this.review.disposeReviewTab();
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
    const send = (env: Envelope) => this._sendStamped(env);
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
        this.gates.respondApproval(msg, send);
        break;
      case 'permission_respond':
        this.gates.respondPermission(msg, send);
        break;
      case 'stuck_alert_respond':
        this.gates.respondStuckAlert(msg, send);
        break;
      case 'file_review_respond':
        this.review.respond(msg, send);
        break;
      case 'question_respond':
        this.gates.respondQuestion(msg, send);
        break;
      case 'stop':
        this._sendStamped(makeRequest('stop', {}));
        break;
      case 'compact_now':
        this._sendStamped(makeRequest('compact.now', {}));
        break;
      case 'checkpoint_undo':
        this._sendStamped(makeRequest('checkpoint.undo', { root: String(msg.root ?? ''), sha: String(msg.sha ?? '') }));
        break;
      case 'checkpoint_redo':
        this._sendStamped(makeRequest('checkpoint.redo', { root: String(msg.root ?? ''), sha: String(msg.sha ?? '') }));
        break;
      case 'checkpoint_rollback':
        void this._confirmCheckpointMove('rollback', String(msg.root ?? ''), String(msg.sha ?? ''));
        break;
      case 'checkpoint_roll_forward':
        void this._confirmCheckpointMove('roll_forward', String(msg.root ?? ''), String(msg.sha ?? ''));
        break;
      case 'delete_session':
        void this._confirmAndDelete();
        break;
      case 'reconnect_workspace':
        void this._confirmAndReconnectWorkspace();
        break;
      case 'attach_file':
        void this.attachments.attachFiles();
        break;
      case 'remove_attachment':
        this.attachments.remove(String(msg.id ?? ''));
        break;
      case 'mode_set':
        this.modeToggle.setAutonomous(Boolean(msg.autonomous));
        break;
      case 'workflow_set':
        this.modeToggle.setWorkflow(msg.mode === 'problem_solving' ? 'problem_solving' : 'guided');
        break;
      case 'edit_control_set':
        this.modeToggle.setEditControl(msg.editControl);
        break;
      case 'command_control_set':
        this.modeToggle.setCommandControl(msg.commandControl);
        break;
      case 'thinking_level_set':
        // Server-validated, unlike Edit/Tool Control — no optimistic local
        // update. The webview computed the next tier from the family/tiers
        // it was already given; the server replies (thinking_level.accepted)
        // and a `state` event carries the outcome either way, so the shown
        // value stays in sync even on rejection (it simply won't move).
        this._sendStamped(
          makeRequest('thinking_level.set', { thinking_level: String(msg.thinkingLevel ?? '') }),
        );
        break;
      case 'sampling_set': {
        // Server-validated like thinking_level.set, with one difference: bad
        // individual parameters are dropped/clamped rather than failing the
        // request, and the `state` event that follows carries the set that
        // actually stuck — so no optimistic local update here either.
        const model = String(msg.model ?? '');
        if (model) {
          this._sendStamped(
            makeRequest('sampling.set', { model, sampling: parseSamplingValues(msg.sampling) }),
          );
        }
        break;
      }
      case 'open_file': {
        const filePath = String(msg.path ?? '');
        // Tool-call paths are logical (folder-name-prefixed, WS_PROTOCOL.md
        // `workspace.folders`) rather than relative to a single project
        // root — resolving against `getProjectRoot()` double-counts that
        // root's own folder name in a single-root workspace, and picks the
        // wrong root entirely once more than one is open. Mirrors the
        // server's `resolve_logical` against the same folder map it uses.
        const resolved = resolveLogicalPath(this.deps.buildFolderMap(), filePath);
        if (resolved === null) {
          if (filePath) {
            void vscode.window.showErrorMessage(`Kōdo: Cannot open file — unknown workspace folder in "${filePath}".`);
          }
          break;
        }
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolved)).then(
          () => undefined,
          (err: unknown) => vscode.window.showErrorMessage(`Kōdo: Cannot open file — ${String(err)}`),
        );
        break;
      }
      case 'open_file_preview': {
        const filePath = String(msg.path ?? '');
        if (filePath) {
          void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath)).then(
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
   * Submit a prompt. Guided and Problem Solver mode both ride whatever roots
   * are already bound (VS Code workspace folders, or projects created via
   * `create_new_project`/`init_project`) — there is no separate binding step.
   */
  private async _submitPrompt(text: string): Promise<void> {
    // The webview already echoed this prompt into its own transcript
    // optimistically (App.tsx's sendPrompt/'prompt_sent'), before the host
    // ever sees this message — so a cancel here leaves that echo in place
    // with nothing sent; tell the user explicitly rather than let it look
    // like a silent hang.
    if (!(await this.deps.confirmLocalLaunch())) {
      void vscode.window.showWarningMessage('Kōdo: prompt not sent — llama.cpp was not started.');
      return;
    }
    this.lastPrompt = text;
    this.activity.resetForSubmit();
    this.gates.clearAll();
    this.review.clear();
    this._sendStamped(makeRequest('prompt.submit', { text: this.attachments.composePrompt(text) }));
    this.attachments.clear();
  }

  /**
   * Move the entire project's checkpoint state after a yes/no confirmation —
   * shared by the "Rollback to this state" / "Roll forward to this state"
   * links in {@link SessionEntryView}. Nothing is sent to the server until the
   * user confirms the native modal.
   */
  private async _confirmCheckpointMove(
    direction: 'rollback' | 'roll_forward',
    root: string,
    sha: string,
  ): Promise<void> {
    const isRollback = direction === 'rollback';
    const choice = await vscode.window.showWarningMessage(
      isRollback ? 'Rollback the project to this state?' : 'Roll the project forward to this state?',
      {
        modal: true,
        detail: isRollback
          ? 'This restores the entire project to its state right after this step ran, discarding any ' +
            'later changes from the working tree. Nothing is lost — you can roll forward again afterwards.'
          : 'This moves the entire project forward to its state right after this step ran.',
      },
      'Yes',
    );
    if (choice !== 'Yes') {
      return;
    }
    this._sendStamped(makeRequest(isRollback ? 'checkpoint.rollback' : 'checkpoint.roll_forward', { root, sha }));
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

  /**
   * The webview's reconnect-workspace button (shown only while
   * `!workspaceConnected`, doc/WS_PROTOCOL.md §7.1b) — confirms, then
   * delegates the actual reload to `deps.reconnectWorkspace`, which reuses
   * the same reload/continuity plumbing `_resumeSessionIntoWorkspace` uses
   * for a mismatched picked session.
   */
  private async _confirmAndReconnectWorkspace(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      'Do you want to load the workspace associated with the current Kōdo session?',
      { modal: true },
      'Yes',
    );
    if (choice !== 'Yes' || !this.sessionId) {
      return;
    }
    await this.deps.reconnectWorkspace(this.sessionId);
  }

  /**
   * A checkpoint undo/redo/rollback/roll-forward was blocked because the work
   * tree has edits Kōdo didn't make (it would otherwise silently overwrite
   * them). Ask the user how to proceed and resubmit the same request with a
   * `resolution`; the server retries with that decision applied.
   */
  private async _confirmCheckpointDirtyTree(env: Envelope): Promise<void> {
    const requestType = String(env.payload.type ?? '').replace(/\.needs_confirmation$/, '');
    const root = String(env.payload.root ?? '');
    const sha = String(env.payload.sha ?? '');
    const choice = await vscode.window.showWarningMessage(
      "This project has changes Kōdo didn't make",
      {
        modal: true,
        detail:
          "There are edits here that weren't made through Kōdo (e.g. typed directly into the " +
          'editor). Continuing would overwrite them.\n\n' +
          '"Stash & Continue" keeps those edits — they are re-applied afterwards. "Discard & ' +
          'Continue" proceeds without keeping them.',
      },
      'Stash & Continue',
      'Discard & Continue',
    );
    if (choice !== 'Stash & Continue' && choice !== 'Discard & Continue') {
      return;
    }
    const resolution = choice === 'Stash & Continue' ? 'stash' : 'discard';
    this._sendStamped(makeRequest(requestType, { root, sha, resolution }));
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
    this.activity.rehydrateStage();
    this.modeToggle.postModeState();
    this._postSamplingState();
    this._post({ type: 'ui_settings', ...this.uiSettings });
    this.activity.rehydrateHistoryAndName();
    if (this.lastPrompt) {
      this._post({ type: 'restore_prompt', text: this.lastPrompt });
    }
    this.modeToggle.rehydrateAwaitingLlm();
    this.activity.rehydrateTail();
    this.gates.rehydrate();
    this.review.rehydrate();
    this.activity.rehydrateResumeOffer();
    // Staged attachments live on the host, so restore their chips on reload.
    this.attachments.rehydrate();
  }

  // ------------------------------------------------------------------
  // Server → controller cache → WebView
  // ------------------------------------------------------------------

  private _onEnvelope(env: Envelope): void {
    if (env.kind === 'stream_chunk') {
      this.activity.appendToken(String(env.payload.text ?? ''));
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

    if (env.kind === 'response' && env.correlation_id) {
      const resolver = this._pendingProjectCreate.get(env.correlation_id);
      if (resolver) {
        this._pendingProjectCreate.delete(env.correlation_id);
        resolver(env.payload);
        return;
      }
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
      this.activity.setStage(String(env.payload.stage ?? 'IDLE'), env.payload.agent ? String(env.payload.agent) : null);
      const phase = String(env.payload.phase ?? '');
      // "stopped" only ever follows an explicit user Stop (FR-LLM-07) — unlike
      // a normal turn ending (which lands on "awaiting_user"/"done"/"error"),
      // so it's the one unambiguous signal to tell the webview to silence every
      // "waiting" indicator (thinking/toolgen/awaiting-LLM/run_command progress)
      // and drop an "Interrupted by user" callout into the feed.
      if (phase === 'stopped') {
        this._post({ type: 'interrupted' });
      }
      this.modeToggle.applyStateEvent(env.payload);
      this._adoptSamplingValues(env.payload.sampling);
      return;
    }

    if (env.kind === 'event' && evtType === 'workspace.add_folder') {
      const folderPath = String(env.payload.path ?? '');
      const name = String(env.payload.name ?? '');
      if (folderPath) {
        this.deps.addWorkspaceFolder(folderPath, name);
      }
      return;
    }

    if (env.kind === 'event' && evtType === 'session.history') {
      const entries = env.payload.entries;
      if (Array.isArray(entries)) {
        this.activity.setSessionHistory(entries as Record<string, unknown>[], env.payload.subsessions);
      }
      return;
    }

    if (env.kind === 'event' && evtType === 'session.name') {
      this.activity.setSessionName(String(env.payload.name ?? ''));
      return;
    }

    if (env.kind === 'event' && evtType === 'agent.started') {
      this.activity.setAgentStarted(String(env.payload.agent ?? ''));
      return;
    }

    if (env.kind === 'event' && evtType === 'file.change') {
      this.activity.addFileEvent({
        path: String(env.payload.path ?? ''),
        kind: String(env.payload.kind ?? 'modify'),
      });
      return;
    }

    if (env.kind === 'request' && evtType === 'prompt.approval') {
      this.gates.handleApproval(env);
      return;
    }

    if (env.kind === 'request' && evtType === 'prompt.permission') {
      this.gates.handlePermission(env);
      return;
    }

    if (env.kind === 'request' && evtType === 'prompt.stuck_alert') {
      this.gates.handleStuckAlert(env);
      return;
    }

    if (env.kind === 'request' && evtType === 'prompt.edit_review') {
      this.review.handleEditReviewRequest(env);
      return;
    }

    if (env.kind === 'request' && evtType === 'prompt.question') {
      this.gates.handleQuestion(env);
      return;
    }

    if (env.kind === 'event' && evtType === 'autonomous.changed') {
      const autonomous = Boolean(env.payload.autonomous ?? false);
      this.modeToggle.applyAutonomousChanged(autonomous);
      if (!autonomous) {
        void vscode.window.showInformationMessage('Kōdo: Autonomous mode has been turned off.');
      }
      return;
    }

    // llama.cpp is auto-started inside this session's engine run, so its state
    // events land here rather than on the control connection. Hand them to the
    // host's window-global handler (sidebar mirror + "starting…" progress).
    if (env.kind === 'event' && evtType === 'llama.state') {
      this.deps.onLlamaState(env.payload);
      return;
    }

    // Every remaining agent/tool-call narration and diagnostic event that
    // touches no controller state at all — see agent-event-translation.ts.
    if (handleStatelessEnvelope(env, evtType, (m) => this._post(m))) {
      return;
    }

    if (env.kind === 'event' && evtType === 'usage.update') {
      const cumulativeUsd = Number(env.payload.cumulative_usd ?? 0);
      const durationSeconds = Number(env.payload.duration_seconds ?? 0);
      const raw = env.payload.last_call_tokens;
      const lastCallTokens =
        raw && typeof raw === 'object'
          ? {
              input: Number((raw as Record<string, unknown>).input ?? 0),
              output: Number((raw as Record<string, unknown>).output ?? 0),
              cache_write: Number((raw as Record<string, unknown>).cache_write ?? 0),
              cache_read: Number((raw as Record<string, unknown>).cache_read ?? 0),
            }
          : null;
      this.activity.setUsage(cumulativeUsd, lastCallTokens, durationSeconds);
      return;
    }

    if (env.kind === 'event' && evtType === 'context.stats') {
      const rawSub = env.payload.subsession;
      const subsession =
        rawSub && typeof rawSub === 'object'
          ? {
              currentTokens: Number((rawSub as Record<string, unknown>).current_tokens ?? 0),
              limitTokens: Number((rawSub as Record<string, unknown>).limit_tokens ?? 0),
              percent: Number((rawSub as Record<string, unknown>).percent ?? 0),
            }
          : null;
      this.activity.setContextStats(
        {
          currentTokens: Number(env.payload.current_tokens ?? 0),
          limitTokens: Number(env.payload.limit_tokens ?? 0),
          percent: Number(env.payload.percent ?? 0),
          canCompact: Boolean(env.payload.can_compact ?? false),
        },
        subsession,
      );
      return;
    }

    if (env.kind === 'event' && evtType === 'context.compacting') {
      this.activity.setCompacting(Boolean(env.payload.active ?? false));
      return;
    }

    if (
      env.kind === 'response' &&
      evtType.startsWith('checkpoint.') &&
      evtType.endsWith('.needs_confirmation')
    ) {
      void this._confirmCheckpointDirtyTree(env);
      return;
    }

    if (env.kind === 'event' && evtType === 'resume_offer') {
      this.activity.setResumeOffer(String(env.payload.session_id ?? ''));
      return;
    }

    // Server-initiated API-key request for THIS session's LLM call. Reply on
    // this session's connection via the shared SecretStorage-backed handler.
    if (env.kind === 'request' && evtType === 'api_key.request') {
      this.deps.handleApiKeyRequest(String(env.payload.vendor ?? ''), env.id, (e) => this._sendStamped(e));
      return;
    }

    // Server-initiated folder-picker request for `create_new_project`'s
    // interactive bootstrap path (no project/workspace bound yet). Host-native
    // dialog only, no webview UI involved.
    if (env.kind === 'request' && evtType === 'prompt.choose_project_folder') {
      this.deps.chooseProjectFolder(env.id, (e) => this._sendStamped(e));
      return;
    }

    if (env.kind === 'event' && evtType === 'api_key.revoke') {
      const vendor = String(env.payload.vendor ?? '');
      if (vendor) {
        this.deps.revokeApiKey(vendor);
      }
      return;
    }
  }

  /**
   * Called for every `tabGroups.onDidChangeTabs` event, window-wide (fanned
   * out from `extension.ts` to every open session) — forwarded to the review
   * gate, the only delegate that cares about tab closes.
   */
  handleTabsChanged(closed: readonly vscode.Tab[]): void {
    this.review.handleTabsChanged(closed, (env) => this._sendStamped(env));
  }

  /** Forwarded to the review gate — see its doc comment. */
  handleActiveSelectionChanged(editor: vscode.TextEditor | undefined): void {
    this.review.handleActiveSelectionChanged(editor);
  }

  /** Forwarded to the review gate — see its doc comment. */
  tryAddFeedbackFromActiveSelection(): boolean {
    return this.review.tryAddFeedbackFromActiveSelection();
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
        code_workspace_file: this.deps.getCodeWorkspaceFile(),
      }),
    );

    // thinking_level is server-owned and always present in `state` regardless
    // of new-vs-resumed (a new session is seeded server-side from the active
    // model's family default — doc/SESSIONS.md) — hydrate it uniformly.
    const state = env.payload.state as Record<string, unknown> | undefined;
    this.modeToggle.setThinkingLevelFromHello(String(state?.thinking_level ?? ''));
    // Same uniform-hydration reasoning as thinking_level: `sampling` is always
    // present in `state` (empty `{}` for a session that never tuned anything),
    // for both a new and a resumed session.
    this._adoptSamplingValues(state?.sampling);

    if (this.isNewSession) {
      this.modeToggle.applyNewSessionDefaults();
    } else if (state) {
      this.modeToggle.applyResumedState(state);
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
        code_workspace_file: this.deps.getCodeWorkspaceFile(),
      }),
    );
  }

  /** Notify the webview of a workspace open/close gate change. */
  postWorkspaceStatus(hasWorkspace: boolean): void {
    this._post({ type: 'workspace_status', hasWorkspace });
  }

  /**
   * Apply a new window-global thinking-tier context (the host calls this on
   * every session tab whenever the active local/cloud model changes) and
   * re-push the mode-toggle snapshot so the webview's Thinking control
   * updates immediately — e.g. disables itself the moment the user switches
   * to a non-thinking model, without waiting for a server round trip.
   */
  updateThinkingContext(ctx: ThinkingContext): void {
    this.modeToggle.updateThinkingContext(ctx);
  }

  /**
   * Apply a new window-global `SamplingContext` (the host calls this on every
   * open tab whenever the active model, the registry, or a profile/knob changes) and
   * re-push. Mirrors `updateThinkingContext`: the footer button appears,
   * disappears (cloud model) or re-seeds its defaults without a round trip.
   */
  updateSamplingContext(ctx: SamplingContext): void {
    this.samplingContext = ctx;
    this._postSamplingState();
  }

  /** Adopt the server's `state.sampling` map (all quants) and re-push. */
  private _adoptSamplingValues(raw: unknown): void {
    const next: Record<string, SamplingValues> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [model, values] of Object.entries(raw as Record<string, unknown>)) {
        next[model] = parseSamplingValues(values);
      }
    }
    this.samplingValues = next;
    this._postSamplingState();
  }

  /** Push both halves the footer button and its modal need. `model: ''`
   *  (cloud) means the webview renders no button at all. */
  private _postSamplingState(): void {
    const model = this.samplingContext.model;
    this._post({
      type: 'sampling_state',
      model,
      specs: this.samplingContext.specs,
      defaults: this.samplingContext.defaults,
      values: model ? (this.samplingValues[model] ?? {}) : {},
    });
  }

  /**
   * Apply new "Show Timestamps" flags (the host calls this on every open
   * session tab right after the user changes them in Kōdo Settings) and push
   * them to the webview immediately, without waiting for a reload.
   */
  updateUiSettings(settings: UiSettings): void {
    this.uiSettings = settings;
    this._post({ type: 'ui_settings', ...settings });
  }
}
