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

export interface KodoSettingsState {
  rules: GlobalRuleEntry[];
}

export type KodoSettingsMessage =
  | { type: 'ready' }
  | { type: 'delete_rules'; rules: GlobalRuleEntry[] }
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
    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      flex-wrap: wrap;
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
    button:disabled {
      opacity: 0.45;
      cursor: default;
      background: var(--vscode-button-background);
    }
    .secondary-btn {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    .secondary-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
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
      { key: 'global-rules', label: 'Global Allow-Rules' },
    ];

    let _state = { rules: [] };
    let _selectedKey = 'global-rules';
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
        + "the last time it asked permission — these apply across every project and session "
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

    function render() {
      renderNav();
      const content = document.getElementById('content');
      content.innerHTML = '';
      content.appendChild(renderGlobalRulesSection());
    }

    window.addEventListener('message', ({ data }) => {
      if (data.type !== 'update') { return; }
      if (Array.isArray(data.rules)) {
        const keys = new Set(data.rules.map(ruleKey));
        [..._checked].forEach(k => { if (!keys.has(k)) { _checked.delete(k); } });
        _state.rules = data.rules;
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
