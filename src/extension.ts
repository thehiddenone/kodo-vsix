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
import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest } from './envelope';
import type { Envelope } from './envelope';
import { ServerLauncher } from './server-launcher';
import { WsClient } from './ws-client';

const SERVER_STARTUP_DELAY_MS = 1_500;
const TOKEN_BUFFER_MAX = 64 * 1024; // soft cap on cached stream text
const API_KEY_SECRET = 'kodo.anthropicApiKey';

let launcher: ServerLauncher | null = null;
let wsClient: WsClient | null = null;
let panel: vscode.WebviewPanel | null = null;
let projectRoot = '';

// ---------------------------------------------------------------------------
// Persistent state owned by the extension host
// ---------------------------------------------------------------------------
let connState = false;
let stageState = 'IDLE';
let tokensState = '';
let agentState: string | null = null;
let usageState: UsageSummary = { cumulativeUsd: 0, lastCallTokens: null };
let fileEventsState: FileEventData[] = [];
let pendingGateState: GateData | null = null;
let autonomousState = false;
let resumeSessionId: string | null = null;

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
  projectRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    context.extensionPath;

  const apiKey = await getOrPromptApiKey(context);

  const port = await findFreePort();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  launcher = new ServerLauncher();
  launcher.launch(projectRoot, port, apiKey);

  wsClient = new WsClient(
    wsUrl,
    (env: Envelope) => handleServerEnvelope(env),
    (connected: boolean) => {
      connState = connected;
      panel?.webview.postMessage({ type: 'status', connected });
      if (connected) {
        sendHello();
      }
    },
  );

  // Give the server a moment to bind before connecting
  setTimeout(() => wsClient?.connect(), SERVER_STARTUP_DELAY_MS);

  context.subscriptions.push(
    vscode.commands.registerCommand('kodo.openPanel', () =>
      openPanel(context),
    ),
    vscode.commands.registerCommand('kodo.createProject', () =>
      createProject(),
    ),
  );
}

export function deactivate(): void {
  wsClient?.dispose();
  wsClient = null;
  launcher?.dispose();
  launcher = null;
  panel = null;
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
      panel?.webview.postMessage({ type: 'status', connected: connState });
      panel?.webview.postMessage({ type: 'stage', stage: stageState, agent: agentState });
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

  if (env.kind === 'event' && evtType === 'state') {
    const stage = String(env.payload.stage ?? 'IDLE');
    const agent = env.payload.agent ? String(env.payload.agent) : null;
    const autonomous = Boolean(env.payload.autonomous ?? false);
    stageState = stage;
    agentState = agent;
    panel?.webview.postMessage({ type: 'stage', stage, agent });
    if (autonomous !== autonomousState) {
      autonomousState = autonomous;
      panel?.webview.postMessage({ type: 'autonomous_changed', autonomous });
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

  if (env.kind === 'event' && evtType === 'usage.update') {
    const cumulativeUsd = Number(env.payload.cumulative_usd ?? 0);
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
    panel?.webview.postMessage({ type: 'usage', cumulativeUsd, lastCallTokens });
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

// ---------------------------------------------------------------------------
// SecretStorage: Anthropic API key (FR-VSIX-04)
// ---------------------------------------------------------------------------

async function getOrPromptApiKey(context: vscode.ExtensionContext): Promise<string> {
  const envKey = process.env['KODO_ANTHROPIC_API_KEY']?.trim() ?? '';

  if (envKey) {
    await context.secrets.store(API_KEY_SECRET, envKey);
    return envKey;
  }

  const stored = await context.secrets.get(API_KEY_SECRET);
  if (stored) {
    return stored;
  }

  vscode.window.showWarningMessage(
    'Kōdo: KODO_ANTHROPIC_API_KEY is not set. ' +
      'Set the environment variable and restart VS Code to enable LLM calls.',
  );
  return '';
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
