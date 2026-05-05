/**
 * Kōdo VS Code extension — M1 entry point.
 *
 * Lifecycle:
 *   1. Activation: launch kodo-server subprocess for the workspace root.
 *   2. "Kōdo: Open Panel" command: create/reveal the WebView panel.
 *   3. WebView ↔ extension host: status, tokens, ping/pong.
 *   4. Deactivation: dispose server process and WS client.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest } from './envelope';
import type { Envelope } from './envelope';
import { ServerLauncher } from './server-launcher';
import { WsClient } from './ws-client';

const WS_PORT = 9042;
const WS_URL = `ws://127.0.0.1:${WS_PORT}/ws`;
const SERVER_STARTUP_DELAY_MS = 1_500;

let launcher: ServerLauncher | null = null;
let wsClient: WsClient | null = null;
let panel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  // Determine project root (first workspace folder, or extension dir for dev)
  const projectRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    context.extensionPath;

  // Launch server
  launcher = new ServerLauncher();
  launcher.launch(projectRoot, WS_PORT);

  // WS client: forward server envelopes to WebView
  wsClient = new WsClient(
    WS_URL,
    (env: Envelope) => handleServerEnvelope(env),
    (connected: boolean) => {
      panel?.webview.postMessage({ type: 'status', connected });
      if (connected) {
        sendHello();
      }
    },
  );

  // Give the server a moment to bind before connecting
  setTimeout(() => wsClient?.connect(), SERVER_STARTUP_DELAY_MS);

  // Register commands
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

  // Messages from WebView → extension host
  panel.webview.onDidReceiveMessage((msg: Record<string, unknown>) => {
    if (msg.type === 'ping') {
      wsClient?.send(makeRequest('ping'));
    }
  });

  panel.onDidDispose(() => {
    panel = null;
  });
}

// ---------------------------------------------------------------------------
// Server → WebView routing
// ---------------------------------------------------------------------------

function handleServerEnvelope(env: Envelope): void {
  if (env.kind === 'stream_chunk') {
    const text = String(env.payload.text ?? '');
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
    panel?.webview.postMessage({ type: 'stage', stage });
    return;
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
