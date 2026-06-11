/**
 * Kōdo VS Code extension — M3 entry point.
 *
 * Lifecycle:
 *   1. Activation: pick a free loopback port, launch kodo-server bound to it,
 *      open a persistent WebSocket client.
 *   2. The WS client runs for the lifetime of the VS Code window — even when
 *      the Kōdo panel is closed. State updates flow into an in-memory cache
 *      maintained by the extension host.
 *   3. "Kōdo: Open Panel" command: create/reveal the WebView panel, which
 *      is a view onto the cached state (rehydrated on first mount).
 *   4. "Kōdo: Init Project" command: create kodo.md + src/ + gen/ + .kodo/
 *      in the workspace root.
 *   5. Deactivation: dispose WS client and server subprocess.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest, makeResponse } from './envelope';
import type { Envelope } from './envelope';
import { SidebarProvider } from './sidebar-provider';
import type { ModelInfo } from './sidebar-provider';
import { ServerLauncher } from './server-launcher';
import { WsClient } from './ws-client';

const SERVER_STARTUP_DELAY_MS = 1_500;
const TOKEN_BUFFER_MAX = 64 * 1024; // soft cap on cached stream text

let extensionContext: vscode.ExtensionContext | null = null;
// Serial queue for api_key.request handling — ensures at most one "enter key"
// dialog is shown at a time; subsequent requests for the same vendor will find
// the key in SecretStorage once the first completes.
let _apiKeyQueue: Promise<void> = Promise.resolve();

let launcher: ServerLauncher | null = null;
let wsClient: WsClient | null = null;
let panel: vscode.WebviewPanel | null = null;
let sidebarProvider: SidebarProvider | null = null;
let projectRoot = '';
let hasWorkspace = false;
let modeState: 'local' | 'cloud' = 'local';

// ---------------------------------------------------------------------------
// Persistent state owned by the extension host
// ---------------------------------------------------------------------------
let connState = false;
let stageState = 'IDLE';
let tokensState = '';
let lastPromptState = '';
let agentState: string | null = null;
let usageState: UsageSummary = { cumulativeUsd: 0, lastCallTokens: null };
let fileEventsState: FileEventData[] = [];
let pendingGateState: GateData | null = null;
let autonomousState = false;
let resumeSessionId: string | null = null;
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

interface UsageSummary {
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  hasWorkspace = projectRoot.length > 0;

  if (hasWorkspace) {
    const port = await findFreePort();
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    launcher = new ServerLauncher();

    wsClient = new WsClient(
      wsUrl,
      (env: Envelope) => handleServerEnvelope(env),
      (connected: boolean) => {
        connState = connected;
        panel?.webview.postMessage({ type: 'status', connected });
        sidebarProvider?.update({ connected });
        if (connected) {
          sendHello();
        }
      },
    );

    // Launch runs uv/venv/install setup before spawning the subprocess.
    // Only connect the WebSocket once the subprocess is actually running.
    launcher.launch(projectRoot, port).then(() => {
      setTimeout(() => wsClient?.connect(), SERVER_STARTUP_DELAY_MS);
    }).catch(() => {
      // ensureKodoEnvironment already showed an error notification; nothing more to do.
    });
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      hasWorkspace = newRoot.length > 0;
      if (newRoot) { projectRoot = newRoot; }
      sidebarProvider?.update({ hasWorkspace });
      panel?.webview.postMessage({ type: 'workspace_status', hasWorkspace });
    }),
  );

  modeState = _readMode();
  activeLocalModelState = _readActiveLocalModel();
  installedModelsState = _readInstalledModels();

  sidebarProvider = new SidebarProvider(
    {
      connected: connState,
      hasWorkspace,
      stage: stageState,
      autonomous: autonomousState,
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
      if (msg.type === 'open_panel') {
        openPanel(context);
      } else if (msg.type === 'set_mode') {
        _setMode(msg.mode);
      } else if (msg.type === 'toggle_autonomous') {
        autonomousState = !autonomousState;
        wsClient?.send(makeRequest('mode.set', { autonomous: autonomousState }));
        sidebarProvider?.update({ autonomous: autonomousState });
      } else if (msg.type === 'set_active_model') {
        _setActiveLocalModel(msg.name);
      } else if (msg.type === 'start_llamacpp') {
        _startLlamaCpp();
      } else if (msg.type === 'stop_llamacpp') {
        llamaStoppingState = true;
        sidebarProvider?.update({ llamaStopping: true });
        wsClient?.send(makeRequest('llama.stop'));
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
    vscode.commands.registerCommand('kodo.openPanel', () =>
      openPanel(context),
    ),
    vscode.commands.registerCommand('kodo.createProject', () =>
      createProject(),
    ),
    vscode.commands.registerCommand('kodo.useCloudLLMs', () =>
      _setMode('cloud'),
    ),
    vscode.commands.registerCommand('kodo.useLocalLLM', () =>
      _setMode('local'),
    ),
  );
}

export function deactivate(): void {
  wsClient?.dispose();
  wsClient = null;
  launcher?.dispose();
  launcher = null;
  panel = null;
  sidebarProvider = null;
}

// ---------------------------------------------------------------------------
// Init Project (FR-VSIX-05)
// ---------------------------------------------------------------------------

async function createProject(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select project folder',
    title: 'Kōdo: Select or create a project folder',
  });

  if (!picked || picked.length === 0) {
    return;
  }

  const root = picked[0].fsPath;
  const kodoMd = path.join(root, 'kodo.md');

  if (fs.existsSync(kodoMd)) {
    const choice = await vscode.window.showWarningMessage(
      `${kodoMd} already exists. Overwrite?`,
      'Overwrite',
      'Cancel',
    );
    if (choice !== 'Overwrite') {
      return;
    }
  }

  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'gen'), { recursive: true });
    fs.mkdirSync(path.join(root, '.kodo', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(root, '.kodo', 'sessions'), { recursive: true });

    const template = [
      '# Kodo Project',
      '',
      '> Project marker. Required.',
      '',
      '## Toolchain',
      '',
      '- python',
      '',
      '## Components',
      '',
      '(empty until Architect runs; agents append entries)',
      '',
      '## Settings overrides',
      '',
      '(optional inline overrides; structured-but-prose)',
      '',
    ].join('\n');

    fs.writeFileSync(kodoMd, template, 'utf8');

    const folderUri = vscode.Uri.file(root);
    const alreadyInWorkspace = vscode.workspace.workspaceFolders?.some(
      (f) => f.uri.fsPath === folderUri.fsPath,
    ) ?? false;
    if (!alreadyInWorkspace) {
      const insertAt = vscode.workspace.workspaceFolders?.length ?? 0;
      vscode.workspace.updateWorkspaceFolders(insertAt, 0, { uri: folderUri });
    }

    const doc = await vscode.workspace.openTextDocument(kodoMd);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(`Kōdo project initialised at ${root}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Kōdo: Init Project failed — ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function openPanel(context: vscode.ExtensionContext): void {
  if (panel !== null) {
    panel.reveal(vscode.ViewColumn.One);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'kodoPanel',
    'Kōdo',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'dist')),
      ],
    },
  );

  const webviewJsUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'dist', 'webview.js')),
  );

  const nonce = generateNonce();
  panel.webview.html = buildHtml(webviewJsUri, nonce);

  panel.webview.onDidReceiveMessage((msg: Record<string, unknown>) => {
    if (msg.type === 'ready') {
      // Rehydrate from persistent state
      panel?.webview.postMessage({ type: 'workspace_status', hasWorkspace });
      panel?.webview.postMessage({ type: 'status', connected: connState });
      panel?.webview.postMessage({ type: 'stage', stage: stageState, agent: agentState });
      if (lastPromptState.length > 0) {
        panel?.webview.postMessage({ type: 'restore_prompt', text: lastPromptState });
      }
      if (tokensState.length > 0) {
        panel?.webview.postMessage({ type: 'token', text: tokensState });
      }
      panel?.webview.postMessage({ type: 'usage', ...usageState });
      for (const fe of fileEventsState) {
        panel?.webview.postMessage({ type: 'file_change', ...fe });
      }
      if (pendingGateState !== null) {
        panel?.webview.postMessage({ type: 'approval_request', ...pendingGateState });
      }
      panel?.webview.postMessage({ type: 'autonomous_changed', autonomous: autonomousState });
      if (resumeSessionId !== null) {
        panel?.webview.postMessage({ type: 'resume_offer', sessionId: resumeSessionId });
      }
    } else if (msg.type === 'ping') {
      wsClient?.send(makeRequest('ping'));
    } else if (msg.type === 'prompt') {
      const text = String(msg.text ?? '').trim();
      if (text) {
        // Clear accumulated state for new workflow run
        lastPromptState = text;
        tokensState = '';
        fileEventsState = [];
        pendingGateState = null;
        wsClient?.send(makeRequest('prompt.submit', { text }));
      }
    } else if (msg.type === 'approval_respond') {
      const gateId = String(msg.gateId ?? '');
      const action = String(msg.action ?? 'agree');
      const feedback = String(msg.feedback ?? '');
      wsClient?.send(makeRequest('approval.respond', { gate_id: gateId, action, feedback }));
      pendingGateState = null;
    } else if (msg.type === 'stop') {
      wsClient?.send(makeRequest('stop', {}));
    } else if (msg.type === 'mode_set') {
      const autonomous = Boolean(msg.autonomous);
      autonomousState = autonomous;
      wsClient?.send(makeRequest('mode.set', { autonomous }));
    } else if (msg.type === 'resume') {
      const sessionId = String(msg.sessionId ?? '');
      resumeSessionId = null;
      wsClient?.send(makeRequest('session.resume', { session_id: sessionId }));
      // Clear old accumulated UI state
      tokensState = '';
      fileEventsState = [];
      pendingGateState = null;
    } else if (msg.type === 'open_file') {
      const filePath = String(msg.path ?? '');
      if (filePath && projectRoot) {
        const fileUri = vscode.Uri.file(path.join(projectRoot, filePath));
        vscode.commands.executeCommand('vscode.open', fileUri).then(
          () => undefined,
          (err: unknown) => {
            vscode.window.showErrorMessage(`Kōdo: Cannot open file — ${String(err)}`);
          },
        );
      }
    }
  });

  panel.onDidDispose(() => {
    panel = null;
  });
}

// ---------------------------------------------------------------------------
// Server → state cache → WebView routing
// ---------------------------------------------------------------------------

function handleServerEnvelope(env: Envelope): void {
  // Token streaming
  if (env.kind === 'stream_chunk') {
    const text = String(env.payload.text ?? '');
    appendTokens(text);
    panel?.webview.postMessage({ type: 'token', text });
    return;
  }

  // Thinking token streaming
  if (env.kind === 'thinking_chunk') {
    const text = String(env.payload.text ?? '');
    panel?.webview.postMessage({ type: 'thinking_token', text });
    return;
  }

  // Stream end — signals the WebView that streaming is done
  if (env.kind === 'stream_end') {
    panel?.webview.postMessage({ type: 'stream_end' });
    return;
  }

  const evtType = String(env.payload.type ?? '');

  if (env.kind === 'response' && evtType === 'pong') {
    panel?.webview.postMessage({ type: 'pong' });
    return;
  }

  if (env.kind === 'response' && evtType === 'hello.ack') {
    const raw = env.payload.models;
    if (Array.isArray(raw)) {
      modelsState = raw as ModelInfo[];
    }
    const statePayload = env.payload.state as Record<string, unknown> | undefined;
    if (statePayload && typeof statePayload.effective_model === 'string') {
      effectiveLocalModelState = statePayload.effective_model;
    }
    llamaInstalledState = Boolean(env.payload.llama_installed);
    llamaVersionState = typeof env.payload.llama_version === 'string' ? env.payload.llama_version : '';
    llamaRunningState = Boolean(env.payload.llama_running);
    llamaRunningModelState = llamaRunningState && typeof env.payload.llama_model === 'string'
      ? env.payload.llama_model : '';
    sidebarProvider?.update({
      models: modelsState,
      installedModels: installedModelsState,
      effectiveLocalModel: effectiveLocalModelState,
      llamaInstalled: llamaInstalledState,
      llamaVersion: llamaVersionState,
      llamaRunning: llamaRunningState,
      llamaRunningModel: llamaRunningModelState,
    });
    return;
  }

  if (env.kind === 'event' && evtType === 'state') {
    const stage = String(env.payload.stage ?? 'IDLE');
    const agent = env.payload.agent ? String(env.payload.agent) : null;
    const autonomous = Boolean(env.payload.autonomous ?? false);
    stageState = stage;
    agentState = agent;
    panel?.webview.postMessage({ type: 'stage', stage, agent });
    sidebarProvider?.update({ stage });
    if (autonomous !== autonomousState) {
      autonomousState = autonomous;
      panel?.webview.postMessage({ type: 'autonomous_changed', autonomous });
      sidebarProvider?.update({ autonomous });
    }
    return;
  }

  if (env.kind === 'event' && evtType === 'agent.started') {
    const agent = String(env.payload.agent ?? '');
    agentState = agent;
    panel?.webview.postMessage({ type: 'agent_started', agent });
    return;
  }

  if (env.kind === 'event' && evtType === 'agent.finished') {
    const agent = String(env.payload.agent ?? '');
    panel?.webview.postMessage({ type: 'agent_finished', agent });
    return;
  }

  if (env.kind === 'event' && evtType === 'file.change') {
    const fileEvent: FileEventData = {
      path: String(env.payload.path ?? ''),
      kind: String(env.payload.kind ?? 'modify'),
    };
    fileEventsState.push(fileEvent);
    panel?.webview.postMessage({ type: 'file_change', ...fileEvent });
    return;
  }

  if (env.kind === 'event' && evtType === 'approval.request') {
    const gate: GateData = {
      gateId: String(env.payload.gate_id ?? ''),
      gateType: String(env.payload.gate_type ?? ''),
      summary: String(env.payload.summary ?? ''),
      artifactPath: env.payload.artifact_path ? String(env.payload.artifact_path) : null,
    };
    pendingGateState = gate;
    panel?.webview.postMessage({ type: 'approval_request', ...gate });
    return;
  }

  if (env.kind === 'event' && evtType === 'llm.turn_start') {
    panel?.webview.postMessage({ type: 'llm_turn_start' });
    return;
  }

  if (env.kind === 'event' && evtType === 'agent.tool_call') {
    panel?.webview.postMessage({
      type: 'tool_call',
      toolName: String(env.payload.tool_name ?? ''),
      description: String(env.payload.description ?? ''),
    });
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
    usageState = { cumulativeUsd, lastCallTokens };
    panel?.webview.postMessage({ type: 'usage', cumulativeUsd, lastCallTokens, durationSeconds });
    return;
  }

  if (env.kind === 'event' && evtType === 'error') {
    const message = String(env.payload.message ?? 'Unknown server error');
    const recoverable = Boolean(env.payload.recoverable ?? true);
    if (!recoverable) {
      vscode.window.showErrorMessage(
        `Kōdo: an error occurred and the workflow cannot proceed — ${message}`,
      );
    }
    return;
  }

  if (env.kind === 'event' && evtType === 'resume_offer') {
    const sid = String(env.payload.session_id ?? '');
    resumeSessionId = sid;
    panel?.webview.postMessage({ type: 'resume_offer', sessionId: sid });
    return;
  }

  if (env.kind === 'event' && evtType === 'llama.state') {
    if (Boolean(env.payload.starting)) {
      llamaStartingState = true;
      llamaRunningState = false;
      sidebarProvider?.update({ llamaStarting: true, llamaRunning: false });
      if (_llamaStartProgressResolve === null) {
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'llama.cpp is starting…', cancellable: false },
          () => new Promise<void>((resolve) => { _llamaStartProgressResolve = resolve; }),
        ).then(undefined, () => undefined);
      }
      return;
    }

    llamaRunningState = Boolean(env.payload.running);
    llamaRunningModelState = llamaRunningState && typeof env.payload.model === 'string'
      ? env.payload.model : '';
    llamaStartingState = false;
    llamaStoppingState = false;

    const errMsg = typeof env.payload.error === 'string' ? env.payload.error : '';
    if (errMsg) {
      vscode.window.showErrorMessage(`Kōdo: llama-server — ${errMsg}`);
      _llamaStartProgressResolve?.();
      _llamaStartProgressResolve = null;
    } else if (llamaRunningState) {
      const port = Number(env.payload.port ?? 8080);
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
    return;
  }

  if (env.kind === 'event' && evtType === 'model.install.progress') {
    const modelName = String(env.payload.name ?? '');
    const pct = Number(env.payload.percent ?? 0);
    const msg = String(env.payload.message ?? '');
    _onModelInstallProgress(modelName, pct, msg);
    return;
  }

  if (env.kind === 'event' && evtType === 'llamacpp.install.progress') {
    const pct = Number(env.payload.percent ?? 0);
    const msg = String(env.payload.message ?? '');
    _onLlamaProgress(pct, msg);
    return;
  }

  // Server-initiated API key request (WS_PROTOCOL.md §6 api_key.request).
  // Enqueued to serialize concurrent requests — the 2nd request waits until
  // the 1st completes, then retrieves the now-stored key immediately.
  if (env.kind === 'request' && evtType === 'api_key.request') {
    const vendor = String(env.payload.vendor ?? '');
    const requestId = env.id;
    _apiKeyQueue = _apiKeyQueue.then(() => _handleApiKeyRequest(vendor, requestId));
    return;
  }

  // Server tells VSIX to clear a stored key (e.g. after a 401 rejection).
  if (env.kind === 'event' && evtType === 'api_key.revoke') {
    const vendor = String(env.payload.vendor ?? '');
    if (vendor && extensionContext) {
      extensionContext.secrets
        .delete(`kodo.apiKey.${vendor}`)
        .then(undefined, () => undefined);
    }
    return;
  }
}

function appendTokens(chunk: string): void {
  tokensState += chunk;
  if (tokensState.length > TOKEN_BUFFER_MAX) {
    tokensState = tokensState.slice(-TOKEN_BUFFER_MAX / 2);
  }
}

function sendHello(): void {
  wsClient?.send(
    makeRequest('hello', { client: 'vsix', version: '0.1.0' }),
  );
}

function _readMode(): 'local' | 'cloud' {
  if (!projectRoot) { return 'local'; }
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectRoot, '.kodo', 'settings.json'), 'utf8')) as Record<string, unknown>;
    return s['mode'] === 'cloud' ? 'cloud' : 'local';
  } catch {
    return 'local';
  }
}

function _readActiveLocalModel(): string {
  if (!projectRoot) { return ''; }
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectRoot, '.kodo', 'settings.json'), 'utf8')) as Record<string, unknown>;
    const models = s['models'] as Record<string, unknown> | undefined;
    return typeof models?.['local'] === 'string' ? models['local'] : '';
  } catch {
    return '';
  }
}

function _readInstalledModels(): string[] {
  try {
    const indexPath = path.join(os.homedir(), '.kodo', 'local-llm-index.json');
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
    return Object.keys(parsed).filter(k => typeof parsed[k] === 'string' && parsed[k] !== '');
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
  wsClient?.send(makeRequest('llamacpp.install'));

  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Installing llama.cpp', cancellable: false },
    (progress) => new Promise<void>((resolve, reject) => {
      _llamaProgressReporter = progress;
      _llamaProgressResolve = resolve;
      _llamaProgressReject = reject;
      _llamaLastPct = 0;
    }),
  ).then(undefined, () => undefined);
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
  wsClient?.send(makeRequest('llama.start'));

  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: notifTitle, cancellable: false },
    () => new Promise<void>((resolve) => { _llamaStartProgressResolve = resolve; }),
  ).then(undefined, () => undefined);
}

const _modelProgressResolvers = new Map<string, () => void>();

function _installModel(name: string): void {
  if (installingModelsState.includes(name)) { return; }
  installingModelsState = [...installingModelsState, name];
  sidebarProvider?.update({ installingModels: installingModelsState });
  wsClient?.send(makeRequest('model.install', { name }));

  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading ${name}…`, cancellable: false },
    () => new Promise<void>((resolve) => { _modelProgressResolvers.set(name, resolve); }),
  ).then(undefined, () => undefined);
}

function _onModelInstallProgress(name: string, pct: number, msg: string): void {
  if (pct === 100) {
    installingModelsState = installingModelsState.filter(n => n !== name);
    installedModelsState = _readInstalledModels();
    sidebarProvider?.update({ installingModels: installingModelsState, installedModels: installedModelsState });
    setTimeout(() => {
      _modelProgressResolvers.get(name)?.();
      _modelProgressResolvers.delete(name);
      vscode.window.showInformationMessage(`Kōdo: ${name} downloaded and ready.`);
    }, 1000);
  } else if (pct < 0) {
    installingModelsState = installingModelsState.filter(n => n !== name);
    sidebarProvider?.update({ installingModels: installingModelsState });
    _modelProgressResolvers.get(name)?.();
    _modelProgressResolvers.delete(name);
    vscode.window.showErrorMessage(`Kōdo: model installation failed — ${msg}`);
  }
}

function _setActiveLocalModel(name: string): void {
  if (!projectRoot) {
    vscode.window.showErrorMessage('Kōdo: no project folder is open.');
    return;
  }

  const kodoDir = path.join(projectRoot, '.kodo');
  const settingsPath = path.join(kodoDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch { /* start fresh */ }
  }

  const models = (settings['models'] as Record<string, unknown> | undefined) ?? {};
  models['local'] = name;
  settings['models'] = models;

  fs.mkdirSync(kodoDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  wsClient?.send(makeRequest('config.reload'));
  activeLocalModelState = name;
  sidebarProvider?.update({ activeLocalModel: name });
}

function _setMode(mode: 'cloud' | 'local'): void {
  if (!projectRoot) {
    vscode.window.showErrorMessage('Kōdo: no project folder is open.');
    return;
  }

  const kodoDir = path.join(projectRoot, '.kodo');
  const settingsPath = path.join(kodoDir, 'settings.json');

  // Read existing project settings (if any), update mode, write back.
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // Unreadable — start fresh with just the mode key.
    }
  }

  settings['mode'] = mode;
  fs.mkdirSync(kodoDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  wsClient?.send(makeRequest('config.reload'));
  modeState = mode;
  sidebarProvider?.update({ mode });

  const label = mode === 'cloud' ? 'cloud AI (API key required)' : 'local AI via llama.cpp';
  vscode.window.showInformationMessage(`Kōdo: switched to ${label}.`);
}

// ---------------------------------------------------------------------------
// SecretStorage: per-vendor API key management (WS_PROTOCOL.md §6)
// ---------------------------------------------------------------------------

async function _handleApiKeyRequest(vendor: string, requestId: string): Promise<void> {
  if (!extensionContext) {
    return;
  }

  const secretKey = `kodo.apiKey.${vendor}`;

  // Return the stored key if available — no user prompt needed.
  const stored = await extensionContext.secrets.get(secretKey);
  if (stored) {
    wsClient?.send(makeResponse(requestId, { api_key: stored }));
    return;
  }

  // Ask the user to enter the key.
  const entered = await vscode.window.showInputBox({
    title: `Kōdo: API key required`,
    prompt: `Enter the API key for ${vendor}`,
    password: true,
    placeHolder: `${vendor} API key`,
    ignoreFocusOut: true,
  });

  if (!entered?.trim()) {
    vscode.window.showErrorMessage(
      `Kōdo: prompt not sent. A ${vendor} API key is needed to run AI — without it Kōdo cannot do anything. ` +
        'If you prefer not to use a cloud API, you can point Kōdo at a local AI running on your machine (llama.cpp).',
    );
    wsClient?.send(makeResponse(requestId, { error: 'cancelled' }));
    return;
  }

  await extensionContext.secrets.store(secretKey, entered.trim());
  wsClient?.send(makeResponse(requestId, { api_key: entered.trim() }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      if (typeof addr === 'object' && addr !== null) {
        const picked = addr.port;
        probe.close(() => resolve(picked));
      } else {
        probe.close();
        reject(new Error('failed to read free port from probe socket'));
      }
    });
  });
}

function generateNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
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
