import * as vscode from 'vscode';
import type { CloudRegistry, LocalRegistryEntry } from './llm-registry-types';

export interface SidebarState {
  connected: boolean;
  hasWorkspace: boolean;
  stage: string;
  mode: 'local' | 'cloud';
  cloudRegistry: CloudRegistry;
  activeCloudVendor: string;
  localRegistry: LocalRegistryEntry[];
  activeLocalModel: string;
  effectiveLocalModel: string;
  llamaInstalled: boolean;
  llamaVersion: string;
  llamaInstalling: boolean;
  llamaRunning: boolean;
  llamaRunningModel: string;
  llamaStarting: boolean;
  llamaStopping: boolean;
  detectedVramGb: number | null;
  detectedRamGb: number | null;
}

export type SidebarMessage =
  | { type: 'list_sessions' }
  | { type: 'new_session' }
  | { type: 'set_mode'; mode: 'local' | 'cloud' }
  | { type: 'set_active_model'; name: string }
  | { type: 'set_active_flavor'; name: string; flavor_id: string }
  | { type: 'set_cloud_vendor'; vendor: string }
  | { type: 'open_local_inference_settings' }
  | { type: 'open_cloud_ai_settings' }
  | { type: 'install_llamacpp' }
  | { type: 'start_llamacpp' }
  | { type: 'stop_llamacpp' }
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
    #open-btn { margin-bottom: 8px; }
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
    /* Model / vendor cards */
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
    .card-desc {
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    select.flavor-select {
      width: 100%;
      box-sizing: border-box;
      margin-top: 6px;
      padding: 3px 5px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: 0.9em;
    }
    #restart-btn { margin-bottom: 8px; }
    #restart-btn:disabled { opacity: 0.45; cursor: default; }
    #settings-btn { margin-bottom: 8px; }
    #empty-msg {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      padding: 8px 2px;
      line-height: 1.5;
    }
    #inactive-msg {
      display: none;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      padding: 16px 4px;
      line-height: 1.5;
    }
    .cloud-disclaimer {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      background: var(--vscode-inputValidation-warningBackground, #5f3d00);
      border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
      border-radius: 3px;
      padding: 8px 10px;
      margin-bottom: 10px;
      font-size: 0.85em;
      line-height: 1.45;
    }
    .cloud-disclaimer .icon {
      flex-shrink: 0;
      font-size: 1.1em;
    }
    .cloud-disclaimer ul {
      margin: 4px 0 0;
      padding-left: 16px;
    }
    .cloud-disclaimer li { margin-bottom: 2px; }
    .provider-heading {
      font-size: 0.85em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      color: var(--vscode-descriptionForeground);
      margin: 2px 0 8px;
    }
    .card.disabled {
      opacity: 0.5;
      cursor: default;
    }
    .card.disabled .card-name { cursor: default; }
    .card.disabled label { cursor: default; }
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
    <button id="new-btn" class="toggle-btn">+ Start new Kōdo session</button>
    <button id="open-btn" class="toggle-btn">⟳ Re-open existing Kōdo session</button>

    <hr>
    <div class="radio-group">
      <label>
        <input type="radio" name="llm-mode" value="local" id="mode-local">
        Use local inference via llama.cpp
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

    document.getElementById('open-btn').addEventListener('click', () => {
      vsc.postMessage({ type: 'list_sessions' });
    });

    document.getElementById('new-btn').addEventListener('click', () => {
      vsc.postMessage({ type: 'new_session' });
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
      mode: 'local',
      cloudRegistry: {},
      activeCloudVendor: '',
      localRegistry: [],
      activeLocalModel: '',
      effectiveLocalModel: '',
      llamaInstalled: false,
      llamaVersion: '',
      llamaInstalling: false,
      llamaRunning: false,
      llamaRunningModel: '',
      llamaStarting: false,
      llamaStopping: false,
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
    // Local mode: llama.cpp action button + "Local inference settings"
    // ----------------------------------------------------------------
    function renderLlamaControls(section) {
      const hasInstalledModels = _state.localRegistry.some(m => m.installed);
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
        btnText = '▶ Start llama.cpp';
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
      actionBtn.style.height = '35px';
      actionBtn.disabled = btnDisabled;
      if (btnType) {
        actionBtn.addEventListener('click', () => { vsc.postMessage({ type: btnType }); });
      }
      section.appendChild(actionBtn);

      const settingsBtn = document.createElement('button');
      settingsBtn.id = 'settings-btn';
      settingsBtn.style.marginBottom = '8px';
      settingsBtn.style.height = '35px';
      settingsBtn.textContent = '🔧 Local inference settings';
      settingsBtn.addEventListener('click', () => {
        vsc.postMessage({ type: 'open_local_inference_settings' });
      });
      section.appendChild(settingsBtn);

      if (_state.llamaInstalled && _state.llamaVersion) {
        const ver = document.createElement('div');
        ver.style.cssText = 'font-size:0.8em;color:var(--vscode-descriptionForeground);margin-bottom:6px;';
        ver.textContent = 'llama.cpp ' + _state.llamaVersion
          + (_state.llamaRunning && _state.llamaRunningModel ? '  ·  running: ' + _state.llamaRunningModel : '');
        section.appendChild(ver);
      }
    }

    function renderLocalCards(section) {
      const installed = _state.localRegistry.filter(m => m.installed);
      if (installed.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = "Open 'Local inference settings' to install LLMs";
        section.appendChild(msg);
        return;
      }

      installed.forEach(model => {
        const isActive = _state.activeLocalModel === model.name;

        const card = document.createElement('div');
        card.className = 'card' + (isActive ? ' active' : '');
        card.dataset.name = model.name;

        const header = document.createElement('div');
        header.className = 'card-header';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'active-model';
        radio.value = model.name;
        radio.checked = isActive;
        radio.addEventListener('change', () => {
          if (radio.checked) {
            vsc.postMessage({ type: 'set_active_model', name: model.name });
          }
        });
        header.appendChild(radio);

        const nameEl = document.createElement('span');
        nameEl.className = 'card-name';
        nameEl.textContent = model.name;
        header.appendChild(nameEl);

        card.appendChild(header);

        const desc = document.createElement('div');
        desc.className = 'card-desc';
        desc.textContent = model.description;
        card.appendChild(desc);

        // Flavor picker: not offered for custom_server_url (not a process
        // kodo launches, so it has no launch args to vary) or an entry with
        // no flavors at all (every entry that reaches here normally has at
        // least a built-in/seeded "default" one — see LLM_REGISTRY.md §4.6).
        const flavors = model.flavors || [];
        if (model.kind !== 'custom_server_url' && flavors.length > 0) {
          const select = document.createElement('select');
          select.className = 'flavor-select';
          flavors.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = 'Flavor: ' + f.name;
            select.appendChild(option);
          });
          select.value = model.active_flavor || flavors[0].id;
          select.addEventListener('change', () => {
            vsc.postMessage({ type: 'set_active_flavor', name: model.name, flavor_id: select.value });
          });
          card.appendChild(select);
        }

        section.appendChild(card);
      });
    }

    // ----------------------------------------------------------------
    // Cloud mode: vendor list + "Cloud AI settings"
    // ----------------------------------------------------------------
    const DISABLED_VENDORS = ['OpenAI', 'Google', 'Meta', 'Alibaba', 'DeepSeek', 'Kimi', 'OpenRouter'];

    function renderCloudDisclaimer(section) {
      const banner = document.createElement('div');
      banner.className = 'cloud-disclaimer';

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = '⚠️';
      banner.appendChild(icon);

      const textWrap = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = 'Heads up before you switch to cloud AI:';
      textWrap.appendChild(strong);

      const list = document.createElement('ul');
      [
        "Kōdo's prompts were not optimized for cloud-hosted LLMs.",
        'Kōdo may drain an excessive amount of tokens while working on your prompts.',
        "Kōdo hasn't been tested with cloud-hosted LLMs as thoroughly as it has with local LLMs.",
      ].forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      });
      textWrap.appendChild(list);
      banner.appendChild(textWrap);

      section.appendChild(banner);
    }

    function renderCloudControls(section) {
      renderCloudDisclaimer(section);

      const settingsBtn = document.createElement('button');
      settingsBtn.id = 'settings-btn';
      settingsBtn.style.marginBottom = '8px';
      settingsBtn.style.height = '35px';
      settingsBtn.textContent = 'Cloud AI settings';
      settingsBtn.addEventListener('click', () => {
        vsc.postMessage({ type: 'open_cloud_ai_settings' });
      });
      section.appendChild(settingsBtn);

      const hr = document.createElement('hr');
      section.appendChild(hr);

      const heading = document.createElement('div');
      heading.className = 'provider-heading';
      heading.textContent = 'Select LLM provider';
      section.appendChild(heading);

      const vendors = Object.keys(_state.cloudRegistry);

      vendors.forEach(vendor => {
        const info = _state.cloudRegistry[vendor];
        const isActive = _state.activeCloudVendor === vendor;

        const card = document.createElement('div');
        card.className = 'card' + (isActive ? ' active' : '');

        const header = document.createElement('div');
        header.className = 'card-header';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'active-vendor';
        radio.value = vendor;
        radio.checked = isActive;
        radio.addEventListener('change', () => {
          if (radio.checked) {
            vsc.postMessage({ type: 'set_cloud_vendor', vendor });
          }
        });
        header.appendChild(radio);

        const nameEl = document.createElement('span');
        nameEl.className = 'card-name';
        nameEl.textContent = info.display_name;
        header.appendChild(nameEl);

        card.appendChild(header);
        section.appendChild(card);
      });

      DISABLED_VENDORS.forEach(label => {
        const card = document.createElement('div');
        card.className = 'card disabled';

        const header = document.createElement('div');
        header.className = 'card-header';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'active-vendor';
        radio.disabled = true;
        header.appendChild(radio);

        const nameEl = document.createElement('span');
        nameEl.className = 'card-name';
        nameEl.textContent = label;
        header.appendChild(nameEl);

        card.appendChild(header);
        section.appendChild(card);
      });
    }

    function renderCards() {
      const section = document.getElementById('cards-section');
      section.innerHTML = '';

      if (_state.mode === 'local') {
        renderLlamaControls(section);
        renderLocalCards(section);
      } else {
        renderCloudControls(section);
      }
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

      // Mode radio
      const radio = document.querySelector('input[value="' + data.mode + '"]');
      if (radio) { radio.checked = true; }

      // Update local state for cards
      _state.mode = data.mode || _state.mode;
      _state.cloudRegistry = data.cloudRegistry || _state.cloudRegistry;
      _state.activeCloudVendor = data.activeCloudVendor !== undefined
        ? data.activeCloudVendor : _state.activeCloudVendor;
      _state.localRegistry = data.localRegistry || _state.localRegistry;
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
