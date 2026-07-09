import * as vscode from 'vscode';
import type { ApiKeyEntry } from './cloud-credentials';
import type { CloudRegistry, EffortLevel } from './llm-registry-types';
import { EFFORT_LABELS, EFFORT_LEVELS } from './llm-registry-types';

export interface CloudAiSettingsState {
  cloudRegistry: CloudRegistry;
  /** vendor -> effort -> model_id, mirrors settings.json models.cloud. */
  modelsByVendor: Record<string, Record<string, string>>;
  /** vendor -> its configured API keys. */
  keysByVendor: Record<string, ApiKeyEntry[]>;
}

export type CloudAiSettingsMessage =
  | { type: 'ready' }
  | { type: 'set_cloud_model'; vendor: string; effort: EffortLevel; model_id: string }
  | { type: 'add_key'; vendor: string; name: string; secret: string }
  | { type: 'forget_key'; vendor: string; uuid: string }
  | { type: 'make_active'; vendor: string; uuid: string };

/** Singleton settings panel — reveals the existing one instead of opening a second. */
export class CloudAiSettingsPanel {
  private static current: CloudAiSettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private state: CloudAiSettingsState;

  static createOrShow(
    initialState: CloudAiSettingsState,
    onMessage: (msg: CloudAiSettingsMessage) => void,
  ): CloudAiSettingsPanel {
    if (CloudAiSettingsPanel.current) {
      CloudAiSettingsPanel.current.panel.reveal();
      return CloudAiSettingsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'kodoCloudAiSettings',
      'Cloud AI Settings',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new CloudAiSettingsPanel(panel, initialState, onMessage);
    CloudAiSettingsPanel.current = instance;
    panel.onDidDispose(() => {
      CloudAiSettingsPanel.current = undefined;
    });
    return instance;
  }

  static get instance(): CloudAiSettingsPanel | undefined {
    return CloudAiSettingsPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    initialState: CloudAiSettingsState,
    private readonly onMessage: (msg: CloudAiSettingsMessage) => void,
  ) {
    this.panel = panel;
    this.state = initialState;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = buildHtml();
    panel.webview.onDidReceiveMessage((msg: CloudAiSettingsMessage) => {
      if (msg.type === 'ready') {
        this._post();
        return;
      }
      this.onMessage(msg);
    });
  }

  update(patch: Partial<CloudAiSettingsState>): void {
    this.state = { ...this.state, ...patch };
    this._post();
  }

  private _post(): void {
    void this.panel.webview.postMessage({ type: 'update', ...this.state });
  }
}

function buildHtml(): string {
  const nonce = genNonce();
  const effortLevelsJson = JSON.stringify(EFFORT_LEVELS);
  const effortLabelsJson = JSON.stringify(EFFORT_LABELS);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Cloud AI Settings</title>
  <style nonce="${nonce}">
    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    h2 { font-size: 1.15em; margin: 0 0 10px; }
    .layout {
      display: flex;
      align-items: stretch;
      min-height: 100vh;
    }
    .nav {
      width: 170px;
      flex-shrink: 0;
      padding: 16px 8px;
      border-right: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      box-sizing: border-box;
    }
    .nav-item {
      padding: 7px 10px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      font-size: 0.92em;
      margin-bottom: 2px;
    }
    .nav-item:hover { background: var(--vscode-list-hoverBackground); }
    .nav-item.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
      font-weight: 600;
    }
    .content {
      flex: 1;
      min-width: 0;
      padding: 16px 24px;
      box-sizing: border-box;
    }
    .intro-text {
      color: var(--vscode-descriptionForeground);
      font-size: 0.92em;
      line-height: 1.5;
      max-width: 640px;
      margin: 0 0 18px;
    }
    .section-heading {
      font-size: 0.95em;
      font-weight: 600;
      margin: 0 0 8px;
    }
    .keys-section { margin-bottom: 22px; }
    .effort-section {
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      padding: 14px 0;
    }
    .effort-section:last-child { padding-bottom: 0; }
    .effort-title { font-weight: 600; margin-bottom: 4px; font-size: 0.95em; }
    .effort-example {
      font-size: 0.85em;
      font-style: italic;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    select.model-select {
      width: 100%;
      max-width: 360px;
      padding: 4px 6px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .model-detail {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .model-name { font-weight: 500; font-size: 0.92em; }
    .model-recommendation {
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
    }
    button {
      padding: 5px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .secondary-btn {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      font-size: 0.85em;
      padding: 3px 8px;
    }
    .secondary-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    #add-key-btn { margin-bottom: 10px; }
    .key-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
    }
    .key-row:first-of-type { border-top: none; }
    .key-name { flex: 1; }
    .key-active-badge {
      font-size: 0.78em;
      padding: 1px 6px;
      border-radius: 3px;
      background: #4caf5033;
      color: #4caf50;
    }
    #no-keys-msg { color: var(--vscode-descriptionForeground); font-size: 0.9em; padding: 6px 0; }
    .coming-soon {
      max-width: 480px;
      padding: 0px 0;
    }
    .coming-soon .icon { font-size: 2.4em; margin-bottom: 6px; }
    .coming-soon h2 { margin-bottom: 6px; }
    .coming-soon p {
      color: var(--vscode-descriptionForeground);
      font-size: 0.92em;
      line-height: 1.5;
    }
    .coming-soon .badge {
      display: inline-block;
      margin-top: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.78em;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-overlay.open { display: flex; }
    .modal-dialog {
      width: 380px;
      max-width: calc(100vw - 40px);
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 4px;
      padding: 18px 20px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
    .modal-dialog h3 { margin: 0 0 6px; font-size: 1.05em; }
    .modal-dialog .modal-intro {
      color: var(--vscode-descriptionForeground);
      font-size: 0.88em;
      line-height: 1.4;
      margin: 0 0 14px;
    }
    .modal-field { margin-bottom: 12px; }
    .modal-field label {
      display: block;
      font-size: 0.85em;
      margin-bottom: 4px;
    }
    .modal-field input {
      width: 100%;
      box-sizing: border-box;
      padding: 5px 7px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .modal-field input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="nav" id="nav"></div>
    <div class="content" id="content"></div>
  </div>

  <div class="modal-overlay" id="add-key-modal">
    <div class="modal-dialog" role="dialog" aria-modal="true">
      <h3 id="add-key-modal-title">Add API key</h3>
      <p class="modal-intro" id="add-key-modal-intro"></p>
      <div class="modal-field">
        <label for="add-key-name">Key name</label>
        <input type="text" id="add-key-name" placeholder="e.g. work, personal" autocomplete="off">
      </div>
      <div class="modal-field">
        <label for="add-key-secret">API key</label>
        <input type="password" id="add-key-secret" placeholder="Paste API key" autocomplete="off">
      </div>
      <div class="modal-actions">
        <button class="secondary-btn" id="add-key-cancel-btn">Cancel</button>
        <button id="add-key-confirm-btn">Add API key</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();
    vsc.postMessage({ type: 'ready' });

    const EFFORT_LEVELS = ${effortLevelsJson};
    const EFFORT_LABELS = ${effortLabelsJson};

    const EFFORT_EXAMPLES = {
      low: 'Example workload: renaming a variable across a few files, formatting cleanup, drafting a commit message.',
      medium: 'Example workload: implementing a small feature end-to-end, fixing a bug that touches a couple of files.',
      high: 'Example workload: refactoring a subsystem, debugging a subtle concurrency issue, reviewing a large diff.',
      max: 'Example workload: architecting a cross-cutting feature, untangling a gnarly production incident, deep multi-file refactors under tight constraints.',
    };

    const VENDOR_NAV = [
      { key: 'anthropic', label: '⚛️ Anthropic' },
      { key: 'openai', label: '🧠 OpenAI' },
      { key: 'google', label: '✨ Google' },
      { key: 'meta', label: '🦙 Meta' },
      { key: 'alibaba', label: '🧞 Alibaba' },
      { key: 'deepseek', label: '🐋 DeepSeek' },
      { key: 'kimi', label: '🌙 Kimi' },
      { key: 'openrouter', label: '🔀 OpenRouter' },
    ];

    const LLM_VENDORS = {
      anthropic: { icon: '⚛️', coming_soon_text: "" },
      openai: { icon: '🧠', coming_soon_text: "GPT models are being wired up next. Once ready, you'll be able to add OpenAI API keys and assign GPT models to each effort level right here." },
      google: { icon: '✨', coming_soon_text: "Gemini is next on the roadmap. When it ships, a Google API key here will route each effort level straight to a Gemini model." },
      meta: { icon: '🦙', coming_soon_text: "Llama model support is on the way. This page will let you manage Meta API access and pick a Llama model per effort level." },
      alibaba: { icon: '🧞', coming_soon_text: "Qwen support is queued up behind the scenes. Drop in an Alibaba API key once it lands, and pick a Qwen model for each effort level." },
      deepseek: { icon: '🐋', coming_soon_text: "DeepSeek's reasoning models are being integrated. Check back soon to configure DeepSeek access and effort-level assignments." },
      kimi: { icon: '🌙', coming_soon_text: "Kimi support is in the pipeline. Soon you'll be able to bring your own Kimi API key and route work to its models here." },
      openrouter: { icon: '🔀', coming_soon_text: "OpenRouter will let you tap into many vendors through a single key. We're building the plumbing — this page will host that configuration." },
    };

    let _state = { cloudRegistry: {}, modelsByVendor: {}, keysByVendor: {} };
    let _selectedVendor = 'anthropic';

    function renderNav() {
      const nav = document.getElementById('nav');
      nav.innerHTML = '';
      VENDOR_NAV.forEach(({ key, label }) => {
        const item = document.createElement('div');
        item.className = 'nav-item' + (key === _selectedVendor ? ' active' : '');
        item.textContent = label;
        item.addEventListener('click', () => {
          _selectedVendor = key;
          render();
        });
        nav.appendChild(item);
      });
    }

    function renderKeysSection(vendor, info) {
      const section = document.createElement('div');
      section.className = 'keys-section';

      const heading = document.createElement('div');
      heading.className = 'section-heading';
      heading.textContent = 'API access keys';
      section.appendChild(heading);

      const keys = _state.keysByVendor[vendor] || [];
      if (keys.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'no-keys-msg';
        msg.textContent = 'No API keys configured for ' + info.display_name + ' yet.';
        section.appendChild(msg);
      } else {
        keys.forEach(key => {
          const row = document.createElement('div');
          row.className = 'key-row';

          const name = document.createElement('span');
          name.className = 'key-name';
          name.textContent = key.name;
          row.appendChild(name);

          if (key.active) {
            const badge = document.createElement('span');
            badge.className = 'key-active-badge';
            badge.textContent = 'Active';
            row.appendChild(badge);
          } else {
            const makeActiveBtn = document.createElement('button');
            makeActiveBtn.className = 'secondary-btn';
            makeActiveBtn.textContent = 'Make active';
            makeActiveBtn.addEventListener('click', () => {
              vsc.postMessage({ type: 'make_active', vendor, uuid: key.uuid });
            });
            row.appendChild(makeActiveBtn);
          }

          const forgetBtn = document.createElement('button');
          forgetBtn.className = 'secondary-btn';
          forgetBtn.textContent = 'Forget this key';
          forgetBtn.addEventListener('click', () => {
            vsc.postMessage({ type: 'forget_key', vendor, uuid: key.uuid });
          });
          row.appendChild(forgetBtn);

          section.appendChild(row);
        });
      }

      const addBtn = document.createElement('button');
      addBtn.id = 'add-key-btn';
      addBtn.style.marginTop = '15px';
      addBtn.textContent = 'Add new API access key';
      addBtn.addEventListener('click', () => openAddKeyModal(vendor, info.display_name));
      section.appendChild(addBtn);

      return section;
    }

    function renderEffortSection(vendor, info, effort) {
      const vendorModels = _state.modelsByVendor[vendor] || {};
      const section = document.createElement('div');
      section.className = 'effort-section';

      const title = document.createElement('div');
      title.className = 'effort-title';
      title.textContent = EFFORT_LABELS[effort];
      section.appendChild(title);

      const example = document.createElement('div');
      example.className = 'effort-example';
      example.textContent = EFFORT_EXAMPLES[effort];
      section.appendChild(example);

      const select = document.createElement('select');
      select.className = 'model-select';
      info.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.model_id;
        option.textContent = model.name;
        select.appendChild(option);
      });
      const current = vendorModels[effort];
      if (current && info.models.some(m => m.model_id === current)) {
        select.value = current;
      }
      section.appendChild(select);

      const detail = document.createElement('div');
      detail.className = 'model-detail';
      section.appendChild(detail);

      function renderDetail() {
        detail.innerHTML = '';
        const selected = info.models.find(m => m.model_id === select.value);
        if (!selected) { return; }
        const name = document.createElement('span');
        name.className = 'model-name';
        name.textContent = selected.name;
        detail.appendChild(name);
        if (selected.recommendation) {
          const rec = document.createElement('span');
          rec.className = 'model-recommendation';
          rec.textContent = selected.recommendation;
          detail.appendChild(rec);
        }
      }
      renderDetail();

      select.addEventListener('change', () => {
        vsc.postMessage({ type: 'set_cloud_model', vendor, effort, model_id: select.value });
        renderDetail();
      });

      return section;
    }

    function renderAnthropicPanel(vendor, info) {
      const wrap = document.createElement('div');

      const heading = document.createElement('h2');
      const icon = LLM_VENDORS['anthropic'].icon;
      heading.textContent = icon + ' ' + info.display_name + ' LLMs';
      wrap.appendChild(heading);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = 'Configure access to ' + info.display_name + "'s models: add or remove API access tokens, and choose which model handles each level of effort, from quick low-effort subagent tasks up to the hardest max-effort problems.";
      wrap.appendChild(intro);

      wrap.appendChild(renderKeysSection(vendor, info));

      EFFORT_LEVELS.forEach(effort => {
        wrap.appendChild(renderEffortSection(vendor, info, effort));
      });

      return wrap;
    }

    function renderComingSoon(vendorKey, label) {
      const wrap = document.createElement('div');
      wrap.className = 'coming-soon';

      const info = LLM_VENDORS[vendorKey] || { icon: '🧩', coming_soon_text: 'Support for this vendor is on the way.' };

      // const icon = document.createElement('div');
      // icon.className = 'icon';
      // icon.textContent = info.icon;
      // wrap.appendChild(icon);

      const heading = document.createElement('h2');
      heading.textContent = label;
      wrap.appendChild(heading);

      const text = document.createElement('p');
      text.textContent = info.coming_soon_text;
      wrap.appendChild(text);

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Coming soon';
      wrap.appendChild(badge);

      return wrap;
    }

    function render() {
      renderNav();
      const content = document.getElementById('content');
      content.innerHTML = '';
      const navEntry = VENDOR_NAV.find(v => v.key === _selectedVendor) || VENDOR_NAV[0];
      if (_selectedVendor === 'anthropic') {
        const info = _state.cloudRegistry['anthropic'];
        if (info) {
          content.appendChild(renderAnthropicPanel('anthropic', info));
        } else {
          content.appendChild(renderComingSoon('anthropic', navEntry.label));
        }
      } else {
        content.appendChild(renderComingSoon(_selectedVendor, navEntry.label));
      }
    }

    const addKeyModal = document.getElementById('add-key-modal');
    const addKeyModalIntro = document.getElementById('add-key-modal-intro');
    const addKeyNameInput = document.getElementById('add-key-name');
    const addKeySecretInput = document.getElementById('add-key-secret');
    let _addKeyVendor = null;

    function openAddKeyModal(vendor, vendorLabel) {
      _addKeyVendor = vendor;
      addKeyModalIntro.textContent = 'This API key will be used for ' + vendorLabel + '.';
      addKeyNameInput.value = '';
      addKeySecretInput.value = '';
      addKeyModal.classList.add('open');
      addKeyNameInput.focus();
    }

    function closeAddKeyModal() {
      addKeyModal.classList.remove('open');
      _addKeyVendor = null;
    }

    document.getElementById('add-key-cancel-btn').addEventListener('click', closeAddKeyModal);
    addKeyModal.addEventListener('click', (e) => {
      if (e.target === addKeyModal) { closeAddKeyModal(); }
    });
    document.getElementById('add-key-confirm-btn').addEventListener('click', () => {
      const name = addKeyNameInput.value.trim();
      const secret = addKeySecretInput.value.trim();
      if (!name || !secret || !_addKeyVendor) { return; }
      vsc.postMessage({ type: 'add_key', vendor: _addKeyVendor, name, secret });
      closeAddKeyModal();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && addKeyModal.classList.contains('open')) { closeAddKeyModal(); }
    });

    window.addEventListener('message', ({ data }) => {
      if (data.type !== 'update') { return; }
      _state.cloudRegistry = data.cloudRegistry || _state.cloudRegistry;
      _state.modelsByVendor = data.modelsByVendor || _state.modelsByVendor;
      _state.keysByVendor = data.keysByVendor || _state.keysByVendor;
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
