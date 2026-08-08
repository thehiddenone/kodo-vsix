/**
 * Kōdo Settings panel — the singleton webview panel host. The webview itself
 * is a real Preact app (`src/settings-webview/`) bundled by esbuild into
 * `dist/settings-webview.js`/`.css` (see `../../esbuild.js`); this class only
 * owns the panel lifecycle, the static HTML shell that loads that bundle,
 * and the `ready`/`update`/`select_section` postMessage handshake — no UI
 * logic lives here.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { KodoSettingsMessage, KodoSettingsState } from './types';

function genNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

function buildHtml(scriptUri: vscode.Uri, styleUri: vscode.Uri, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}' ${styleUri.scheme}:; script-src 'nonce-${nonce}';">
  <title>Kōdo Settings</title>
  <link rel="stylesheet" nonce="${nonce}" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** Singleton settings panel — reveals the existing one instead of opening a second. */
export class KodoSettingsPanel {
  private static current: KodoSettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private state: KodoSettingsState;
  /** A nav key to select once the freshly-created webview's `ready` handshake
   * lands (see `selectSection`) — `null` once consumed or if none was
   * requested. Only meaningful for a brand-new panel; `createOrShow` handles
   * the reveal-existing-panel case by calling `selectSection` directly. */
  private _pendingSelectSection: string | null = null;
  /** A local registry entry name whose Configure (knobs) modal should open
   * once the `ready` handshake lands — the sidebar card's Configure button
   * deep-links here (see `configureLocalModel`). Same one-shot treatment as
   * `_pendingSelectSection`. */
  private _pendingConfigureEntry: string | null = null;

  static createOrShow(
    extensionUri: vscode.Uri,
    initialState: KodoSettingsState,
    onMessage: (msg: KodoSettingsMessage) => void,
    selectSection?: string,
    configureEntry?: string,
  ): KodoSettingsPanel {
    if (KodoSettingsPanel.current) {
      KodoSettingsPanel.current.panel.reveal();
      if (selectSection) {
        KodoSettingsPanel.current.selectSection(selectSection);
      }
      if (configureEntry) {
        KodoSettingsPanel.current.configureLocalModel(configureEntry);
      }
      return KodoSettingsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'kodoSettings',
      'Kōdo Settings',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(extensionUri.fsPath, 'dist'))],
      },
    );
    const instance = new KodoSettingsPanel(extensionUri, panel, initialState, onMessage);
    if (selectSection) {
      instance._pendingSelectSection = selectSection;
    }
    if (configureEntry) {
      instance._pendingConfigureEntry = configureEntry;
    }
    KodoSettingsPanel.current = instance;
    panel.onDidDispose(() => {
      KodoSettingsPanel.current = undefined;
    });
    return instance;
  }

  static get instance(): KodoSettingsPanel | undefined {
    return KodoSettingsPanel.current;
  }

  private constructor(
    extensionUri: vscode.Uri,
    panel: vscode.WebviewPanel,
    initialState: KodoSettingsState,
    private readonly onMessage: (msg: KodoSettingsMessage) => void,
  ) {
    this.panel = panel;
    this.state = initialState;
    panel.webview.options = { enableScripts: true };
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(extensionUri.fsPath, 'dist', 'settings-webview.js')),
    );
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(extensionUri.fsPath, 'dist', 'settings-webview.css')),
    );
    panel.webview.html = buildHtml(scriptUri, styleUri, genNonce());
    panel.webview.onDidReceiveMessage((msg: KodoSettingsMessage) => {
      if (msg.type === 'ready') {
        this._post();
        if (this._pendingSelectSection) {
          this.selectSection(this._pendingSelectSection);
          this._pendingSelectSection = null;
        }
        if (this._pendingConfigureEntry) {
          this.configureLocalModel(this._pendingConfigureEntry);
          this._pendingConfigureEntry = null;
        }
        return;
      }
      if (msg.type === 'close') {
        this.panel.dispose();
        return;
      }
      this.onMessage(msg);
    });
  }

  update(patch: Partial<KodoSettingsState>): void {
    this.state = { ...this.state, ...patch };
    this._post();
  }

  /** Force the left nav to a given section — used when an entry point other
   * than the generic "Kōdo Settings" command wants to land the user directly
   * on one tab (e.g. the sidebar's "Local inference settings" button opening
   * straight to `'local-inference'`). A one-shot message, deliberately kept
   * out of `KodoSettingsState`/`update()` — folding it into persisted state
   * would re-force the tab on every unrelated `update()` push (e.g. a
   * download-progress tick), fighting any subsequent tab the user clicks. */
  selectSection(key: string): void {
    void this.panel.webview.postMessage({ type: 'select_section', key });
  }

  /** Open the Configure (Default-profile knobs) modal for one local registry
   * entry. One-shot, kept out of `KodoSettingsState` for exactly the reason
   * `selectSection` is: folding it into persisted state would re-open the
   * modal on every unrelated `update()` push. */
  configureLocalModel(name: string): void {
    void this.panel.webview.postMessage({ type: 'configure_local_model', name });
  }

  /** Reply to a `pick_gguf_file` message with the path chosen in the native dialog (or `null` if cancelled). */
  postGgufFilePicked(path: string | null): void {
    void this.panel.webview.postMessage({ type: 'gguf_file_picked', path });
  }

  private _post(): void {
    void this.panel.webview.postMessage({ type: 'update', ...this.state });
  }
}
