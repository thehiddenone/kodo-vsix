/** The session panel's static HTML shell — just a CSP + a `<script>` tag
 *  pointing at the esbuild-bundled Preact app (`src/webview/main.tsx` →
 *  `dist/webview.js`); all real UI lives in that bundle, not here. */

import type * as vscode from 'vscode';

export function generateNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function buildHtml(webviewJsUri: vscode.Uri, nonce: string): string {
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
