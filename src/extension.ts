/**
 * Kōdo VS Code extension — M1 entry point.
 *
 * Lifecycle:
 *   1. Activation: pick a free loopback port, launch kodo-server bound to it,
 *      open a persistent WebSocket client.
 *   2. The WS client runs for the lifetime of the VS Code window — even when
 *      the Kōdo panel is closed. State updates flow into an in-memory cache
 *      maintained by the extension host.
 *   3. "Kōdo: Open Panel" command: create/reveal the WebView panel, which
 *      is a view onto the cached state (rehydrated on first mount).
 *   4. Deactivation: dispose WS client and server subprocess.
 */

import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest } from './envelope';
import type { Envelope } from './envelope';
import { ServerLauncher } from './server-launcher';
import { WsClient } from './ws-client';

const SERVER_STARTUP_DELAY_MS = 1_500;
const TOKEN_BUFFER_MAX = 64 * 1024; // soft cap on cached stream text

let launcher: ServerLauncher | null = null;
let wsClient: WsClient | null = null;
let panel: vscode.WebviewPanel | null = null;

// ---------------------------------------------------------------------------
// Persistent state owned by the extension host
//
// The Kōdo panel is a thin view onto these values. While the panel is closed,
// the WebSocket keeps running and keeps mutating this state; reopening the
// panel rehydrates from here so the user sees the live picture, not a fresh
// "Disconnected" UI.
// ---------------------------------------------------------------------------
let connState = false;
let stageState = 'IDLE';
let tokensState = '';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Determine project root (first workspace folder, or extension dir for dev)
  const projectRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    context.extensionPath;

  // Pick a free ephemeral port. Each VS Code window gets its own port so
  // multiple Kōdo sessions can run in parallel without clashing.
  const port = await findFreePort();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  launcher = new ServerLauncher();
  launcher.launch(projectRoot, port);

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
      vscode.window.showInformationMessage(
        'Kōdo: Init Project — coming in M2.',
      ),
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
      // First message after the Preact app mounts: rehydrate the panel
      // from the persistent extension-host state.
      panel?.webview.postMessage({ type: 'status', connected: connState });
      panel?.webview.postMessage({ type: 'stage', stage: stageState });
      if (tokensState.length > 0) {
        panel?.webview.postMessage({ type: 'token', text: tokensState });
      }
    } else if (msg.type === 'ping') {
      wsClient?.send(makeRequest('ping'));
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
}

function appendTokens(chunk: string): void {
  tokensState += chunk;
  if (tokensState.length > TOKEN_BUFFER_MAX) {
    // Drop the oldest half so memory doesn't grow without bound during
    // long sessions. Display will pick up wherever the cache currently is.
    tokensState = tokensState.slice(-TOKEN_BUFFER_MAX / 2);
  }
}

function sendHello(): void {
  wsClient?.send(
    makeRequest('hello', { client: 'vsix', version: '0.1.0' }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bind a TCP server to port 0 to let the OS pick a free port, then close it.
 *
 * There's a small race between releasing the port and the kodo-server binding
 * to it, but for a per-window dev launcher this is acceptable.
 */
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
