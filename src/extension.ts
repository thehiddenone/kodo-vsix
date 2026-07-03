/**
 * Kōdo VS Code extension — multi-session entry point.
 *
 * One VS Code window hosts MANY Kōdo sessions, each shown as a native editor
 * tab (a WebView panel) backed by its own WebSocket connection — see
 * {@link SessionController}. Lifecycle:
 *   1. Activation: discover/launch the singleton server, then open a session-
 *      less *control* WebSocket for window-global concerns (llama/model
 *      management, the cloud/local radio, the session picker). The sidebar is a
 *      view onto this control state.
 *   2. "Start new Kōdo session" / "Open Kōdo Panel": create a session tab. Each
 *      tab connects independently and is routed by its own session_id.
 *   3. Sticky tabs: a registerWebviewPanelSerializer restores open tabs on
 *      window reload / workspace reopen and resumes each from disk. Closed tabs
 *      are not restored (they are released and free for any window).
 *   4. Deactivation: disconnect every connection (the shared singleton server
 *      self-reaps once the last window leaves; we never kill it).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest, makeResponse } from './envelope';
import type { Envelope } from './envelope';
import { SidebarProvider } from './sidebar-provider';
import type { ModelInfo } from './sidebar-provider';
import { DEFAULT_PORT, ServerLauncher, readServerDiscovery } from './server-launcher';
import { WsClient } from './ws-client';
import { SessionController } from './session-controller';
import type { SessionDeps } from './session-controller';

const SERVER_STARTUP_DELAY_MS = 1_500;
// Mirrors _DEFAULT_USER_SETTINGS["models"]["local"] in kodo/server/_config.py.
const _DEFAULT_LOCAL_MODEL = 'llamacpp-qwen36-27b';

let extensionContext: vscode.ExtensionContext | null = null;
// Serial queue for api_key.request handling — at most one "enter key" dialog at
// a time; later requests for the same vendor find the stored key immediately.
let _apiKeyQueue: Promise<void> = Promise.resolve();

let launcher: ServerLauncher | null = null;
let wsUrl = '';
// Session-less control connection (sidebar / llama / picker). Held for the
// window's lifetime so the singleton stays up while the window is open.
let controlClient: WsClient | null = null;
let controlConnected = false;
let sidebarProvider: SidebarProvider | null = null;
let deactivating = false;

// Open session tabs in this window, keyed by the controller's internal key.
const sessions = new Map<string, SessionController>();

let projectRoot = '';
let physicalRoot = '';
let hasWorkspace = false;
let modeState: 'local' | 'cloud' = 'local';
// Stable per-window id (persisted) so the server lets this window reclaim its
// sessions after a reload within the disconnect grace window.
let windowId = '';

// ---------------------------------------------------------------------------
// Window-global control/LLM state (sidebar mirror)
// ---------------------------------------------------------------------------
let modelsState: ModelInfo[] = [];
let installedModelsState: string[] = [];
let activeLocalModelState = '';
let effectiveLocalModelState = '';
let llamaInstalledState = false;
let llamaVersionState = '';
let llamaInstallingState = false;
let llamaRunningState = false;
let llamaRunningModelState = '';
let llamaStartingState = false;
let llamaStoppingState = false;
let _llamaStartProgressResolve: (() => void) | null = null;
let installingModelsState: string[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  physicalRoot = projectRoot ? path.dirname(projectRoot) : '';
  hasWorkspace = projectRoot.length > 0;

  windowId = _stableWindowId(context);

  if (hasWorkspace) {
    const port = readServerDiscovery()?.port ?? DEFAULT_PORT;
    wsUrl = `ws://127.0.0.1:${port}/ws`;

    launcher = new ServerLauncher();
    controlClient = new WsClient(
      wsUrl,
      (env: Envelope) => handleControlEnvelope(env),
      (connected: boolean) => {
        controlConnected = connected;
        sidebarProvider?.update({ connected });
        if (connected) {
          sendControlHello();
        }
      },
    );

    launcher
      .launch(port)
      .then(() => {
        setTimeout(() => controlClient?.connect(), SERVER_STARTUP_DELAY_MS);
      })
      .catch(() => {
        // ensureKodoEnvironment already showed an error notification.
      });
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      hasWorkspace = newRoot.length > 0;
      if (newRoot) {
        projectRoot = newRoot;
        physicalRoot = path.dirname(newRoot);
      }
      sidebarProvider?.update({ hasWorkspace });
      for (const s of sessions.values()) {
        s.postWorkspaceStatus(hasWorkspace);
        s.pushWorkspaceFolders();
      }
    }),
  );

  modeState = _readMode();
  activeLocalModelState = _readActiveLocalModel();
  installedModelsState = _readInstalledModels();

  sidebarProvider = new SidebarProvider(
    {
      connected: controlConnected,
      hasWorkspace,
      stage: 'IDLE',
      mode: modeState,
      models: modelsState,
      installedModels: installedModelsState,
      activeLocalModel: activeLocalModelState,
      effectiveLocalModel: effectiveLocalModelState,
      llamaInstalled: llamaInstalledState,
      llamaVersion: llamaVersionState,
      llamaInstalling: llamaInstallingState,
      llamaRunning: llamaRunningState,
      llamaRunningModel: llamaRunningModelState,
      llamaStarting: llamaStartingState,
      llamaStopping: llamaStoppingState,
      installingModels: installingModelsState,
    },
    (msg) => {
      if (msg.type === 'list_sessions') {
        void pickSession();
      } else if (msg.type === 'new_session') {
        newSession();
      } else if (msg.type === 'set_mode') {
        _setMode(msg.mode);
      } else if (msg.type === 'set_active_model') {
        _setActiveLocalModel(msg.name);
      } else if (msg.type === 'start_llamacpp') {
        _startLlamaCpp();
      } else if (msg.type === 'stop_llamacpp') {
        llamaStoppingState = true;
        sidebarProvider?.update({ llamaStopping: true });
        _sendControl(makeRequest('llama.stop'));
      } else if (msg.type === 'install_llamacpp') {
        _installLlamaCpp();
      } else if (msg.type === 'install_model') {
        _installModel(msg.name);
      }
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('kodo.view', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewPanelSerializer('kodoPanel', {
      // Sticky tabs: VS Code persists every open panel and restores it on
      // reload / workspace reopen. The webview stashed its session_id via
      // setState; we adopt the restored panel and resume that exact session.
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
        const sid = state && typeof state === 'object' ? String((state as Record<string, unknown>).sessionId ?? '') : '';
        adoptPanel(panel, sid);
      },
    }),
    vscode.commands.registerCommand('kodo.openPanel', () => openPanel()),
    vscode.commands.registerCommand('kodo.newSession', () => newSession()),
    vscode.commands.registerCommand('kodo.createProject', () => createProject()),
    vscode.commands.registerCommand('kodo.useCloudLLMs', () => _setMode('cloud')),
    vscode.commands.registerCommand('kodo.useLocalLLM', () => _setMode('local')),
    vscode.commands.registerCommand('kodo.pickSession', () => pickSession()),
  );
}

export function deactivate(): void {
  // Window reload / close: disconnect everything WITHOUT releasing sessions —
  // the serializer restores open tabs and the disconnect grace lets this window
  // reclaim+resume them. The shared singleton self-reaps once all windows leave.
  deactivating = true;
  for (const s of sessions.values()) {
    s.dispose();
  }
  sessions.clear();
  controlClient?.dispose();
  controlClient = null;
  launcher = null;
  sidebarProvider = null;
}

// ---------------------------------------------------------------------------
// Session tabs
// ---------------------------------------------------------------------------

function _sessionDeps(): SessionDeps {
  return {
    context: extensionContext!,
    windowId,
    wsUrl,
    getPhysicalRoot: () => physicalRoot,
    getProjectRoot: () => projectRoot,
    hasWorkspace: () => hasWorkspace,
    buildFolderMap: _buildFolderMap,
    pickProject,
    addWorkspaceFolder,
    handleApiKeyRequest: (vendor, requestId, send) => {
      _apiKeyQueue = _apiKeyQueue.then(() => _handleApiKeyRequest(vendor, requestId, send));
    },
    onSessionAssigned: (_c, sessionId) => _rememberOpenSession(sessionId),
    onLlamaState: _applyLlamaState,
    onClosed: (c) => {
      sessions.delete(c.key);
      // A real user close (or delete, or a session_in_use bounce) means this
      // window should NOT auto-reopen the session next activation. On window
      // reload/teardown `deactivating` is set and the list must survive intact.
      if (!deactivating && c.sessionId) {
        _forgetOpenSession(c.sessionId);
      }
    },
    isDeactivating: () => deactivating,
  };
}

/** Find an open tab already driving this session id, if any. */
function _findBySessionId(sessionId: string): SessionController | undefined {
  for (const s of sessions.values()) {
    if (s.sessionId === sessionId) {
      return s;
    }
  }
  return undefined;
}

/** Find the foreground session tab with a ready connection, if any. */
function _findActiveSession(): SessionController | undefined {
  for (const s of sessions.values()) {
    if (s.isActiveAndReady) {
      return s;
    }
  }
  return undefined;
}

function _createPanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel('kodoPanel', 'Kōdo', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(extensionContext!.extensionPath, 'dist'))],
  });
}

/** Open a blank session (interactive + problem-solving) in a new tab. */
function newSession(): void {
  if (!hasWorkspace) {
    void vscode.window.showInformationMessage('Kōdo: open a workspace first.');
    return;
  }
  const controller = new SessionController(_sessionDeps(), _createPanel(), '');
  sessions.set(controller.key, controller);
}

/** Reveal the most recent open session, or start a new one if none are open. */
function openPanel(): void {
  const last = [...sessions.values()].pop();
  if (last) {
    last.reveal();
  } else {
    newSession();
  }
}

/** Open an existing session id in a tab (revealing it if already open). */
function openExistingSession(sessionId: string): void {
  const existing = _findBySessionId(sessionId);
  if (existing) {
    existing.reveal();
    return;
  }
  const controller = new SessionController(_sessionDeps(), _createPanel(), sessionId);
  sessions.set(controller.key, controller);
}

/** Adopt a panel restored by the webview serializer (reload / reopen). */
function adoptPanel(panel: vscode.WebviewPanel, sessionId: string): void {
  if (sessionId && _findBySessionId(sessionId)) {
    // Already restored elsewhere — drop the duplicate.
    panel.dispose();
    return;
  }
  const controller = new SessionController(_sessionDeps(), panel, sessionId);
  sessions.set(controller.key, controller);
}

// ---------------------------------------------------------------------------
// Per-window open-session memory (globalState) + reopen reconciliation
//
// The webview-panel serializer is the primary restore path, but its state
// lives in *workspace* storage — and the `create_new_project` flow reloads the
// window into a brand-new untitled multi-root workspace whose storage is
// empty, so the serializer restores nothing and a mid-turn session is
// stranded on the server (evidenced: after such a reload only the control
// socket reconnects; no session hello ever arrives). globalState is
// per-extension (workspace-independent), so a list of this window's open
// sessions keyed by the stable windowId survives that transition. After the
// control connection's hello.ack we reconcile: any remembered session that is
// still on the server, not open here, and not live in another window gets its
// tab reopened (and reconnects mid-turn via the server's channel replay).
// ---------------------------------------------------------------------------

function _openSessionsKey(): string {
  return `kodo.openSessions.${windowId}`;
}

function _rememberedOpenSessions(): string[] {
  const raw = extensionContext?.globalState.get<string[]>(_openSessionsKey());
  return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string' && v !== '') : [];
}

function _rememberOpenSession(sessionId: string): void {
  const list = _rememberedOpenSessions();
  if (!list.includes(sessionId)) {
    list.push(sessionId);
    void extensionContext?.globalState.update(_openSessionsKey(), list);
  }
}

function _forgetOpenSession(sessionId: string): void {
  const list = _rememberedOpenSessions();
  if (list.includes(sessionId)) {
    void extensionContext?.globalState.update(
      _openSessionsKey(),
      list.filter((id) => id !== sessionId),
    );
  }
}

let _reconciledOpenSessions = false;

/**
 * Count native `kodoPanel` tabs in this window, including ones VS Code has not
 * deserialized yet. Per the `WebviewPanelSerializer` docs, `deserializeWebviewPanel`
 * fires only when "a serialized webview first becomes visible" — at startup that
 * means the foreground tab is revived immediately but background sticky tabs sit
 * as inert placeholders (already showing their cached title/icon) until clicked.
 * `tabGroups.all` reflects those placeholders too, since the tab strip is
 * layout state independent of the extension host's webview objects — so this
 * count can exceed `sessions.size` even though no duplicate exists yet.
 */
function _kodoPanelTabCount(): number {
  let count = 0;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('kodoPanel')) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Reopen this window's remembered sessions that did not come back through the
 * panel serializer. Runs once, after the control connection is up (so
 * `session.list` is answerable). Serializer-restored tabs are skipped via
 * `_findBySessionId`; the reverse race is covered by `adoptPanel`'s duplicate
 * check. Remembered ids that no longer exist on the server, or that are now
 * live in another window, are pruned instead of reopened.
 *
 * Guard: a background sticky tab that VS Code hasn't revived yet (see
 * `_kodoPanelTabCount`) looks identical to a genuinely lost tab — `sessions`
 * has no controller for it either way. Racing ahead and opening a new tab for
 * it creates a real duplicate: the reconcile-made tab wins the connection, and
 * the original tab, once the user finally clicks it, deserializes, loses the
 * `_findBySessionId` duplicate check in `adoptPanel`, and disposes itself —
 * which reads to the user as "a duplicate tab that vanishes when clicked."
 * So when there are more native `kodoPanel` tabs than adopted sessions, some
 * remembered ids are presumably still-pending placeholders; skip reconciling
 * this round rather than guess which ones are real vs. actually lost (the
 * `create_new_project` reload this exists for leaves zero native tabs behind,
 * so it is unaffected by this guard).
 */
async function _reconcileOpenSessions(): Promise<void> {
  if (_reconciledOpenSessions) {
    return;
  }
  _reconciledOpenSessions = true;
  const remembered = _rememberedOpenSessions();
  if (remembered.length === 0) {
    return;
  }
  const notYetAdopted = remembered.filter((id) => !_findBySessionId(id));
  if (notYetAdopted.length === 0) {
    return;
  }
  if (_kodoPanelTabCount() > sessions.size) {
    return; // some native tabs are still un-revived placeholders — don't guess
  }
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('session.list');
  } catch {
    return; // server unreachable — leave the list for the next activation
  }
  const list = Array.isArray(resp.sessions) ? (resp.sessions as Record<string, unknown>[]) : [];
  const byId = new Map(list.map((s) => [String(s.id ?? ''), s]));
  for (const id of notYetAdopted) {
    if (_findBySessionId(id)) {
      continue; // serializer restored this tab while session.list was in flight
    }
    const info = byId.get(id);
    if (!info || Boolean(info.taken)) {
      _forgetOpenSession(id); // deleted, or now owned by a live window
      continue;
    }
    openExistingSession(id);
  }
}

// ---------------------------------------------------------------------------
// Create project + Guided project picker
// ---------------------------------------------------------------------------

/**
 * Scaffold a new (or existing, picked) folder as a Kōdo project. Delegates the
 * actual filesystem work to the server's `project.create` message — the same
 * `WorkflowEngine.__create_project` path backing the LLM-facing
 * `create_new_project` tool — so the resulting layout (`specs/`, `src/`,
 * `test/`, `.kodo/kodo.md`) always matches. Requires an open, foreground
 * session tab to route the request through (the server scaffolds relative to
 * that session's engine and pushes `workspace.add_folder` back over its
 * socket).
 */
async function createProject(): Promise<string | null> {
  const active = _findActiveSession();
  if (!active) {
    vscode.window.showErrorMessage(
      'Kōdo: open a session tab before creating a project, then try again.',
    );
    return null;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select project folder',
    title: 'Kōdo: Select or create a project folder',
  });

  if (!picked || picked.length === 0) {
    return null;
  }

  const root = picked[0].fsPath;
  const kodoMd = path.join(root, '.kodo', 'kodo.md');

  let force = false;
  if (fs.existsSync(kodoMd)) {
    const choice = await vscode.window.showWarningMessage(
      `${kodoMd} already exists. Overwrite?`,
      'Overwrite',
      'Cancel',
    );
    if (choice !== 'Overwrite') {
      return null;
    }
    force = true;
  }

  try {
    const resp = await active.createProject({ path: root, force });
    if (resp.type === 'project.create.error' || resp.type === 'error') {
      const message = String(resp.message ?? 'unknown error');
      vscode.window.showErrorMessage(`Kōdo: Init Project failed — ${message}`);
      return null;
    }

    const doc = await vscode.workspace.openTextDocument(kodoMd);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(`Kōdo project initialised at ${root}`);
    return root;
  } catch (err) {
    vscode.window.showErrorMessage(`Kōdo: Init Project failed — ${String(err)}`);
    return null;
  }
}

/**
 * Add a directory the server has just scaffolded — via the `create_new_project`
 * tool or the "Create Project" command's `project.create` message — to the
 * open workspace. The folder already exists on disk; this only registers it
 * as a VS Code workspace folder, so the agent's subsequent file edits are
 * visible and the extension re-pushes `workspace.folders` to the server.
 * No-op when the folder is already part of the workspace.
 */
function addWorkspaceFolder(folderPath: string, name: string): void {
  const folderUri = vscode.Uri.file(folderPath);
  const alreadyInWorkspace =
    vscode.workspace.workspaceFolders?.some((f) => f.uri.fsPath === folderUri.fsPath) ?? false;
  if (alreadyInWorkspace) {
    return;
  }
  const insertAt = vscode.workspace.workspaceFolders?.length ?? 0;
  vscode.workspace.updateWorkspaceFolders(
    insertAt,
    0,
    name ? { uri: folderUri, name } : { uri: folderUri },
  );
}

async function pickProject(): Promise<{ root: string; name: string } | null> {
  const folderMap = _buildFolderMap();
  const _CREATE = '$(add) Create new project…';
  const items: vscode.QuickPickItem[] = Object.entries(folderMap)
    .filter(([, fsPath]) => fs.existsSync(path.join(fsPath, '.kodo', 'kodo.md')))
    .map(([name, fsPath]) => ({ label: name, description: fsPath }));
  items.push({ label: _CREATE, description: 'Initialise a new Kōdo project folder' });

  const choice = await vscode.window.showQuickPick(items, {
    title: 'Kōdo: Choose the project for this Guided Development session',
    placeHolder: 'This choice is fixed for the whole session and cannot be changed afterwards.',
    ignoreFocusOut: true,
  });
  if (!choice) {
    return null;
  }

  let root: string;
  let name: string;
  if (choice.label === _CREATE) {
    const created = await createProject();
    if (created === null) {
      return null;
    }
    root = created;
    name = path.basename(created);
  } else {
    root = choice.description ?? '';
    name = choice.label;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Guided Development mode will be locked to "${name}" for this session. ` +
      'You cannot change the project until you start a new session. Continue?',
    { modal: true },
    'Lock project',
  );
  if (confirm !== 'Lock project') {
    return null;
  }
  return { root, name };
}

// ---------------------------------------------------------------------------
// Session picker (cross-window open gate, over the control connection)
// ---------------------------------------------------------------------------

interface SessionPickItem extends vscode.QuickPickItem {
  sessionId?: string;
  isNew?: boolean;
  disabledReason?: string;
}

/** Render an ISO-8601 timestamp as a short local date/time, or "unknown". */
function formatTimestamp(iso: string): string {
  if (!iso) {
    return 'unknown';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function pickSession(): Promise<void> {
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('session.list');
  } catch {
    void vscode.window.showErrorMessage('Kōdo: could not reach the server to list sessions.');
    return;
  }
  const list = Array.isArray(resp.sessions) ? (resp.sessions as Record<string, unknown>[]) : [];
  const loaded = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

  const items: SessionPickItem[] = [
    { label: '$(add) New session', isNew: true, detail: 'Start a fresh session in this window' },
  ];
  for (const s of list) {
    const id = String(s.id ?? '');
    const name = String(s.name ?? id);
    const root = typeof s.project_root === 'string' ? s.project_root : null;
    const taken = Boolean(s.taken);
    const openHere = _findBySessionId(id) !== undefined;

    let disabledReason: string | undefined;
    if (taken && !openHere) {
      disabledReason = 'Opened in another window';
    } else if (root && !loaded.includes(root)) {
      disabledReason = 'Guided Development project is not loaded into current workspace';
    }

    const kindLabel = root ? `Guided · ${path.basename(root)}` : 'Problem solving';
    const created = typeof s.created_at === 'string' ? s.created_at : '';
    const lastModified = typeof s.last_modified === 'string' ? s.last_modified : '';
    const timeLabel = `created ${formatTimestamp(created)}, last modified ${formatTimestamp(lastModified)}`;
    items.push({
      label: (disabledReason ? '$(circle-slash) ' : '$(comment-discussion) ') + name,
      description: openHere ? `${kindLabel} · (opened here)` : kindLabel,
      detail: disabledReason ? `${disabledReason} · ${timeLabel}` : timeLabel,
      sessionId: id,
      disabledReason,
    });
  }

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Open a Kōdo session',
    matchOnDetail: true,
  });
  if (!choice) {
    return;
  }
  if (choice.disabledReason) {
    void vscode.window.showInformationMessage(`Cannot open this session: ${choice.disabledReason}.`);
    return pickSession();
  }
  if (choice.isNew) {
    newSession();
    return;
  }
  if (choice.sessionId) {
    openExistingSession(choice.sessionId);
  }
}

// ---------------------------------------------------------------------------
// Control connection (window-global: llama / model / picker)
// ---------------------------------------------------------------------------

function sendControlHello(): void {
  _sendControl(
    makeRequest('hello', { client: 'vsix', version: '0.2.0', window_id: windowId, role: 'control' }),
  );
}

function _sendControl(env: Envelope): void {
  controlClient?.send(env);
}

// Pending control request/response round-trips (e.g. session.list).
const _pendingControl = new Map<string, (payload: Record<string, unknown>) => void>();

function sendControlAwait(
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const env = makeRequest(type, payload);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingControl.delete(env.id);
      reject(new Error(`Timed out waiting for ${type} response`));
    }, timeoutMs);
    _pendingControl.set(env.id, (p) => {
      clearTimeout(timer);
      resolve(p);
    });
    _sendControl(env);
  });
}

/**
 * Apply an `llama.state` event to the window-global sidebar mirror + progress
 * UI. Called both from the control connection (explicit Start/Stop buttons) and
 * — crucially — from any session connection, because llama.cpp is auto-started
 * inside an engine run, which emits this event on that *session's* socket, not
 * the control socket. Without the session-side forward the "starting…"
 * notification and the sidebar's running state are lost on a prompt-triggered
 * launch. The llama server is a window-wide singleton, so these updates are
 * idempotent no matter which connection delivers them.
 */
function _applyLlamaState(payload: Record<string, unknown>): void {
  if (Boolean(payload.starting)) {
    llamaStartingState = true;
    llamaRunningState = false;
    sidebarProvider?.update({ llamaStarting: true, llamaRunning: false });
    if (_llamaStartProgressResolve === null) {
      vscode.window
        .withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'llama.cpp is starting…', cancellable: false },
          () => new Promise<void>((resolve) => { _llamaStartProgressResolve = resolve; }),
        )
        .then(undefined, () => undefined);
    }
    return;
  }

  llamaRunningState = Boolean(payload.running);
  llamaRunningModelState =
    llamaRunningState && typeof payload.model === 'string' ? payload.model : '';
  llamaStartingState = false;
  llamaStoppingState = false;

  const errMsg = typeof payload.error === 'string' ? payload.error : '';
  if (errMsg) {
    vscode.window.showErrorMessage(`Kōdo: llama-server — ${errMsg}`);
    _llamaStartProgressResolve?.();
    _llamaStartProgressResolve = null;
  } else if (llamaRunningState) {
    const port = Number(payload.port ?? 8080);
    _llamaStartProgressResolve?.();
    _llamaStartProgressResolve = null;
    vscode.window.showInformationMessage(`Kōdo: llama.cpp is running on localhost:${port}`);
  }

  sidebarProvider?.update({
    llamaRunning: llamaRunningState,
    llamaRunningModel: llamaRunningModelState,
    llamaStarting: false,
    llamaStopping: false,
  });
}

function handleControlEnvelope(env: Envelope): void {
  if (env.kind === 'response' && env.correlation_id) {
    const resolver = _pendingControl.get(env.correlation_id);
    if (resolver) {
      _pendingControl.delete(env.correlation_id);
      resolver(env.payload);
      return;
    }
  }

  const evtType = String(env.payload.type ?? '');

  if (env.kind === 'response' && evtType === 'hello.ack') {
    const raw = env.payload.models;
    if (Array.isArray(raw)) {
      modelsState = raw as ModelInfo[];
    }
    llamaInstalledState = Boolean(env.payload.llama_installed);
    llamaVersionState = typeof env.payload.llama_version === 'string' ? env.payload.llama_version : '';
    llamaRunningState = Boolean(env.payload.llama_running);
    llamaRunningModelState =
      llamaRunningState && typeof env.payload.llama_model === 'string' ? env.payload.llama_model : '';
    sidebarProvider?.update({
      models: modelsState,
      installedModels: installedModelsState,
      effectiveLocalModel: effectiveLocalModelState,
      llamaInstalled: llamaInstalledState,
      llamaVersion: llamaVersionState,
      llamaRunning: llamaRunningState,
      llamaRunningModel: llamaRunningModelState,
    });
    // The server is provably reachable now — reopen any of this window's
    // sessions that the panel serializer could not restore (see the
    // open-session memory block above).
    void _reconcileOpenSessions();
    return;
  }

  if (env.kind === 'event' && evtType === 'llama.state') {
    _applyLlamaState(env.payload);
    return;
  }

  if (env.kind === 'event' && evtType === 'model.install.progress') {
    _onModelInstallProgress(String(env.payload.name ?? ''), Number(env.payload.percent ?? 0), String(env.payload.message ?? ''));
    return;
  }

  if (env.kind === 'event' && evtType === 'llamacpp.install.progress') {
    _onLlamaProgress(Number(env.payload.percent ?? 0), String(env.payload.message ?? ''));
    return;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * A window id that is STABLE across reloads of the same window — including the
 * reload caused by the workspace itself changing shape.
 *
 * The server uses this id to let a briefly-disconnected window reclaim its
 * sessions within the 5s grace (SessionManager.open refuses a *different*
 * window), and per-window session bookkeeping (globalState reopen list,
 * owner.json) is keyed by it. A reload must therefore present the same id the
 * window held before.
 *
 * The id must be DERIVED, never stored per-workspace: `workspaceState` is
 * per-workspace storage, and the `create_new_project` flow converts a
 * single-folder window into an *untitled multi-root workspace* — a brand-new
 * workspace identity with empty storage (this is exactly how the id used to
 * change on every such reload, breaking session reclaim). For the same reason
 * the key must be the FIRST workspace folder, not `workspaceFile` and not the
 * folder *set*: that transition mints an `untitled:` workspaceFile and appends
 * the new folder, but folders[0] — the folder the window was opened on —
 * survives it (both `addWorkspaceFolder` here and VS Code's own "Add Folder to
 * Workspace" append at the end).
 *
 * Trade-off: two windows whose workspaces share the same first folder would
 * collide (VS Code refuses to open the *same* workspace twice, but a folder
 * can also appear first in a .code-workspace opened elsewhere). That is far
 * rarer than the workspace-shape transition this must survive. Only a truly
 * folder-less window (which cannot host sessions anyway) falls back to a
 * persisted random id.
 */
function _stableWindowId(context: vscode.ExtensionContext): string {
  const firstFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const key = firstFolder ?? vscode.workspace.workspaceFile?.fsPath;
  if (key) {
    return 'w-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  }
  const existing = context.workspaceState.get<string>('kodo.windowId');
  if (existing) {
    return existing;
  }
  const id = _newId();
  void context.workspaceState.update('kodo.windowId', id);
  return id;
}

function _kodoHomeDir(): string {
  return path.join(os.homedir(), '.kodo');
}

function _settingsPath(): string {
  return path.join(_kodoHomeDir(), 'settings.json');
}

function _readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(_settingsPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Merge a patch into the global ~/.kodo/settings.json, preserving other keys. */
function _writeSettings(patch: Record<string, unknown>): void {
  const settings = _readSettings();
  Object.assign(settings, patch);
  fs.mkdirSync(_kodoHomeDir(), { recursive: true });
  fs.writeFileSync(_settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

/** Logical-root folder map: VS-Code-disambiguated name → physical path. */
function _buildFolderMap(): Record<string, string> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const byName = new Map<string, vscode.WorkspaceFolder[]>();
  for (const f of folders) {
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }
  const map: Record<string, string> = {};
  for (const [name, list] of byName) {
    if (list.length === 1) {
      map[name] = list[0].uri.fsPath;
    } else {
      for (const f of list) {
        const parent = path.basename(path.dirname(f.uri.fsPath));
        map[`${name} (${parent})`] = f.uri.fsPath;
      }
    }
  }
  return map;
}

function _readMode(): 'local' | 'cloud' {
  return _readSettings()['mode'] === 'cloud' ? 'cloud' : 'local';
}

function _readActiveLocalModel(): string {
  const models = _readSettings()['models'] as Record<string, unknown> | undefined;
  return typeof models?.['local'] === 'string' ? models['local'] : _DEFAULT_LOCAL_MODEL;
}

function _readInstalledModels(): string[] {
  try {
    const indexPath = path.join(os.homedir(), '.kodo', 'local-llm-index.json');
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
    return Object.keys(parsed).filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '');
  } catch {
    return [];
  }
}

let _llamaProgressReporter: vscode.Progress<{ message?: string; increment?: number }> | null = null;
let _llamaProgressResolve: (() => void) | null = null;
let _llamaProgressReject: ((err: Error) => void) | null = null;
let _llamaLastPct = 0;

function _installLlamaCpp(): void {
  if (llamaInstallingState) { return; }
  llamaInstallingState = true;
  sidebarProvider?.update({ llamaInstalling: true });
  _sendControl(makeRequest('llamacpp.install'));

  vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Installing llama.cpp', cancellable: false },
      (progress) =>
        new Promise<void>((resolve, reject) => {
          _llamaProgressReporter = progress;
          _llamaProgressResolve = resolve;
          _llamaProgressReject = reject;
          _llamaLastPct = 0;
        }),
    )
    .then(undefined, () => undefined);
}

function _onLlamaProgress(pct: number, msg: string): void {
  if (_llamaProgressReporter) {
    const increment = Math.max(0, pct - _llamaLastPct);
    _llamaLastPct = pct;
    _llamaProgressReporter.report({ message: `${pct}%  ${msg}`, increment });
  }

  if (pct === 100) {
    llamaInstallingState = false;
    llamaInstalledState = true;
    sidebarProvider?.update({ llamaInstalling: false, llamaInstalled: true });
    setTimeout(() => {
      _llamaProgressResolve?.();
      _llamaProgressReporter = null;
      _llamaProgressResolve = null;
      _llamaProgressReject = null;
    }, 1000);
  } else if (pct < 0) {
    llamaInstallingState = false;
    sidebarProvider?.update({ llamaInstalling: false });
    vscode.window.showErrorMessage(`llama.cpp installation failed: ${msg}`);
    _llamaProgressReject?.(new Error(msg));
    _llamaProgressReporter = null;
    _llamaProgressResolve = null;
    _llamaProgressReject = null;
  }
}

function _startLlamaCpp(): void {
  if (llamaStartingState) { return; }
  const isRestart = llamaRunningState;
  const notifTitle = isRestart ? 'llama.cpp is restarting…' : 'llama.cpp is starting…';

  llamaStartingState = true;
  llamaRunningState = false;
  sidebarProvider?.update({ llamaRunning: false, llamaStarting: true });
  _sendControl(makeRequest('llama.start'));

  vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title: notifTitle, cancellable: false },
      () => new Promise<void>((resolve) => { _llamaStartProgressResolve = resolve; }),
    )
    .then(undefined, () => undefined);
}

const _modelProgressResolvers = new Map<string, () => void>();

function _installModel(name: string): void {
  if (installingModelsState.includes(name)) { return; }
  installingModelsState = [...installingModelsState, name];
  sidebarProvider?.update({ installingModels: installingModelsState });
  _sendControl(makeRequest('model.install', { name }));

  vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Downloading ${name}…`, cancellable: false },
      () => new Promise<void>((resolve) => { _modelProgressResolvers.set(name, resolve); }),
    )
    .then(undefined, () => undefined);
}

function _onModelInstallProgress(name: string, pct: number, msg: string): void {
  if (pct === 100) {
    installingModelsState = installingModelsState.filter((n) => n !== name);
    installedModelsState = _readInstalledModels();
    sidebarProvider?.update({ installingModels: installingModelsState, installedModels: installedModelsState });
    setTimeout(() => {
      _modelProgressResolvers.get(name)?.();
      _modelProgressResolvers.delete(name);
      vscode.window.showInformationMessage(`Kōdo: ${name} downloaded and ready.`);
    }, 1000);
  } else if (pct < 0) {
    installingModelsState = installingModelsState.filter((n) => n !== name);
    sidebarProvider?.update({ installingModels: installingModelsState });
    _modelProgressResolvers.get(name)?.();
    _modelProgressResolvers.delete(name);
    vscode.window.showErrorMessage(`Kōdo: model installation failed — ${msg}`);
  }
}

function _setActiveLocalModel(name: string): void {
  const models = (_readSettings()['models'] as Record<string, unknown> | undefined) ?? {};
  models['local'] = name;
  _writeSettings({ models });
  _sendControl(makeRequest('config.reload'));
  activeLocalModelState = name;
  sidebarProvider?.update({ activeLocalModel: name });
}

function _setMode(mode: 'cloud' | 'local'): void {
  _writeSettings({ mode });
  _sendControl(makeRequest('config.reload'));
  modeState = mode;
  sidebarProvider?.update({ mode });
  const label = mode === 'cloud' ? 'cloud AI (API key required)' : 'local AI via llama.cpp';
  vscode.window.showInformationMessage(`Kōdo: switched to ${label}.`);
}

// ---------------------------------------------------------------------------
// SecretStorage: per-vendor API key management (shared across sessions)
// ---------------------------------------------------------------------------

async function _handleApiKeyRequest(
  vendor: string,
  requestId: string,
  send: (env: Envelope) => void,
): Promise<void> {
  if (!extensionContext) {
    return;
  }
  const secretKey = `kodo.apiKey.${vendor}`;

  const stored = await extensionContext.secrets.get(secretKey);
  if (stored) {
    send(makeResponse(requestId, { api_key: stored }));
    return;
  }

  const entered = await vscode.window.showInputBox({
    title: `Kōdo: API key required`,
    prompt: `Enter the API key for ${vendor}`,
    password: true,
    placeHolder: `${vendor} API key`,
    ignoreFocusOut: true,
  });

  if (!entered?.trim()) {
    vscode.window.showErrorMessage(
      `Kōdo: prompt not sent. A ${vendor} API key is required to use cloud-based LLM. ` +
        'Alternatively, you can configure Kōdo to use a local model running on your machine (e.g., llama.cpp).',
    );
    send(makeResponse(requestId, { error: 'cancelled' }));
    return;
  }

  await extensionContext.secrets.store(secretKey, entered.trim());
  send(makeResponse(requestId, { api_key: entered.trim() }));
}
