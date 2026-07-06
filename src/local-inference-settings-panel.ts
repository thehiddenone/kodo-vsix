import * as vscode from 'vscode';
import type { LocalRegistryEntry } from './llm-registry-types';

export interface LocalInferenceSettingsState {
  localRegistry: LocalRegistryEntry[];
  llamaServerOverridePath: string | null;
  installingModels: string[];
}

export type LocalInferenceSettingsMessage =
  | { type: 'ready' }
  | { type: 'add_huggingface' }
  | { type: 'add_file' }
  | { type: 'add_server_url' }
  | { type: 'install'; name: string }
  | { type: 'uninstall'; name: string }
  | { type: 'remove'; name: string }
  | { type: 'set_override' }
  | { type: 'remove_override' };

/** Singleton settings panel — reveals the existing one instead of opening a second. */
export class LocalInferenceSettingsPanel {
  private static current: LocalInferenceSettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private state: LocalInferenceSettingsState;

  static createOrShow(
    initialState: LocalInferenceSettingsState,
    onMessage: (msg: LocalInferenceSettingsMessage) => void,
  ): LocalInferenceSettingsPanel {
    if (LocalInferenceSettingsPanel.current) {
      LocalInferenceSettingsPanel.current.panel.reveal();
      return LocalInferenceSettingsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'kodoLocalInferenceSettings',
      'Local Inference Settings',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new LocalInferenceSettingsPanel(panel, initialState, onMessage);
    LocalInferenceSettingsPanel.current = instance;
    panel.onDidDispose(() => {
      LocalInferenceSettingsPanel.current = undefined;
    });
    return instance;
  }

  static get instance(): LocalInferenceSettingsPanel | undefined {
    return LocalInferenceSettingsPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    initialState: LocalInferenceSettingsState,
    private readonly onMessage: (msg: LocalInferenceSettingsMessage) => void,
  ) {
    this.panel = panel;
    this.state = initialState;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = buildHtml();
    panel.webview.onDidReceiveMessage((msg: LocalInferenceSettingsMessage) => {
      if (msg.type === 'ready') {
        this._post();
        return;
      }
      this.onMessage(msg);
    });
  }

  update(patch: Partial<LocalInferenceSettingsState>): void {
    this.state = { ...this.state, ...patch };
    this._post();
  }

  private _post(): void {
    void this.panel.webview.postMessage({ type: 'update', ...this.state });
  }
}

function buildHtml(): string {
  const nonce = genNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Local Inference Settings</title>
  <style nonce="${nonce}">
    body {
      margin: 0;
      display: flex;
      height: 100vh;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #sidebar {
      width: 200px;
      flex-shrink: 0;
      padding: 12px 8px;
      border-right: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      box-sizing: border-box;
      overflow-y: auto;
    }
    #main {
      flex: 1;
      padding: 12px 16px;
      overflow-y: auto;
    }
    button {
      display: block;
      width: 100%;
      padding: 6px 10px;
      margin-bottom: 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      box-sizing: border-box;
      text-align: left;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.45; cursor: default; }
    .secondary-btn {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    .secondary-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    h2 { font-size: 1.1em; margin: 0 0 8px; }
    #override-box {
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 16px;
    }
    #override-path {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      margin: 6px 0 10px;
      word-break: break-all;
      color: var(--vscode-descriptionForeground);
    }
    #override-buttons { display: flex; gap: 8px; }
    #override-buttons button { margin-bottom: 0; }
    #cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 10px;
    }
    .card {
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      border-radius: 4px;
      padding: 10px 12px;
    }
    .card-name { font-weight: 600; margin-bottom: 2px; word-break: break-word; }
    .card-kind {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .card-desc {
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .card-badge {
      display: inline-block;
      font-size: 0.78em;
      padding: 1px 5px;
      border-radius: 3px;
      background: #4caf5033;
      color: #4caf50;
      margin-bottom: 6px;
    }
    .card-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
    .card-buttons button {
      width: auto;
      flex: 1;
      margin-bottom: 0;
      font-size: 0.85em;
      padding: 4px 8px;
    }
    #empty-msg { color: var(--vscode-descriptionForeground); padding: 8px 2px; }
  </style>
</head>
<body>
  <div id="sidebar">
    <button id="add-hf">Add local LLM from huggingface.com</button>
    <button id="add-file">Add local LLM from file</button>
    <button id="add-server">Add a link to local llama-server</button>
  </div>
  <div id="main">
    <div id="override-box">
      <h2>llama-server binary override</h2>
      <div id="override-path"></div>
      <div id="override-buttons">
        <button id="set-override" class="secondary-btn">Set llama.cpp override</button>
        <button id="remove-override" class="secondary-btn">Remove llama.cpp override</button>
      </div>
    </div>
    <div id="cards"></div>
  </div>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();
    vsc.postMessage({ type: 'ready' });

    let _state = { localRegistry: [], llamaServerOverridePath: null, installingModels: [] };

    document.getElementById('add-hf').addEventListener('click', () => vsc.postMessage({ type: 'add_huggingface' }));
    document.getElementById('add-file').addEventListener('click', () => vsc.postMessage({ type: 'add_file' }));
    document.getElementById('add-server').addEventListener('click', () => vsc.postMessage({ type: 'add_server_url' }));
    document.getElementById('set-override').addEventListener('click', () => vsc.postMessage({ type: 'set_override' }));
    document.getElementById('remove-override').addEventListener('click', () => vsc.postMessage({ type: 'remove_override' }));

    const KIND_LABELS = {
      hardcoded_hf: 'Built-in · HuggingFace',
      custom_hf: 'Custom · HuggingFace',
      custom_file: 'Custom · Local file',
      custom_server_url: 'Custom · Remote server',
    };
    const DOWNLOADABLE = new Set(['hardcoded_hf', 'custom_hf']);
    const CUSTOM = new Set(['custom_hf', 'custom_file', 'custom_server_url']);

    function render() {
      const overrideEl = document.getElementById('override-path');
      overrideEl.textContent = _state.llamaServerOverridePath
        ? _state.llamaServerOverridePath
        : 'No override — using the bundled llama.cpp binary.';

      const cards = document.getElementById('cards');
      cards.innerHTML = '';

      if (_state.localRegistry.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = 'No local LLMs yet — add one from the left.';
        cards.appendChild(msg);
        return;
      }

      _state.localRegistry.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'card';

        const name = document.createElement('div');
        name.className = 'card-name';
        name.textContent = entry.name;
        card.appendChild(name);

        const kind = document.createElement('div');
        kind.className = 'card-kind';
        kind.textContent = KIND_LABELS[entry.kind] || entry.kind;
        card.appendChild(kind);

        if (entry.installed) {
          const badge = document.createElement('div');
          badge.className = 'card-badge';
          badge.textContent = 'Installed';
          card.appendChild(badge);
        }

        const desc = document.createElement('div');
        desc.className = 'card-desc';
        desc.textContent = entry.description || '';
        card.appendChild(desc);

        const buttons = document.createElement('div');
        buttons.className = 'card-buttons';

        if (DOWNLOADABLE.has(entry.kind)) {
          const installing = _state.installingModels.includes(entry.name);
          if (entry.installed) {
            const uninstallBtn = document.createElement('button');
            uninstallBtn.className = 'secondary-btn';
            uninstallBtn.textContent = 'Uninstall';
            uninstallBtn.addEventListener('click', () => vsc.postMessage({ type: 'uninstall', name: entry.name }));
            buttons.appendChild(uninstallBtn);
          } else {
            const installBtn = document.createElement('button');
            installBtn.className = 'secondary-btn';
            installBtn.textContent = installing ? 'Installing…' : 'Install';
            installBtn.disabled = installing;
            if (!installing) {
              installBtn.addEventListener('click', () => vsc.postMessage({ type: 'install', name: entry.name }));
            }
            buttons.appendChild(installBtn);
          }
        }

        if (CUSTOM.has(entry.kind)) {
          const removeBtn = document.createElement('button');
          removeBtn.className = 'secondary-btn';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', () => vsc.postMessage({ type: 'remove', name: entry.name }));
          buttons.appendChild(removeBtn);
        }

        if (buttons.childElementCount > 0) {
          card.appendChild(buttons);
        }

        cards.appendChild(card);
      });
    }

    window.addEventListener('message', ({ data }) => {
      if (data.type !== 'update') { return; }
      _state.localRegistry = data.localRegistry || _state.localRegistry;
      _state.llamaServerOverridePath = data.llamaServerOverridePath !== undefined
        ? data.llamaServerOverridePath : _state.llamaServerOverridePath;
      _state.installingModels = data.installingModels || _state.installingModels;
      render();
    });
  </script>
</body>
</html>`;
}

function genNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) { s += chars[Math.floor(Math.random() * chars.length)]; }
  return s;
}
