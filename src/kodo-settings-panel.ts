import * as vscode from 'vscode';

/** A globally-granted "always allow" rule (doc/SECURITY_RULES_PLAN.md §2.7,
 * kodo/doc/WS_PROTOCOL.md §7.6c). `kind: "command"` is an (executable,
 * subcommand) pair; `kind: "path"` is a workspace-escape (executable,
 * resolved absolute path) pair. */
export interface GlobalRuleEntry {
  kind: 'command' | 'path';
  executable: string;
  value: string;
}

/** The `stuck_detection` settings block (kodo/doc/SETTINGS.md §2.6,
 * kodo/doc/WS_PROTOCOL.md §7.6d) — backs the Kōdo Settings panel's
 * "General" section. */
export interface StuckDetectionSettings {
  active: 'off' | 'local_only' | 'local_and_cloud';
  scope: 'top_level' | 'top_level_and_subagents';
  auto_unstuck_interactive: boolean;
}

/** llama.cpp install state backing the "Llama.cpp" section (kodo/doc/
 * WS_PROTOCOL.md §7.6, `llamacpp.version_info`). `installedVersion`/
 * `latestVersion` are `"bN"` strings or `null` ("not installed"/"unknown" —
 * the latter only when the GitHub Releases fetch failed). `busy` disables
 * every button while an install/update/uninstall is in flight. */
export interface LlamaCppInfo {
  installedVersion: string | null;
  latestVersion: string | null;
  busy: boolean;
}

export interface KodoSettingsState {
  rules: GlobalRuleEntry[];
  stuckDetection: StuckDetectionSettings;
  llamaCpp: LlamaCppInfo;
}

export type KodoSettingsMessage =
  | { type: 'ready' }
  | { type: 'delete_rules'; rules: GlobalRuleEntry[] }
  | ({ type: 'set_stuck_detection' } & StuckDetectionSettings)
  | { type: 'install_llamacpp' }
  | { type: 'uninstall_llamacpp' }
  | { type: 'update_llamacpp' }
  | { type: 'install_llamacpp_version_prompt' }
  | { type: 'close' };

/** Singleton settings panel — reveals the existing one instead of opening a second. */
export class KodoSettingsPanel {
  private static current: KodoSettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private state: KodoSettingsState;

  static createOrShow(
    initialState: KodoSettingsState,
    onMessage: (msg: KodoSettingsMessage) => void,
  ): KodoSettingsPanel {
    if (KodoSettingsPanel.current) {
      KodoSettingsPanel.current.panel.reveal();
      return KodoSettingsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'kodoSettings',
      'Kōdo Settings',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new KodoSettingsPanel(panel, initialState, onMessage);
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
    panel: vscode.WebviewPanel,
    initialState: KodoSettingsState,
    private readonly onMessage: (msg: KodoSettingsMessage) => void,
  ) {
    this.panel = panel;
    this.state = initialState;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = buildHtml();
    panel.webview.onDidReceiveMessage((msg: KodoSettingsMessage) => {
      if (msg.type === 'ready') {
        this._post();
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
  <title>Kōdo Settings</title>
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
      width: 190px;
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
      margin: 0 0 16px;
    }
    .section-subheading {
      font-weight: 600;
      margin: 0 0 8px;
      font-size: 0.98em;
    }
    .section-divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      margin: 4px 0 16px;
    }
    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0 0 14px;
    }
    .radio-row, .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.92em;
      user-select: none;
      margin-bottom: 6px;
    }
    .radio-row input, .checkbox-row input {
      margin: 0;
      cursor: pointer;
      flex-shrink: 0;
    }
    .checkbox-row:has(input:disabled) {
      opacity: 0.5;
      cursor: default;
    }
    .checkbox-row input:disabled {
      cursor: default;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    a { color: var(--vscode-textLink-foreground); }
    .value-line {
      font-size: 0.92em;
      margin: 0 0 6px;
    }
    .value-code {
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .btn-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 10px 0 14px;
      flex-wrap: wrap;
    }
    .btn-row button {
      display: inline-block;
      width: auto;
    }
    .btn-separator {
      width: 1px;
      align-self: stretch;
      background: var(--vscode-panel-border, var(--vscode-widget-border, #444));
    }
    button {
      display: block;
      padding: 6px 10px;
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
    .toolbar button {
      display: inline-block;
      width: auto;
    }
    #delete-btn:not(:disabled) {
      background: var(--vscode-errorForeground, #f44336);
      color: #fff;
    }
    #delete-btn:not(:disabled):hover { opacity: 0.9; }
    .rule-table {
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      border-radius: 4px;
      overflow: hidden;
    }
    .rule-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
    }
    .rule-row:first-child { border-top: none; }
    .rule-row input[type="checkbox"] {
      flex-shrink: 0;
      cursor: pointer;
      margin: 0;
    }
    .rule-kind-badge {
      flex-shrink: 0;
      font-size: 0.75em;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .rule-text {
      flex: 1;
      min-width: 0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rule-executable { font-weight: 600; }
    #empty-msg {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      padding: 10px 2px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="nav" id="nav"></div>
    <div class="content" id="content">
      <p id="content-placeholder" style="color:var(--vscode-descriptionForeground);padding:16px 24px;">Loading Kōdo settings…</p>
    </div>
  </div>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();
    vsc.postMessage({ type: 'ready' });

    const NAV = [
      { key: 'general', label: 'General' },
      { key: 'global-rules', label: 'Global Allow-Rules' },
    ];

    let _state = {
      rules: [],
      stuckDetection: { active: 'local_only', scope: 'top_level', auto_unstuck_interactive: false },
      llamaCpp: { installedVersion: null, latestVersion: null, busy: false },
    };
    let _selectedKey = 'general';
    const _checked = new Set();

    function ruleKey(rule) {
      return rule.kind + '|' + rule.executable + '|' + rule.value;
    }

    function renderNav() {
      const nav = document.getElementById('nav');
      nav.innerHTML = '';
      NAV.forEach(({ key, label }) => {
        const item = document.createElement('div');
        item.className = 'nav-item' + (key === _selectedKey ? ' active' : '');
        item.textContent = label;
        item.addEventListener('click', () => {
          _selectedKey = key;
          render();
        });
        nav.appendChild(item);
      });
    }

    function renderToolbar(section) {
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';

      const selectAllBtn = document.createElement('button');
      selectAllBtn.className = 'secondary-btn';
      selectAllBtn.textContent = 'Select All';
      selectAllBtn.disabled = _state.rules.length === 0;
      selectAllBtn.addEventListener('click', () => {
        _state.rules.forEach(r => _checked.add(ruleKey(r)));
        render();
      });
      toolbar.appendChild(selectAllBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'secondary-btn';
      clearBtn.textContent = 'Clear Selection';
      clearBtn.disabled = _checked.size === 0;
      clearBtn.addEventListener('click', () => {
        _checked.clear();
        render();
      });
      toolbar.appendChild(clearBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.id = 'delete-btn';
      deleteBtn.textContent = 'Delete Selected';
      deleteBtn.disabled = _checked.size === 0;
      deleteBtn.addEventListener('click', () => {
        const rules = _state.rules.filter(r => _checked.has(ruleKey(r)));
        if (rules.length === 0) { return; }
        vsc.postMessage({ type: 'delete_rules', rules });
        _checked.clear();
      });
      toolbar.appendChild(deleteBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'secondary-btn';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => {
        vsc.postMessage({ type: 'close' });
      });
      toolbar.appendChild(closeBtn);

      section.appendChild(toolbar);
    }

    function renderRuleRow(rule) {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = _checked.has(ruleKey(rule));
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) { _checked.add(ruleKey(rule)); }
        else { _checked.delete(ruleKey(rule)); }
        render();
      });
      row.appendChild(checkbox);

      const badge = document.createElement('span');
      badge.className = 'rule-kind-badge';
      badge.textContent = rule.kind === 'path' ? 'path access' : 'run_command';
      row.appendChild(badge);

      const text = document.createElement('span');
      text.className = 'rule-text';
      text.title = rule.executable + ' ' + rule.value;
      const exe = document.createElement('span');
      exe.className = 'rule-executable';
      exe.textContent = rule.executable;
      text.appendChild(exe);
      text.appendChild(document.createTextNode(
        rule.kind === 'path' ? '  →  ' + rule.value : '  ' + rule.value
      ));
      row.appendChild(text);

      return row;
    }

    function renderGlobalRulesSection() {
      const wrap = document.createElement('div');

      const heading = document.createElement('h2');
      heading.textContent = 'Global Allow-Rules';
      wrap.appendChild(heading);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = "Commands and paths you told Kōdo to always allow, machine-wide, "
        + "when it asked permission — these apply across every project and session "
        + "on this machine and are never asked about again until you delete them here.";
      wrap.appendChild(intro);

      renderToolbar(wrap);

      if (_state.rules.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = "No global allow-rules yet — they're added from a permission "
          + "prompt's 'always allow' checkbox when you choose the 'global' scope.";
        wrap.appendChild(msg);
        return wrap;
      }

      const table = document.createElement('div');
      table.className = 'rule-table';
      _state.rules.forEach(rule => table.appendChild(renderRuleRow(rule)));
      wrap.appendChild(table);

      return wrap;
    }

    const LLAMACPP_RELEASES_URL = 'https://github.com/ggml-org/llama.cpp/releases';

    function renderLlamaCppSection() {
      const wrap = document.createElement('div');

      const subheading = document.createElement('div');
      subheading.className = 'section-subheading';
      subheading.textContent = 'Llama.cpp';
      wrap.appendChild(subheading);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = 'llama.cpp is the local inference engine Kōdo uses to run models on '
        + "this machine. Install, update, or remove it here, and see how the installed build "
        + 'compares to the latest one published on GitHub.';
      wrap.appendChild(intro);

      const installedLine = document.createElement('p');
      installedLine.className = 'value-line';
      installedLine.appendChild(document.createTextNode('Installed version: '));
      const installedValue = document.createElement('span');
      installedValue.className = 'value-code';
      installedValue.textContent = _state.llamaCpp.installedVersion || 'not installed yet';
      installedLine.appendChild(installedValue);
      wrap.appendChild(installedLine);

      const latestLine = document.createElement('p');
      latestLine.className = 'value-line';
      latestLine.appendChild(document.createTextNode('Latest version available at GitHub: '));
      if (_state.llamaCpp.latestVersion) {
        const link = document.createElement('a');
        link.href = LLAMACPP_RELEASES_URL;
        link.className = 'value-code';
        link.textContent = _state.llamaCpp.latestVersion;
        latestLine.appendChild(link);
      } else {
        const unknown = document.createElement('span');
        unknown.className = 'value-code';
        unknown.textContent = 'unknown';
        latestLine.appendChild(unknown);
      }
      wrap.appendChild(latestLine);

      const installed = Boolean(_state.llamaCpp.installedVersion);
      const busy = _state.llamaCpp.busy;

      const btnRow = document.createElement('div');
      btnRow.className = 'btn-row';

      const installUpdateBtn = document.createElement('button');
      installUpdateBtn.textContent = installed ? 'Update llama.cpp' : 'Install llama.cpp';
      installUpdateBtn.disabled = busy;
      installUpdateBtn.addEventListener('click', () => {
        vsc.postMessage({ type: installed ? 'update_llamacpp' : 'install_llamacpp' });
      });
      btnRow.appendChild(installUpdateBtn);

      const sep1 = document.createElement('span');
      sep1.className = 'btn-separator';
      btnRow.appendChild(sep1);

      const specificBtn = document.createElement('button');
      specificBtn.className = 'secondary-btn';
      specificBtn.textContent = 'Install specific version…';
      specificBtn.disabled = busy;
      specificBtn.addEventListener('click', () => {
        vsc.postMessage({ type: 'install_llamacpp_version_prompt' });
      });
      btnRow.appendChild(specificBtn);

      if (installed) {
        const sep2 = document.createElement('span');
        sep2.className = 'btn-separator';
        btnRow.appendChild(sep2);

        const uninstallBtn = document.createElement('button');
        uninstallBtn.className = 'secondary-btn';
        uninstallBtn.textContent = 'Uninstall llama.cpp';
        uninstallBtn.disabled = busy;
        uninstallBtn.addEventListener('click', () => {
          vsc.postMessage({ type: 'uninstall_llamacpp' });
        });
        btnRow.appendChild(uninstallBtn);
      }

      wrap.appendChild(btnRow);

      return wrap;
    }

    const STUCK_ACTIVE_OPTIONS = [
      ['off', 'Off'],
      ['local_only', 'Only for local LLMs'],
      ['local_and_cloud', 'Both local LLMs and cloud LLMs'],
    ];

    function postStuckDetection() {
      vsc.postMessage({ type: 'set_stuck_detection', ..._state.stuckDetection });
    }

    function renderGeneralSection() {
      const wrap = document.createElement('div');

      const heading = document.createElement('h2');
      heading.textContent = 'General';
      wrap.appendChild(heading);

      const topDivider = document.createElement('hr');
      topDivider.className = 'section-divider';
      wrap.appendChild(topDivider);

      wrap.appendChild(renderLlamaCppSection());

      const midDivider = document.createElement('hr');
      midDivider.className = 'section-divider';
      wrap.appendChild(midDivider);

      const subheading = document.createElement('div');
      subheading.className = 'section-subheading';
      subheading.textContent = 'Detect Stuck Agentic Workflows';
      wrap.appendChild(subheading);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = "Sometimes a model stops before it's actually finished a task — for "
        + 'example, it replies with nothing useful, or just "Done." When Kōdo notices this '
        + 'happening, it can nudge the model to pick up where it left off and finish the job.';
      wrap.appendChild(intro);

      const radioGroup = document.createElement('div');
      radioGroup.className = 'radio-group';
      STUCK_ACTIVE_OPTIONS.forEach(([value, label]) => {
        const row = document.createElement('label');
        row.className = 'radio-row';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'stuck-active';
        input.value = value;
        input.checked = _state.stuckDetection.active === value;
        input.addEventListener('change', () => {
          if (!input.checked) { return; }
          _state.stuckDetection = { ..._state.stuckDetection, active: value };
          postStuckDetection();
          render();
        });
        row.appendChild(input);
        row.appendChild(document.createTextNode(label));
        radioGroup.appendChild(row);
      });
      wrap.appendChild(radioGroup);

      const disabled = _state.stuckDetection.active === 'off';

      const scopeRow = document.createElement('label');
      scopeRow.className = 'checkbox-row';
      const scopeInput = document.createElement('input');
      scopeInput.type = 'checkbox';
      scopeInput.checked = _state.stuckDetection.scope === 'top_level_and_subagents';
      scopeInput.disabled = disabled;
      scopeInput.addEventListener('change', () => {
        _state.stuckDetection = {
          ..._state.stuckDetection,
          scope: scopeInput.checked ? 'top_level_and_subagents' : 'top_level',
        };
        postStuckDetection();
        render();
      });
      scopeRow.appendChild(scopeInput);
      scopeRow.appendChild(document.createTextNode('Also watch sub-agent turns'));
      wrap.appendChild(scopeRow);

      const autoRow = document.createElement('label');
      autoRow.className = 'checkbox-row';
      const autoInput = document.createElement('input');
      autoInput.type = 'checkbox';
      autoInput.checked = _state.stuckDetection.auto_unstuck_interactive;
      autoInput.disabled = disabled;
      autoInput.addEventListener('change', () => {
        _state.stuckDetection = {
          ..._state.stuckDetection,
          auto_unstuck_interactive: autoInput.checked,
        };
        postStuckDetection();
        render();
      });
      autoRow.appendChild(autoInput);
      autoRow.appendChild(document.createTextNode('Nudge LLM automatically without asking me'));
      wrap.appendChild(autoRow);

      return wrap;
    }

    function render() {
      renderNav();
      const content = document.getElementById('content');
      content.innerHTML = '';
      if (_selectedKey === 'general') {
        content.appendChild(renderGeneralSection());
      } else {
        content.appendChild(renderGlobalRulesSection());
      }
    }

    window.addEventListener('message', ({ data }) => {
      if (data.type !== 'update') { return; }
      if (Array.isArray(data.rules)) {
        const keys = new Set(data.rules.map(ruleKey));
        [..._checked].forEach(k => { if (!keys.has(k)) { _checked.delete(k); } });
        _state.rules = data.rules;
      }
      if (data.stuckDetection && typeof data.stuckDetection === 'object') {
        _state.stuckDetection = data.stuckDetection;
      }
      if (data.llamaCpp && typeof data.llamaCpp === 'object') {
        _state.llamaCpp = data.llamaCpp;
      }
      render();
    });

    // Render the initial structure synchronously on script load rather than
    // waiting for the first host->webview 'update' message. Every pixel of this
    // panel (nav, toolbar, list) is produced by render(); with no static shell
    // in the body, a missed/late first message would otherwise leave the two
    // divs completely empty. The 'update' handler above still refreshes the
    // rule rows once the async security.rules.list round-trip resolves.
    render();
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
