/**
 * Kōdo VS Code extension — M2 entry point.
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
let extensionContext: vscode.ExtensionContext | null = null;

// ---------------------------------------------------------------------------
// Persistent state owned by the extension host
// ---------------------------------------------------------------------------
let connState = false;
let stageState = 'IDLE';
let tokensState = '';
let usageState: UsageSummary = { cumulativeUsd: 0, lastCallTokens: null };

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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;

  const projectRoot =
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
    vscode.commands.registerCommand('kodo.initProject', () =>
      initProject(projectRoot),
    ),
  );
}

export function deactivate(): void {
  wsClient?.dispose();
  wsClient = null;
  launcher?.dispose();
  launcher = null;
  panel = null;
  extensionContext = null;
}

// ---------------------------------------------------------------------------
// Init Project (FR-VSIX-05)
// ---------------------------------------------------------------------------

async function initProject(root: string): Promise<void> {
  const kodoMd = path.join(root, 'kodo.md');
  if (fs.existsSync(kodoMd)) {
    const choice = await vscode.window.showWarningMessage(
      'kodo.md already exists. Overwrite?',
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
    vscode.window.showInformationMessage('Kōdo project initialised.');

    // Open kodo.md in the editor
    const doc = await vscode.workspace.openTextDocument(kodoMd);
    await vscode.window.showTextDocument(doc);
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
      // Rehydrate the panel from the persistent extension-host state.
      panel?.webview.postMessage({ type: 'status', connected: connState });
      panel?.webview.postMessage({ type: 'stage', stage: stageState });
      if (tokensState.length > 0) {
        panel?.webview.postMessage({ type: 'token', text: tokensState });
      }
      panel?.webview.postMessage({ type: 'usage', ...usageState });
    } else if (msg.type === 'ping') {
      wsClient?.send(makeRequest('ping'));
    } else if (msg.type === 'prompt') {
      const text = String(msg.text ?? '').trim();
      if (text) {
        wsClient?.send(makeRequest('prompt.submit', { text }));
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
  if (env.kind === 'stream_chunk') {
    const text = String(env.payload.text ?? '');
    appendTokens(text);
    panel?.webview.postMessage({ type: 'token', text });
    return;
  }

  const evtType = String(env.payload.type ?? '');

  if (env.kind === 'response' && evtType === 'pong') {
    panel?.webview.postMessage({ type: 'pong' });
    return;
  }

  if (env.kind === 'event' && evtType === 'state') {
    const stage = String(env.payload.stage ?? 'IDLE');
    stageState = stage;
    panel?.webview.postMessage({ type: 'stage', stage });
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
      vscode.window.showErrorMessage(`Kōdo: ${message}`);
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

// ---------------------------------------------------------------------------
// SecretStorage: Anthropic API key (FR-VSIX-04)
// ---------------------------------------------------------------------------

async function getOrPromptApiKey(context: vscode.ExtensionContext): Promise<string> {
  const stored = await context.secrets.get(API_KEY_SECRET);
  if (stored) {
    return stored;
  }

  const input = await vscode.window.showInputBox({
    title: 'Kōdo — Anthropic API Key',
    prompt: 'Enter your Anthropic API key. It will be stored in VS Code SecretStorage.',
    password: true,
    placeHolder: 'sk-ant-...',
    ignoreFocusOut: true,
  });

  if (input && input.trim()) {
    await context.secrets.store(API_KEY_SECRET, input.trim());
    return input.trim();
  }

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
