import * as vscode from 'vscode';

export interface ModelInfo {
  name: string;
  residence: 'local' | 'cloud';
  description: string;
  model_id: string;
  repo_id: string;
  filename: string;
}

export interface SidebarState {
  connected: boolean;
  hasWorkspace: boolean;
  stage: string;
  autonomous: boolean;
  workflowMode: 'guided' | 'problem_solving';
  mode: 'local' | 'cloud';
  models: ModelInfo[];
  installedModels: string[];
  activeLocalModel: string;
  effectiveLocalModel: string;
  llamaInstalled: boolean;
  llamaVersion: string;
  llamaInstalling: boolean;
  llamaRunning: boolean;
  llamaRunningModel: string;
  llamaStarting: boolean;
  llamaStopping: boolean;
  installingModels: string[];
}

export type SidebarMessage =
  | { type: 'open_panel' }
  | { type: 'set_mode'; mode: 'local' | 'cloud' }
  | { type: 'toggle_autonomous' }
  | { type: 'toggle_workflow_mode' }
  | { type: 'set_active_model'; name: string }
  | { type: 'restart_llamacpp' }
  | { type: 'install_llamacpp' }
  | { type: 'start_llamacpp' }
  | { type: 'stop_llamacpp' }
  | { type: 'install_model'; name: string }
  | { type: 'ready' };

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _state: SidebarState;
  private _ready = false;

  constructor(
    initialState: SidebarState,
    private readonly onMessage: (msg: SidebarMessage) => void,
  ) {
    this._state = { ...initialState };
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    this._ready = false;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: SidebarMessage) => {
      if (msg.type === 'ready') {
        this._ready = true;
        this._post(this._state);
        return;
      }
      this.onMessage(msg);
    });
  }

  update(patch: Partial<SidebarState>): void {
    this._state = { ...this._state, ...patch };
    if (this._ready) {
      this._post(this._state);
    }
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
    .status-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }
    .status {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 5px;
      opacity: 0.75;
    }
    .toggle-row {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .conn-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .conn-dot.on      { background: #4caf50; }
    .conn-dot.off     { background: var(--vscode-disabledForeground, #666); }
    .conn-dot.working { background: #f0a500; }
    .conn-dot.waiting { background: #f0a500; }
    .conn-dot.error   { background: var(--vscode-errorForeground, #f44336); }
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
      box-sizing: border-box;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled {
      opacity: 0.45;
      cursor: default;
      background: var(--vscode-button-background);
    }
    .toggle-btn {
      flex: 1;
      width: auto;
      margin-bottom: 0;
      font-size: 0.92em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    .toggle-btn:hover {
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
    /* Model cards */
    #cards-section { margin-top: 4px; }
    .card {
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 8px;
      background: var(--vscode-editor-inactiveSelectionBackground, transparent);
    }
    .card.active {
      border-color: var(--vscode-focusBorder, var(--vscode-button-background));
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .card-header input[type="radio"] { flex-shrink: 0; }
    .card-name {
      font-weight: 600;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-badge {
      font-size: 0.78em;
      padding: 1px 5px;
      border-radius: 3px;
      background: #4caf5033;
      color: #4caf50;
      flex-shrink: 0;
    }
    .card-desc {
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
      margin-bottom: 6px;
    }
    .card-install-btn {
      display: block;
      width: 100%;
      padding: 3px 8px;
      margin-bottom: 0;
      font-size: 0.85em;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    .card-install-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    #restart-btn { margin-bottom: 8px; }
    #restart-btn:disabled { opacity: 0.45; cursor: default; }
    #inactive-msg {
      display: none;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      padding: 16px 4px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div id="inactive-msg">Open a workspace to use Kōdo.</div>
  <div id="main-controls">
    <div class="status-row">
      <div class="status">
        <span id="conn-dot" class="conn-dot off"></span>
        <span id="conn-lbl">Status: Disconnected</span>
      </div>
    </div>
    <div class="toggle-row">
      <button id="auto-btn" class="toggle-btn">💬 Interactive</button>
      <button id="workflow-btn" class="toggle-btn">🧩 Guided Project Workflow</button>
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
        Use cloud AI service
      </label>
    </div>
    <hr>

    <div id="cards-section"></div>
  </div>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();

    // Notify extension that webview is ready to receive state.
    vsc.postMessage({ type: 'ready' });

    // Tooltip copy for the two mode toggles.
    const TOOLTIPS = {
      interactive: 'Interactive mode — agents work alongside you, asking questions and checking in before key decisions.',
      autonomous: 'Autonomous mode — agents work on their own, making reasonable assumptions instead of pausing to ask you.',
      problem_solving: 'Problem Solving — a single generalist agent tackles your request end to end, however it sees fit.',
      guided: 'Guided Project Workflow — Kōdo walks you through its build phases (design, tests, implementation) to grow a complete solution.',
    };

    // ----------------------------------------------------------------
    // Tooltip
    // ----------------------------------------------------------------
    let _tooltipTarget = null;
    const _tooltipEl = document.createElement('div');
    _tooltipEl.style.cssText = [
      'position:fixed',
      'background:var(--vscode-editorHoverWidget-background,#252526)',
      'color:var(--vscode-editorHoverWidget-foreground,#cccccc)',
      'border:1px solid var(--vscode-editorHoverWidget-border,#454545)',
      'border-radius:3px',
      'padding:5px 8px',
      'font-size:0.82em',
      'pointer-events:none',
      'display:none',
      'z-index:1000',
      'max-width:220px',
      'white-space:normal',
      'word-wrap:break-word',
      'line-height:1.35',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
    ].join(';');
    document.body.appendChild(_tooltipEl);

    function _showTooltip(el, text) {
      _tooltipTarget = el;
      const rect = el.getBoundingClientRect();
      _tooltipEl.textContent = text;
      _tooltipEl.style.display = 'block';
      _tooltipEl.style.left = '0';
      _tooltipEl.style.top = (rect.bottom + 5) + 'px';
      const tw = _tooltipEl.offsetWidth;
      let left = rect.left + (rect.width - tw) / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      _tooltipEl.style.left = left + 'px';
    }
    function _hideTooltip() { _tooltipTarget = null; _tooltipEl.style.display = 'none'; }

    document.getElementById('auto-btn').addEventListener('mouseenter', function() {
      _showTooltip(this, _state.autonomous ? TOOLTIPS.autonomous : TOOLTIPS.interactive);
    });
    document.getElementById('auto-btn').addEventListener('mouseleave', _hideTooltip);
    document.getElementById('workflow-btn').addEventListener('mouseenter', function() {
      _showTooltip(this, _state.workflowMode === 'problem_solving' ? TOOLTIPS.problem_solving : TOOLTIPS.guided);
    });
    document.getElementById('workflow-btn').addEventListener('mouseleave', _hideTooltip);

    document.getElementById('auto-btn').addEventListener('click', () => {
      _hideTooltip();
      vsc.postMessage({ type: 'toggle_autonomous' });
    });

    document.getElementById('workflow-btn').addEventListener('click', () => {
      vsc.postMessage({ type: 'toggle_workflow_mode' });
    });

    document.getElementById('open-btn').addEventListener('click', () => {
      vsc.postMessage({ type: 'open_panel' });
    });

    document.querySelectorAll('input[name="llm-mode"]').forEach(el => {
      el.addEventListener('change', e => {
        vsc.postMessage({ type: 'set_mode', mode: e.target.value });
      });
    });

    // ----------------------------------------------------------------
    // State
    // ----------------------------------------------------------------
    let _state = {
      connected: false,
      stage: 'intake',
      autonomous: false,
      workflowMode: 'guided',
      mode: 'local',
      models: [],
      installedModels: [],
      activeLocalModel: '',
      effectiveLocalModel: '',
      llamaInstalled: false,
      llamaVersion: '',
      llamaInstalling: false,
      llamaRunning: false,
      llamaRunningModel: '',
      llamaStarting: false,
      llamaStopping: false,
      installingModels: [],
    };

    function statusDisplay(connected, stage) {
      if (!connected) { return { cls: 'off', label: 'Status: Disconnected' }; }
      switch (stage) {
        case 'running':       return { cls: 'working', label: 'Status: Working…' };
        case 'awaiting_user': return { cls: 'waiting', label: 'Status: Waiting for you' };
        case 'error':         return { cls: 'error',   label: 'Status: Error' };
        case 'stopped':       return { cls: 'off',     label: 'Status: Stopped' };
        case 'done':          return { cls: 'on',      label: 'Status: Done' };
        default:              return { cls: 'on',      label: 'Status: Ready' };
      }
    }

    // ----------------------------------------------------------------
    // Cards rendering
    // ----------------------------------------------------------------
    function renderCards() {
      const section = document.getElementById('cards-section');
      section.innerHTML = '';

      const residence = _state.mode === 'local' ? 'local' : 'cloud';
      const filtered = _state.models.filter(m => m.residence === residence);

      if (filtered.length === 0) { return; }

      // llama.cpp action button + version — local only, above cards
      if (_state.mode === 'local') {
        const hasInstalledModels = _state.installedModels.length > 0;
        let btnText = '';
        let btnDisabled = false;
        let btnType = '';

        if (!_state.llamaInstalled || _state.llamaInstalling) {
          btnText = _state.llamaInstalling ? 'Installing…' : 'Install llama.cpp';
          btnDisabled = _state.llamaInstalling;
          btnType = 'install_llamacpp';
        } else if (_state.llamaStarting) {
          btnText = 'Starting…';
          btnDisabled = true;
          btnType = '';
        } else if (_state.llamaStopping) {
          btnText = 'Stopping…';
          btnDisabled = true;
          btnType = '';
        } else if (!_state.llamaRunning) {
          btnText = 'Start llama.cpp';
          btnDisabled = !hasInstalledModels;
          btnType = 'start_llamacpp';
        } else if (_state.activeLocalModel && _state.activeLocalModel !== _state.llamaRunningModel) {
          btnText = '↺ Restart llama.cpp';
          btnDisabled = false;
          btnType = 'start_llamacpp';
        } else {
          btnText = '■ Stop llama.cpp';
          btnDisabled = false;
          btnType = 'stop_llamacpp';
        }

        const actionBtn = document.createElement('button');
        actionBtn.id = 'restart-btn';
        actionBtn.textContent = btnText;
        actionBtn.disabled = btnDisabled;
        actionBtn.addEventListener('click', () => {
          vsc.postMessage({ type: btnType });
        });
        section.appendChild(actionBtn);

        if (_state.llamaInstalled && _state.llamaVersion) {
          const ver = document.createElement('div');
          ver.style.cssText = 'font-size:0.8em;color:var(--vscode-descriptionForeground);margin-bottom:6px;';
          ver.textContent = 'llama.cpp ' + _state.llamaVersion
            + (_state.llamaRunning && _state.llamaRunningModel ? '  ·  running: ' + _state.llamaRunningModel : '');
          section.appendChild(ver);
        }
      }

      filtered.forEach(model => {
        const isLocal = model.residence === 'local';
        const isInstalled = _state.installedModels.includes(model.name);
        const isActive = _state.activeLocalModel === model.name;

        const card = document.createElement('div');
        card.className = 'card' + (isActive ? ' active' : '');
        card.dataset.name = model.name;

        // Header: radio + name + installed badge
        const header = document.createElement('div');
        header.className = 'card-header';

        if (isLocal) {
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'active-model';
          radio.value = model.name;
          radio.checked = isActive;
          radio.disabled = !isInstalled;
          radio.addEventListener('change', () => {
            if (radio.checked) {
              vsc.postMessage({ type: 'set_active_model', name: model.name });
            }
          });
          header.appendChild(radio);
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'card-name';
        nameEl.textContent = model.name;
        header.appendChild(nameEl);

        if (isInstalled) {
          const badge = document.createElement('span');
          badge.className = 'card-badge';
          badge.textContent = 'Installed';
          header.appendChild(badge);
        }

        card.appendChild(header);

        // Description
        const desc = document.createElement('div');
        desc.className = 'card-desc';
        desc.textContent = model.description;
        card.appendChild(desc);

        // Install button for uninstalled local models
        if (isLocal && !isInstalled) {
          const isInstalling = _state.installingModels.includes(model.name);
          const installBtn = document.createElement('button');
          installBtn.className = 'card-install-btn';
          installBtn.textContent = isInstalling ? 'Installing…' : 'Install';
          installBtn.disabled = isInstalling;
          if (!isInstalling) {
            installBtn.addEventListener('click', () => {
              vsc.postMessage({ type: 'install_model', name: model.name });
            });
          }
          card.appendChild(installBtn);

        }

        section.appendChild(card);
      });
    }

    // ----------------------------------------------------------------
    // Message handler
    // ----------------------------------------------------------------
    window.addEventListener('message', ({ data }) => {
      if (data.type !== 'update') { return; }

      // Workspace gate
      if (data.hasWorkspace !== undefined) {
        const active = Boolean(data.hasWorkspace);
        document.getElementById('inactive-msg').style.display = active ? 'none' : 'block';
        document.getElementById('main-controls').style.display = active ? '' : 'none';
      }

      // Unified status
      _state.connected = Boolean(data.connected);
      if (typeof data.stage === 'string') { _state.stage = data.stage; }
      const { cls, label } = statusDisplay(_state.connected, _state.stage);
      document.getElementById('conn-dot').className = 'conn-dot ' + cls;
      document.getElementById('conn-lbl').textContent = label;

      _state.autonomous = Boolean(data.autonomous);
      const autoBtn = document.getElementById('auto-btn');
      autoBtn.textContent = _state.autonomous ? '⚡ Autonomous' : '💬 Interactive';
      autoBtn.title = _state.autonomous ? TOOLTIPS.autonomous : TOOLTIPS.interactive;
      if (_tooltipTarget === autoBtn) { _showTooltip(autoBtn, autoBtn.title); }

      if (data.workflowMode !== undefined) { _state.workflowMode = data.workflowMode; }
      const workflowBtn = document.getElementById('workflow-btn');
      const isProblemSolving = _state.workflowMode === 'problem_solving';
      workflowBtn.textContent = isProblemSolving ? '💡 Problem Solving' : '🧩 Guided Project Workflow';
      workflowBtn.title = isProblemSolving ? TOOLTIPS.problem_solving : TOOLTIPS.guided;
      if (_tooltipTarget === workflowBtn) { _showTooltip(workflowBtn, workflowBtn.title); }

      // Mode radio
      const radio = document.querySelector('input[value="' + data.mode + '"]');
      if (radio) { radio.checked = true; }

      // Update local state for cards
      _state.mode = data.mode || _state.mode;
      _state.models = data.models || _state.models;
      _state.installedModels = data.installedModels || _state.installedModels;
      _state.activeLocalModel = data.activeLocalModel !== undefined
        ? data.activeLocalModel : _state.activeLocalModel;
      _state.effectiveLocalModel = data.effectiveLocalModel !== undefined
        ? data.effectiveLocalModel : _state.effectiveLocalModel;
      if (data.llamaInstalled !== undefined) { _state.llamaInstalled = Boolean(data.llamaInstalled); }
      if (typeof data.llamaVersion === 'string') { _state.llamaVersion = data.llamaVersion; }
      if (data.llamaInstalling !== undefined) { _state.llamaInstalling = Boolean(data.llamaInstalling); }
      if (data.llamaRunning !== undefined) { _state.llamaRunning = Boolean(data.llamaRunning); }
      if (typeof data.llamaRunningModel === 'string') { _state.llamaRunningModel = data.llamaRunningModel; }
      if (data.llamaStarting !== undefined) { _state.llamaStarting = Boolean(data.llamaStarting); }
      if (data.llamaStopping !== undefined) { _state.llamaStopping = Boolean(data.llamaStopping); }
      if (Array.isArray(data.installingModels)) { _state.installingModels = data.installingModels; }

      renderCards();
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
