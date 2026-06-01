import * as vscode from 'vscode';

export interface SidebarState {
  connected: boolean;
  stage: string;
  autonomous: boolean;
  mode: 'local' | 'cloud';
}

export type SidebarMessage =
  | { type: 'open_panel' }
  | { type: 'set_mode'; mode: 'local' | 'cloud' }
  | { type: 'toggle_autonomous' };

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _state: SidebarState;

  constructor(
    initialState: SidebarState,
    private readonly onMessage: (msg: SidebarMessage) => void,
  ) {
    this._state = { ...initialState };
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: SidebarMessage) => {
      this.onMessage(msg);
    });

    // Push current state immediately so the view isn't stale on first render.
    this._post(this._state);
  }

  update(patch: Partial<SidebarState>): void {
    this._state = { ...this._state, ...patch };
    this._post(this._state);
  }

  private _post(state: SidebarState): void {
    this._view?.webview.postMessage({ type: 'update', ...state });
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
  <title>Kōdo</title>
  <style nonce="${nonce}">
    body {
      padding: 8px 12px;
      margin: 0;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .top-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .status {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 5px;
      opacity: 0.75;
    }
    .conn-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .conn-dot.on  { background: #4caf50; }
    .conn-dot.off { background: var(--vscode-disabledForeground, #666); }
    button {
      display: block;
      width: 100%;
      padding: 5px 10px;
      margin-bottom: 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    #auto-btn {
      flex: 1;
      width: auto;
      margin-bottom: 0;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    #auto-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    #open-btn { margin-bottom: 14px; }
    .radio-group { display: flex; flex-direction: column; gap: 6px; }
    label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }
    hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      margin: 8px 0;
    }
    input[type="radio"] {
      accent-color: var(--vscode-button-background);
      cursor: pointer;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="top-row">
    <div class="status">
      <span id="conn-dot" class="conn-dot off"></span>
      <span id="conn-lbl">Disconnected</span>
    </div>
    <button id="auto-btn">⚡ Manual</button>
  </div>
  <button id="open-btn">Open Kōdo Panel</button>

  <hr>
  <div class="radio-group">
    <label>
      <input type="radio" name="llm-mode" value="local" id="mode-local">
      Use local llama.cpp
    </label>
    <label>
      <input type="radio" name="llm-mode" value="cloud" id="mode-cloud">
      Use a cloud AI service
    </label>
  </div>
  <hr>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();

    document.getElementById('auto-btn').addEventListener('click', () => {
      vsc.postMessage({ type: 'toggle_autonomous' });
    });

    document.getElementById('open-btn').addEventListener('click', () => {
      vsc.postMessage({ type: 'open_panel' });
    });

    document.querySelectorAll('input[name="llm-mode"]').forEach(el => {
      el.addEventListener('change', e => {
        vsc.postMessage({ type: 'set_mode', mode: e.target.value });
      });
    });

    window.addEventListener('message', ({ data }) => {
      if (data.type !== 'update') return;

      const dot = document.getElementById('conn-dot');
      dot.className = 'conn-dot ' + (data.connected ? 'on' : 'off');
      document.getElementById('conn-lbl').textContent = data.connected ? 'Connected' : 'Disconnected';

      document.getElementById('auto-btn').textContent = data.autonomous ? '⚡ Autonomous' : '⚡ Manual';

      const radio = document.querySelector('input[value="' + data.mode + '"]');
      if (radio) { radio.checked = true; }
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
