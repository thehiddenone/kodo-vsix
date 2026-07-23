import * as vscode from 'vscode';
import type { RememberedWorkspace } from './workspace-resume-policy';

/** A granted "always allow" rule (doc/SECURITY_RULES_PLAN.md §2.7,
 * kodo/doc/WS_PROTOCOL.md §7.6c/§7.6e). `kind: "command"` is an (executable,
 * subcommand) pair; `kind: "path"` is a workspace-escape (executable,
 * resolved absolute path) pair. Same shape for both the global store
 * (`security.rules.*`) and a single session's store
 * (`session.security_rules.*`). */
export interface GlobalRuleEntry {
  kind: 'command' | 'path';
  executable: string;
  value: string;
}

/** One row of the Kōdo Settings panel's "Sessions" list — the same data
 * `pickSession()` already parses from `session.list` (kodo/doc/WS_PROTOCOL.md
 * § "New client→server: session.list"), reused here so opening the panel
 * needs no extra round-trip beyond the one `session.list` fetch. */
export interface SessionListEntry {
  id: string;
  name: string;
  projectRoot: string | null;
  taken: boolean;
  workspace: RememberedWorkspace | null;
}

/** The session-scoped allow-rules currently shown in the "Session Settings"
 * modal — `null` while no modal is open or its fetch hasn't resolved yet. */
export interface SessionRulesState {
  sessionId: string;
  rules: GlobalRuleEntry[];
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

/** The "Show Timestamps" flags (kodo-vsix-only — never sent to or read by the
 *  kodo server) backing the "General" section's top subsection. Persisted to
 *  `~/.kodo/etc/ui-settings.json` (extension.ts's `_readUiSettings`/
 *  `_writeUiSettings`) — a dedicated file, deliberately separate from the
 *  server-mirrored `~/.kodo/etc/settings.json` (`_readSettings`/
 *  `_writeSettings`). `clockFormat` is one of six presets (`<dateOrder>_<12h|
 *  24h>`, e.g. `"ymd_24h"`) the webview's `webview/types.ts`
 *  `ClockFormatPreset` also defines — kept as a plain `string` here (not that
 *  union) since the host and webview sides define their own copies of small
 *  wire types independently (see `session-controller.ts`'s duplicated
 *  `EditControl`/`CommandControl`), and the six option values/labels are
 *  hardcoded into this panel's own inline script below
 *  (`CLOCK_FORMAT_OPTIONS`) rather than shared. */
export interface UiSettings {
  showTimestamps: boolean;
  timezone: string;
  clockFormat: string;
}

export interface KodoSettingsState {
  rules: GlobalRuleEntry[];
  stuckDetection: StuckDetectionSettings;
  llamaCpp: LlamaCppInfo;
  sessions: SessionListEntry[];
  sessionRules: SessionRulesState | null;
  uiSettings: UiSettings;
}

export type KodoSettingsMessage =
  | { type: 'ready' }
  | { type: 'delete_rules'; rules: GlobalRuleEntry[] }
  | ({ type: 'set_stuck_detection' } & StuckDetectionSettings)
  | ({ type: 'set_ui_settings' } & UiSettings)
  | { type: 'install_llamacpp' }
  | { type: 'uninstall_llamacpp' }
  | { type: 'update_llamacpp' }
  | { type: 'install_llamacpp_version_prompt' }
  | { type: 'delete_session'; sessionId: string }
  | { type: 'open_session'; sessionId: string }
  | { type: 'fetch_session_rules'; sessionId: string }
  | { type: 'delete_session_rules'; sessionId: string; rules: GlobalRuleEntry[] }
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
    .select-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .select-row label {
      font-size: 0.92em;
      flex-shrink: 0;
      width: 90px;
    }
    .select-row:has(select:disabled) label {
      opacity: 0.5;
    }
    .settings-select {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      padding: 3px 5px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: 0.92em;
    }
    .settings-select:disabled {
      opacity: 0.5;
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
    .delete-rules-btn:not(:disabled) {
      background: var(--vscode-errorForeground, #f44336);
      color: #fff;
    }
    .delete-rules-btn:not(:disabled):hover { opacity: 0.9; }
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
    .session-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
    }
    .session-row:first-child { border-top: none; }
    .session-info {
      flex: 1;
      min-width: 0;
    }
    .session-name {
      font-weight: 600;
      font-size: 0.95em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-meta, .session-workspace {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-icons {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }
    .icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      padding: 0;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 2em;
    }
    .icon-btn:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    }
    .readonly-list {
      margin: 0 0 4px;
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .modal-box {
      width: min(640px, 92vw);
      max-height: 86vh;
      overflow-y: auto;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, #444));
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      padding: 18px 20px;
      box-sizing: border-box;
    }
    .modal-toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .modal-toolbar button {
      display: inline-block;
      width: auto;
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
  <div id="modal-root"></div>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();
    vsc.postMessage({ type: 'ready' });

    const NAV = [
      { key: 'general', label: 'General' },
      { key: 'sessions', label: 'Sessions' },
      { key: 'global-rules', label: 'Global Allow-Rules' },
    ];

    let _state = {
      rules: [],
      stuckDetection: { active: 'local_only', scope: 'top_level', auto_unstuck_interactive: false },
      llamaCpp: { installedVersion: null, latestVersion: null, busy: false },
      sessions: [],
      sessionRules: null,
      uiSettings: { showTimestamps: false, timezone: 'system', clockFormat: 'ymd_24h' },
    };
    let _selectedKey = 'general';
    const _checked = new Set();
    const _sessionChecked = new Set();
    let _sessionSettingsFor = null; // session id the "Session Settings" modal is open for, or null

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

    // Shared by the "Global Allow-Rules" section and the "Session Settings"
    // modal's rules list — same buttons, checkboxes, and labels either way
    // (only the rule set, checked-set, and delete/close callbacks differ).
    function renderRuleToolbar({ className, rules, checkedSet, onDeleteSelected, onClose }) {
      const toolbar = document.createElement('div');
      toolbar.className = className;

      const selectAllBtn = document.createElement('button');
      selectAllBtn.className = 'secondary-btn';
      selectAllBtn.textContent = 'Select All';
      selectAllBtn.disabled = rules.length === 0;
      selectAllBtn.addEventListener('click', () => {
        rules.forEach(r => checkedSet.add(ruleKey(r)));
        render();
      });
      toolbar.appendChild(selectAllBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'secondary-btn';
      clearBtn.textContent = 'Clear Selection';
      clearBtn.disabled = checkedSet.size === 0;
      clearBtn.addEventListener('click', () => {
        checkedSet.clear();
        render();
      });
      toolbar.appendChild(clearBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-rules-btn';
      deleteBtn.textContent = 'Delete Selected';
      deleteBtn.disabled = checkedSet.size === 0;
      deleteBtn.addEventListener('click', () => {
        const selected = rules.filter(r => checkedSet.has(ruleKey(r)));
        if (selected.length === 0) { return; }
        onDeleteSelected(selected);
        checkedSet.clear();
      });
      toolbar.appendChild(deleteBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'secondary-btn';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', onClose);
      toolbar.appendChild(closeBtn);

      return toolbar;
    }

    function renderRuleRow(rule, checkedSet) {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checkedSet.has(ruleKey(rule));
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) { checkedSet.add(ruleKey(rule)); }
        else { checkedSet.delete(ruleKey(rule)); }
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

    function renderRuleList(rules, checkedSet, emptyText) {
      if (rules.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = emptyText;
        return msg;
      }
      const table = document.createElement('div');
      table.className = 'rule-table';
      rules.forEach(rule => table.appendChild(renderRuleRow(rule, checkedSet)));
      return table;
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

      wrap.appendChild(renderRuleToolbar({
        className: 'toolbar',
        rules: _state.rules,
        checkedSet: _checked,
        onDeleteSelected: (rules) => vsc.postMessage({ type: 'delete_rules', rules }),
        onClose: () => vsc.postMessage({ type: 'close' }),
      }));

      wrap.appendChild(renderRuleList(
        _state.rules,
        _checked,
        "No global allow-rules yet — they're added from a permission "
          + "prompt's 'always allow' checkbox when you choose the 'global' scope.",
      ));

      return wrap;
    }

    function basename(p) {
      const trimmed = String(p).replace(/[\\/]+$/, '');
      const parts = trimmed.split(/[\\/]/);
      return parts[parts.length - 1] || trimmed;
    }

    function sessionWorkspaceLine(session) {
      const ws = session.workspace;
      if (!ws) { return 'Not bound to any workspace'; }
      return ws.codeWorkspaceFile || ws.physicalRoot || 'Not bound to any workspace';
    }

    function renderSessionRow(session) {
      const row = document.createElement('div');
      row.className = 'session-row';

      const info = document.createElement('div');
      info.className = 'session-info';

      const name = document.createElement('div');
      name.className = 'session-name';
      name.textContent = session.name;
      name.title = session.name;
      info.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      const kindLabel = session.projectRoot ? 'Guided · ' + basename(session.projectRoot) : 'Problem solving';
      meta.textContent = kindLabel + (session.taken ? ' · Open in another window' : '');
      info.appendChild(meta);

      const wsLine = document.createElement('div');
      wsLine.className = 'session-workspace';
      wsLine.textContent = sessionWorkspaceLine(session);
      wsLine.title = wsLine.textContent;
      info.appendChild(wsLine);

      row.appendChild(info);

      const icons = document.createElement('div');
      icons.className = 'session-icons';

      const openBtn = document.createElement('button');
      openBtn.className = 'icon-btn secondary-btn';
      openBtn.textContent = '📂';
      openBtn.title = 'Open this session';
      openBtn.addEventListener('click', () => {
        vsc.postMessage({ type: 'open_session', sessionId: session.id });
      });
      icons.appendChild(openBtn);

      const gearBtn = document.createElement('button');
      gearBtn.className = 'icon-btn secondary-btn';
      gearBtn.textContent = '⚙';
      gearBtn.title = 'Session Settings';
      gearBtn.addEventListener('click', () => {
        _sessionSettingsFor = session.id;
        _sessionChecked.clear();
        vsc.postMessage({ type: 'fetch_session_rules', sessionId: session.id });
        render();
      });
      icons.appendChild(gearBtn);

      const trashBtn = document.createElement('button');
      trashBtn.className = 'icon-btn secondary-btn';
      trashBtn.textContent = '🗑';
      trashBtn.disabled = session.taken;
      trashBtn.title = session.taken
        ? 'Close this session in its window before deleting it'
        : 'Delete this session';
      trashBtn.addEventListener('click', () => {
        if (session.taken) { return; }
        vsc.postMessage({ type: 'delete_session', sessionId: session.id });
      });
      icons.appendChild(trashBtn);

      row.appendChild(icons);

      return row;
    }

    function renderSessionsSection() {
      const wrap = document.createElement('div');

      const heading = document.createElement('h2');
      heading.textContent = 'Sessions';
      wrap.appendChild(heading);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = 'Every Kōdo session on this machine. Use the open-folder icon to open (or '
        + "activate) a session's tab, the gear icon to review a session's bound workspace and its own "
        + 'allow-rules, or the trash icon to delete it.';
      wrap.appendChild(intro);

      if (_state.sessions.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = 'No sessions yet.';
        wrap.appendChild(msg);
        return wrap;
      }

      const table = document.createElement('div');
      table.className = 'rule-table';
      _state.sessions.forEach(session => table.appendChild(renderSessionRow(session)));
      wrap.appendChild(table);

      return wrap;
    }

    function closeSessionSettings() {
      _sessionSettingsFor = null;
      _sessionChecked.clear();
      renderModal();
    }

    function renderSessionSettingsModal() {
      const session = _state.sessions.find(s => s.id === _sessionSettingsFor);
      if (!session) { return null; }

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { closeSessionSettings(); }
      });

      const box = document.createElement('div');
      box.className = 'modal-box';
      box.addEventListener('click', (e) => e.stopPropagation());

      const heading = document.createElement('h2');
      heading.textContent = 'Session Details';
      box.appendChild(heading);

      const titleHeading = document.createElement('div');
      titleHeading.className = 'section-subheading';
      titleHeading.textContent = 'Title';
      box.appendChild(titleHeading);

      const titleLine = document.createElement('p');
      titleLine.className = 'value-line';
      const titleValue = document.createElement('span');
      titleValue.className = 'value-code';
      titleValue.textContent = session.name;
      titleLine.appendChild(titleValue);
      box.appendChild(titleLine);

      const dividerTitle = document.createElement('hr');
      dividerTitle.className = 'section-divider';
      box.appendChild(dividerTitle);

      const ws = session.workspace;
      const boundHeading = document.createElement('div');
      boundHeading.className = 'section-subheading';
      boundHeading.textContent = ws && ws.codeWorkspaceFile ? '.code-workspace file' : 'Bound workspace root';
      box.appendChild(boundHeading);

      const boundLine = document.createElement('p');
      boundLine.className = 'value-line';
      const boundValue = document.createElement('span');
      boundValue.className = 'value-code';
      boundValue.textContent = sessionWorkspaceLine(session);
      boundLine.appendChild(boundValue);
      box.appendChild(boundLine);

      const divider1 = document.createElement('hr');
      divider1.className = 'section-divider';
      box.appendChild(divider1);

      const lockedHeading = document.createElement('div');
      lockedHeading.className = 'section-subheading';
      lockedHeading.textContent = 'Working directories';
      box.appendChild(lockedHeading);

      const lockedPaths = ws && ws.folders ? Object.values(ws.folders) : [];
      const lockedWrap = document.createElement('div');
      lockedWrap.className = 'readonly-list';
      if (lockedPaths.length === 0) {
        const none = document.createElement('p');
        none.className = 'value-code';
        none.textContent = 'No working directories — no files in this session have been modified yet.';
        lockedWrap.appendChild(none);
      } else {
        lockedPaths.forEach(p => {
          const line = document.createElement('p');
          line.className = 'value-line';
          const code = document.createElement('span');
          code.className = 'value-code';
          code.textContent = p;
          line.appendChild(code);
          lockedWrap.appendChild(line);
        });
      }
      box.appendChild(lockedWrap);

      const divider2 = document.createElement('hr');
      divider2.className = 'section-divider';
      box.appendChild(divider2);

      const rulesHeading = document.createElement('div');
      rulesHeading.className = 'section-subheading';
      rulesHeading.textContent = 'Session Allow-Rules';
      box.appendChild(rulesHeading);

      const rulesLoaded = Boolean(_state.sessionRules) && _state.sessionRules.sessionId === session.id;
      const rules = rulesLoaded ? _state.sessionRules.rules : [];

      if (!rulesLoaded) {
        const loading = document.createElement('div');
        loading.id = 'empty-msg';
        loading.textContent = 'Loading…';
        box.appendChild(loading);
      } else {
        box.appendChild(renderRuleList(
          rules,
          _sessionChecked,
          "No allow-rules for this session yet — they're added from a permission "
            + "prompt's 'always allow' checkbox when you choose the 'session' scope.",
        ));
      }

      const divider3 = document.createElement('hr');
      divider3.className = 'section-divider';
      box.appendChild(divider3);

      box.appendChild(renderRuleToolbar({
        className: 'modal-toolbar',
        rules,
        checkedSet: _sessionChecked,
        onDeleteSelected: (selected) => vsc.postMessage({
          type: 'delete_session_rules', sessionId: session.id, rules: selected,
        }),
        onClose: closeSessionSettings,
      }));

      overlay.appendChild(box);
      return overlay;
    }

    function renderModal() {
      const root = document.getElementById('modal-root');
      root.innerHTML = '';
      const modal = renderSessionSettingsModal();
      if (modal) { root.appendChild(modal); }
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

    // 'system' resolves to the runtime's local IANA zone (format.ts's
    // resolveTimeZone); every other value is a real IANA zone id used as-is —
    // 'UTC' plus a curated set of common hubs, not an exhaustive list.
    const TIMEZONE_OPTIONS = [
      ['system', 'System locale'],
      ['UTC', 'UTC'],
      ['America/Los_Angeles', 'Pacific Time (Los Angeles)'],
      ['America/Denver', 'Mountain Time (Denver)'],
      ['America/Chicago', 'Central Time (Chicago)'],
      ['America/New_York', 'Eastern Time (New York)'],
      ['America/Sao_Paulo', 'São Paulo'],
      ['Europe/London', 'London'],
      ['Europe/Paris', 'Paris / Berlin'],
      ['Europe/Moscow', 'Moscow'],
      ['Asia/Kolkata', 'India (Kolkata)'],
      ['Asia/Singapore', 'Singapore / Hong Kong'],
      ['Asia/Tokyo', 'Tokyo'],
      ['Australia/Sydney', 'Sydney'],
    ];

    // <dateOrder>_<12h|24h> — mirrors webview/types.ts's ClockFormatPreset
    // union (kept as plain strings here, see the UiSettings doc comment above).
    const CLOCK_FORMAT_OPTIONS = [
      ['ymd_24h', 'YYYY-MM-DD, 24-hour (2026-07-23 14:41)'],
      ['ymd_12h', 'YYYY-MM-DD, 12-hour (2026-07-23 2:41 PM)'],
      ['mdy_24h', 'MM/DD/YYYY, 24-hour (07/23/2026 14:41)'],
      ['mdy_12h', 'MM/DD/YYYY, 12-hour (07/23/2026 2:41 PM)'],
      ['dmy_24h', 'DD/MM/YYYY, 24-hour (23/07/2026 14:41)'],
      ['dmy_12h', 'DD/MM/YYYY, 12-hour (23/07/2026 2:41 PM)'],
    ];

    function postUiSettings() {
      vsc.postMessage({ type: 'set_ui_settings', ..._state.uiSettings });
    }

    function renderSelectRow({ labelText, options, value, disabled, onChange }) {
      const row = document.createElement('div');
      row.className = 'select-row';

      const label = document.createElement('label');
      label.textContent = labelText;
      row.appendChild(label);

      const select = document.createElement('select');
      select.className = 'settings-select';
      select.disabled = disabled;
      options.forEach(([optValue, optLabel]) => {
        const option = document.createElement('option');
        option.value = optValue;
        option.textContent = optLabel;
        option.selected = optValue === value;
        select.appendChild(option);
      });
      select.addEventListener('change', () => onChange(select.value));
      row.appendChild(select);

      return row;
    }

    function renderShowTimestampsSection() {
      const wrap = document.createElement('div');

      const subheading = document.createElement('div');
      subheading.className = 'section-subheading';
      subheading.textContent = 'Show Timestamps';
      wrap.appendChild(subheading);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = 'Show when each message, response, and tool call happened, as a small '
        + 'line above it in the conversation.';
      wrap.appendChild(intro);

      const showRow = document.createElement('label');
      showRow.className = 'checkbox-row';
      const showInput = document.createElement('input');
      showInput.type = 'checkbox';
      showInput.checked = _state.uiSettings.showTimestamps;
      showInput.addEventListener('change', () => {
        _state.uiSettings = { ..._state.uiSettings, showTimestamps: showInput.checked };
        postUiSettings();
        render();
      });
      showRow.appendChild(showInput);
      showRow.appendChild(document.createTextNode('Show timestamps'));
      wrap.appendChild(showRow);

      const disabled = !_state.uiSettings.showTimestamps;

      wrap.appendChild(renderSelectRow({
        labelText: 'Time zone',
        options: TIMEZONE_OPTIONS,
        value: _state.uiSettings.timezone,
        disabled,
        onChange: (value) => {
          _state.uiSettings = { ..._state.uiSettings, timezone: value };
          postUiSettings();
          render();
        },
      }));

      wrap.appendChild(renderSelectRow({
        labelText: 'Format',
        options: CLOCK_FORMAT_OPTIONS,
        value: _state.uiSettings.clockFormat,
        disabled,
        onChange: (value) => {
          _state.uiSettings = { ..._state.uiSettings, clockFormat: value };
          postUiSettings();
          render();
        },
      }));

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

      wrap.appendChild(renderShowTimestampsSection());

      const timestampsDivider = document.createElement('hr');
      timestampsDivider.className = 'section-divider';
      wrap.appendChild(timestampsDivider);

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
      } else if (_selectedKey === 'sessions') {
        content.appendChild(renderSessionsSection());
      } else {
        content.appendChild(renderGlobalRulesSection());
      }
      renderModal();
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
      if (data.uiSettings && typeof data.uiSettings === 'object') {
        _state.uiSettings = data.uiSettings;
      }
      if (Array.isArray(data.sessions)) {
        _state.sessions = data.sessions;
        // A deleted (or otherwise vanished) session can't keep its modal open.
        if (_sessionSettingsFor && !data.sessions.some(s => s.id === _sessionSettingsFor)) {
          _sessionSettingsFor = null;
          _sessionChecked.clear();
        }
      }
      if (data.sessionRules === null || (data.sessionRules && typeof data.sessionRules === 'object')) {
        _state.sessionRules = data.sessionRules;
        if (data.sessionRules) {
          const keys = new Set(data.sessionRules.rules.map(ruleKey));
          [..._sessionChecked].forEach(k => { if (!keys.has(k)) { _sessionChecked.delete(k); } });
        }
      }
      render();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _sessionSettingsFor) {
        closeSessionSettings();
      }
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
