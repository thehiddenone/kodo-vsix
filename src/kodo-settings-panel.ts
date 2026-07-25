import * as vscode from 'vscode';
import type { ApiKeyEntry } from './cloud-credentials';
import type { HfTokenEntry } from './hf-tokens';
import type { CloudRegistry, EffortLevel, LocalDownloadState, LocalRegistryEntry } from './llm-registry-types';
import { EFFORT_LABELS, EFFORT_LEVELS } from './llm-registry-types';
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
  workflowMode: string | null;
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

/** Payloads shared with the (former, now-merged-in) Local Inference Settings
 * panel — kodo/doc/LLM_REGISTRY.md §4. */
export interface AddHuggingfaceLlmPayload {
  name: string;
  description: string;
  repo_id: string;
  filename: string;
  llama_args: Record<string, string>;
  context_window: number;
}

export interface AddFileLlmPayload {
  name: string;
  description: string;
  path: string;
  llama_args: Record<string, string>;
  context_window: number;
}

export interface AddServerUrlLlmPayload {
  name: string;
  description: string;
  url: string;
}

export interface AddFlavorPayload {
  /** The local registry entry this flavor is being added to. */
  name: string;
  flavor_name: string;
  description: string;
  /** Raw multi-line "--flag value" text box content, parsed server-side. */
  llama_args_text: string;
  /** GB, 0 = unknown/no requirement — see LlamaFlavorInfo.min_ram/min_vram. */
  min_ram: number;
  min_vram: number;
}

export interface UpdateFlavorPayload {
  /** The local registry entry the edited flavor belongs to. */
  name: string;
  /** The existing flavor's id — kept fixed, never re-derived from flavor_name. */
  flavor_id: string;
  flavor_name: string;
  description: string;
  /** Raw multi-line "--flag value" text box content, parsed server-side. */
  llama_args_text: string;
  /** GB, 0 = unknown/no requirement. Not carried forward if omitted — the
   * modal always resends its own fields' current contents. */
  min_ram: number;
  min_vram: number;
}

export interface KodoSettingsState {
  rules: GlobalRuleEntry[];
  stuckDetection: StuckDetectionSettings;
  llamaCpp: LlamaCppInfo;
  sessions: SessionListEntry[];
  sessionRules: SessionRulesState | null;
  uiSettings: UiSettings;
  /** Configured HuggingFace tokens. */
  hfTokens: HfTokenEntry[];
  /** Per-vendor tab state (former standalone Cloud AI Settings panel) —
   * hardcoded vendor metadata/models, mirrors settings.json `models.cloud`. */
  cloudRegistry: CloudRegistry;
  /** vendor -> effort -> model_id. */
  modelsByVendor: Record<string, Record<string, string>>;
  /** vendor -> its configured API keys. */
  keysByVendor: Record<string, ApiKeyEntry[]>;
  /** "Local Inference" tab state (former Local Inference Settings panel). */
  localRegistry: LocalRegistryEntry[];
  llamaServerOverridePath: string | null;
  detectedVramGb: number | null;
  detectedRamGb: number | null;
  /** Live download progress, polled off disk — see local-model-downloads.ts. */
  downloads: LocalDownloadState[];
  /** Picks gpu_tip vs mac_tip and the "Show me local files" label. */
  isMac: boolean;
  /**
   * Names of installed models whose remote GGUF no longer matches what's on
   * disk (an ETag mismatch found by `local_llm.check_updates` /
   * `LocalModelManager.check_for_update` — kodo/doc/LOCAL_MODEL_MANAGER.md
   * §12). Drives the yellow "updates available" banner and each affected
   * card's "Update" button. Populated asynchronously — empty until the
   * fire-and-forget scan kicked off when the "Local Inference" tab opens
   * replies.
   */
  updatableNames: string[];
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
  | { type: 'add_hf_token'; name: string; secret: string }
  | { type: 'remove_hf_token'; uuid: string }
  | { type: 'activate_hf_token'; uuid: string }
  | { type: 'set_cloud_model'; vendor: string; effort: EffortLevel; model_id: string }
  | { type: 'add_key'; vendor: string; name: string; secret: string }
  | { type: 'forget_key'; vendor: string; uuid: string }
  | { type: 'make_active'; vendor: string; uuid: string }
  | ({ type: 'add_huggingface' } & AddHuggingfaceLlmPayload)
  | ({ type: 'add_file' } & AddFileLlmPayload)
  | ({ type: 'add_server_url' } & AddServerUrlLlmPayload)
  | { type: 'pick_gguf_file' }
  | { type: 'install'; name: string }
  | { type: 'pause'; name: string }
  | { type: 'resume'; name: string }
  | { type: 'cancel'; name: string }
  | { type: 'uninstall'; name: string }
  | { type: 'update'; name: string }
  | { type: 'remove'; name: string }
  | { type: 'reveal'; name: string }
  | { type: 'set_override' }
  | { type: 'remove_override' }
  | ({ type: 'add_flavor' } & AddFlavorPayload)
  | ({ type: 'update_flavor' } & UpdateFlavorPayload)
  | { type: 'remove_flavor'; name: string; flavor_id: string }
  | { type: 'close' };

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

  static createOrShow(
    initialState: KodoSettingsState,
    onMessage: (msg: KodoSettingsMessage) => void,
    selectSection?: string,
  ): KodoSettingsPanel {
    if (KodoSettingsPanel.current) {
      KodoSettingsPanel.current.panel.reveal();
      if (selectSection) {
        KodoSettingsPanel.current.selectSection(selectSection);
      }
      return KodoSettingsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'kodoSettings',
      'Kōdo Settings',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new KodoSettingsPanel(panel, initialState, onMessage);
    if (selectSection) {
      instance._pendingSelectSection = selectSection;
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
        if (this._pendingSelectSection) {
          this.selectSection(this._pendingSelectSection);
          this._pendingSelectSection = null;
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

  /** Reply to a `pick_gguf_file` message with the path chosen in the native dialog (or `null` if cancelled). */
  postGgufFilePicked(path: string | null): void {
    void this.panel.webview.postMessage({ type: 'gguf_file_picked', path });
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
    .nav-cloud-ai-divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      margin: 16px 0;
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
      max-width: auto;
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
    .modal-box.narrow-box {
      width: 380px;
      max-width: calc(100vw - 40px);
    }
    .modal-box h3 { margin: 0 0 6px; font-size: 1.05em; }
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
    .section-heading {
      font-size: 0.95em;
      font-weight: 600;
      margin: 0 0 8px;
    }
    .keys-section { margin-bottom: 22px; }
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
    #no-tokens-msg { color: var(--vscode-descriptionForeground); font-size: 0.9em; padding: 6px 0; }
    .modal-intro {
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
    .modal-field .field-hint {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      margin-top: 3px;
    }
    .modal-field .field-error {
      font-size: 0.78em;
      color: var(--vscode-errorForeground, #f14c4c);
      margin-top: 3px;
      min-height: 1.1em;
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
    .modal-field textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 5px 7px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-font-size);
      resize: vertical;
    }
    .modal-field textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .modal-field input[readonly],
    .modal-field textarea[readonly] {
      opacity: 0.6;
      cursor: default;
    }
    .modal-field-row {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
    }
    .modal-field-row .modal-field {
      flex: 1;
      margin-bottom: 0;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
    .modal-actions button {
      display: inline-block;
      width: auto;
    }

    /* --- "Local Inference" tab (former standalone Local Inference Settings
       panel) --- */
    .action-btn { height: 35px; }
    .explain {
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
      margin: 0 0 8px;
    }
    .spacer { height: 14px; }
    #override-path {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      margin: 0 0 14px;
      word-break: break-all;
      color: var(--vscode-descriptionForeground);
    }
    hr.divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      margin: 24px 0;
    }
    .cell-name { font-weight: 600; margin-bottom: 2px; word-break: break-word; }
    .cell-kind {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .cell-status {
      font-size: 0.78em;
      margin-bottom: 6px;
    }
    .cell-status.installed { color: #4caf50; }
    .llm-cell { margin-bottom: 20px; }
    .llm-cell button { margin-bottom: 8px; }

    /* Local Inference's own modal overlays -- a static show/hide-by-class
       overlay (unlike #modal-root's append/remove-on-open pattern above),
       so named distinctly (li- prefix) to avoid the two .modal-overlay
       display rules fighting over the same class. */
    .li-modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .li-modal-overlay.open { display: flex; }
    .modal-dialog {
      width: 420px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px);
      overflow-y: auto;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 4px;
      padding: 18px 20px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
    }
    .modal-dialog h3 { margin: 0 0 14px; font-size: 1.05em; }
    #flavor-readonly-hint {
      /* visibility (not display) keeps the two lines of text reserved in
         the layout at all times, so toggling them on for a predefined
         flavor doesn't shift the Submit/Close buttons below. */
      visibility: hidden;
      color: var(--vscode-descriptionForeground);
    }
    #flavor-readonly-hint.visible { visibility: visible; }
    .file-picker-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .file-picker-row .file-picker-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
    }
    .file-picker-row button {
      flex-shrink: 0;
      display: inline-block;
      width: auto;
    }

    .row-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .row-buttons button {
      display: inline-block;
      width: auto;
    }

    /* --- Downloads in progress --- */
    #downloads-section { margin-bottom: 10px; }
    .download-row { padding: 10px 0; }
    .download-name { font-weight: 600; margin-bottom: 2px; }
    .download-repo {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      word-break: break-all;
    }
    .download-status {
      font-size: 0.8em;
      margin-bottom: 6px;
    }
    .download-status.paused { color: #d7ba7d; }
    .download-status.failed { color: var(--vscode-errorForeground, #f14c4c); }
    .progress-track {
      height: 6px;
      border-radius: 3px;
      /* Deliberately NOT var(--vscode-progressBar-background) and NOT the
         opacity property: opacity on this element would also dim
         .progress-fill (its child), and re-using the same color the fill
         uses would make the two indistinguishable regardless — either one
         alone was enough to make the bar look permanently empty. */
      background: var(--vscode-input-background, rgba(128, 128, 128, 0.25));
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
      overflow: hidden;
      margin-bottom: 4px;
    }
    .progress-fill {
      height: 100%;
      background: var(--vscode-progressBar-background, #0078d4);
    }
    .progress-label {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
    }

    /* --- Grouped / collapsible available-LLM cards --- */
    .base-llm-group { margin-bottom: 4px; }
    .group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 10px 0;
      user-select: none;
    }
    .group-header .chevron {
      display: inline-block;
      transition: transform 0.1s ease;
      font-size: 0.8em;
      width: 0.9em;
    }
    .group-header.expanded .chevron { transform: rotate(90deg); }
    .group-header .group-title { font-weight: 600; }
    .group-header .group-count {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
    }
    .group-body {
      display: none;
      padding-left: 20px;
      border-left: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      margin-left: 4px;
    }
    .group-body.expanded { display: block; }
    .model-card { padding: 12px 0; }
    .model-card + .model-card { border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444)); }
    .model-meta-line {
      font-size: 0.85em;
      margin-bottom: 3px;
    }
    .model-meta-line .meta-label {
      color: var(--vscode-descriptionForeground);
    }
    .model-meta-line a {
      color: var(--vscode-textLink-foreground);
    }
    .hw-tip {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin: 4px 0;
      line-height: 1.4;
    }
    .ram-warning {
      font-size: 0.85em;
      margin: 6px 0;
      padding: 6px 8px;
      border-radius: 3px;
      line-height: 1.4;
    }
    .ram-warning.red {
      background: rgba(241, 76, 76, 0.12);
      color: var(--vscode-errorForeground, #f14c4c);
    }
    .ram-warning.yellow {
      background: rgba(215, 186, 125, 0.12);
      color: #d7ba7d;
    }
    #updates-banner, .update-available-tag {
      font-size: 0.88em;
      padding: 8px 10px;
      border-radius: 3px;
      line-height: 1.4;
      background: rgba(215, 186, 125, 0.12);
      color: #d7ba7d;
    }
    #updates-banner { margin: 0 0 16px; }
    .update-available-tag { margin: 0 0 8px; }
    .installed-tag {
      display: inline-block;
      font-size: 0.78em;
      color: #4caf50;
      border: 1px solid #4caf50;
      border-radius: 10px;
      padding: 1px 8px;
      margin-bottom: 6px;
    }

    /* --- Manage flavors modal: twice the width, split into two panes --- */
    .modal-dialog.flavor-modal-dialog {
      width: 840px;
      max-width: calc(100vw - 40px);
    }
    .flavor-modal-body {
      display: flex;
      gap: 18px;
      align-items: flex-start;
      margin-top: 10px;
    }
    .flavor-list-pane {
      flex: 0 0 38%;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .flavor-list {
      height: 480px;
      overflow-y: auto;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      margin-bottom: 8px;
    }
    .flavor-list-row {
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      cursor: pointer;
    }
    .flavor-list-row:last-child { border-bottom: none; }
    .flavor-list-row:hover { background: var(--vscode-list-hoverBackground); }
    .flavor-list-row.selected {
      background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
    }
    .flavor-row-name { font-weight: 600; margin-bottom: 2px; }
    .flavor-row-desc {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .flavor-list-actions {
      display: flex;
      gap: 8px;
    }
    .flavor-list-actions button {
      display: inline-block;
      width: auto;
      flex: 1;
    }
    .flavor-form-pane {
      flex: 1 1 62%;
      min-width: 0;
      border-left: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      padding-left: 18px;
    }

    /* --- Cloud AI vendor tabs (former standalone Cloud AI Settings panel) --- */
    #no-keys-msg { color: var(--vscode-descriptionForeground); font-size: 0.9em; padding: 6px 0; }
    .effort-title { font-weight: 600; margin-bottom: 4px; font-size: 0.95em; }
    .effort-example {
      font-size: 0.85em;
      font-style: italic;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .model-select { max-width: 360px; }
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
    .coming-soon p {
      color: var(--vscode-descriptionForeground);
      font-size: 0.92em;
      line-height: 1.5;
      max-width: 480px;
    }
    .badge {
      display: inline-block;
      margin-top: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.78em;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
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

  <div class="li-modal-overlay" id="hf-modal">
    <div class="modal-dialog" role="dialog" aria-modal="true">
      <h3>Add local LLM (GGUF) from huggingface.com</h3>
      <div class="modal-field">
        <label for="hf-name">LLM name</label>
        <input type="text" id="hf-name" autocomplete="off">
        <div class="field-error" id="hf-name-error"></div>
      </div>
      <div class="modal-field">
        <label for="hf-description">Description (optional)</label>
        <input type="text" id="hf-description" autocomplete="off">
      </div>
      <div class="modal-field">
        <label for="hf-repo-id">HuggingFace repository ID</label>
        <input type="text" id="hf-repo-id" placeholder="vendor/repo" autocomplete="off">
        <div class="field-error" id="hf-repo-id-error"></div>
      </div>
      <div class="modal-field">
        <label for="hf-filename">GGUF filename</label>
        <input type="text" id="hf-filename" placeholder="model.gguf" autocomplete="off">
        <div class="field-error" id="hf-filename-error"></div>
      </div>
      <div class="modal-field">
        <label for="hf-llama-args">llama_args (optional)</label>
        <input type="text" id="hf-llama-args" placeholder="--cache-type-k q8_0 --cache-type-v q8_0" autocomplete="off">
        <div class="field-hint">Space-separated CLI flags passed verbatim to llama-server.</div>
      </div>
      <div class="modal-field">
        <label for="hf-context-window">Context window size (optional)</label>
        <input type="number" id="hf-context-window" min="1" step="1">
      </div>
      <div class="modal-actions">
        <button id="hf-add-btn">Add</button>
        <button class="secondary-btn" id="hf-cancel-btn">Cancel</button>
      </div>
    </div>
  </div>

  <div class="li-modal-overlay" id="file-modal">
    <div class="modal-dialog" role="dialog" aria-modal="true">
      <h3>Add local LLM (GGUF) from file</h3>
      <div class="modal-field">
        <label for="file-name">LLM name</label>
        <input type="text" id="file-name" autocomplete="off">
        <div class="field-error" id="file-name-error"></div>
      </div>
      <div class="modal-field">
        <label for="file-description">Description (optional)</label>
        <input type="text" id="file-description" autocomplete="off">
      </div>
      <div class="modal-field">
        <label>GGUF file</label>
        <div class="file-picker-row">
          <span class="file-picker-label" id="file-picked-label">No file selected</span>
          <button class="secondary-btn" id="file-select-btn" type="button">Select file</button>
        </div>
      </div>
      <div class="modal-field">
        <label for="file-llama-args">llama_args (optional)</label>
        <input type="text" id="file-llama-args" placeholder="--cache-type-k q8_0 --cache-type-v q8_0" autocomplete="off">
        <div class="field-hint">Space-separated CLI flags passed verbatim to llama-server.</div>
      </div>
      <div class="modal-field">
        <label for="file-context-window">Context window size (optional)</label>
        <input type="number" id="file-context-window" min="1" step="1">
      </div>
      <div class="modal-actions">
        <button id="file-add-btn">Add</button>
        <button class="secondary-btn" id="file-cancel-btn">Cancel</button>
      </div>
    </div>
  </div>

  <div class="li-modal-overlay" id="server-modal">
    <div class="modal-dialog" role="dialog" aria-modal="true">
      <h3>Add a link to self-hosted llama-server</h3>
      <div class="modal-field">
        <label for="server-name">LLM name</label>
        <input type="text" id="server-name" autocomplete="off">
        <div class="field-error" id="server-name-error"></div>
      </div>
      <div class="modal-field">
        <label for="server-description">Description (optional)</label>
        <input type="text" id="server-description" autocomplete="off">
      </div>
      <div class="modal-field">
        <label for="server-url">Self-hosted llama-server URL</label>
        <input type="text" id="server-url" placeholder="http://192.168.1.50:8042" autocomplete="off">
        <div class="field-error" id="server-url-error"></div>
      </div>
      <div class="modal-actions">
        <button id="server-add-btn">Add</button>
        <button class="secondary-btn" id="server-cancel-btn">Cancel</button>
      </div>
    </div>
  </div>

  <div class="li-modal-overlay" id="flavor-modal">
    <div class="modal-dialog flavor-modal-dialog" role="dialog" aria-modal="true">
      <h3 id="flavor-modal-title">Manage flavors</h3>
      <p class="explain">
        A flavor is a named set of llama.cpp launch arguments for this LLM — e.g. a larger
        context window or GPU-offload tuning for a smaller card. Only one flavor is active at a
        time, and switching to a different one fully replaces the previous flavor's arguments.
        Pick which flavor is active from the sidebar.
      </p>
      <div class="flavor-modal-body">
        <div class="flavor-list-pane">
          <div class="flavor-list" id="flavor-list"></div>
          <div class="flavor-list-actions">
            <button class="secondary-btn" id="flavor-add-list-btn" type="button">Add</button>
            <button class="secondary-btn" id="flavor-remove-list-btn" type="button">Remove</button>
          </div>
        </div>
        <div class="flavor-form-pane">
          <div class="modal-field">
            <label for="flavor-name">Name</label>
            <input type="text" id="flavor-name" autocomplete="off">
            <div class="field-error" id="flavor-name-error"></div>
          </div>
          <div class="modal-field">
            <label for="flavor-description">Description (optional)</label>
            <input type="text" id="flavor-description" autocomplete="off">
          </div>
          <div class="modal-field">
            <label for="flavor-llama-args">llama.cpp arguments (optional)</label>
            <textarea id="flavor-llama-args" rows="8" placeholder="--ctx-size 1048576
--rope-scaling yarn
--rope-scale 4"></textarea>
            <div class="field-hint">One flag per line. Fully replaces the previously active flavor's arguments once this one is selected.</div>
          </div>
          <div class="modal-field-row">
            <div class="modal-field">
              <label for="flavor-min-ram">Minimum RAM (GB, optional)</label>
              <input type="number" id="flavor-min-ram" min="0" step="1">
            </div>
            <div class="modal-field">
              <label for="flavor-min-vram">Minimum VRAM (GB, optional)</label>
              <input type="number" id="flavor-min-vram" min="0" step="1">
            </div>
          </div>
          <div class="field-hint">
            System RAM (or Apple Silicon unified memory) and discrete GPU VRAM this flavor
            needs to run — leave blank/0 if unknown. Selecting a flavor whose requirement
            exceeds this machine's detected hardware prompts for confirmation first.
          </div>
          <div class="field-hint" id="flavor-readonly-hint">
            This is a built-in flavor and cannot be edited or removed. Copy its values into a
            new flavor with "Add" if you want to customize it.
          </div>
          <div class="modal-actions">
            <button id="flavor-submit-btn">Submit</button>
            <button class="secondary-btn" id="flavor-close-btn">Close</button>
          </div>
        </div>
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

    // Every cloud vendor gets its own top-level nav entry — CLOUD_VENDORS
    // carries the ones without a working cloudRegistry entry yet (only
    // "anthropic" is wired server-side today; see LLM_REGISTRY.md).
    const CLOUD_VENDORS = {
      anthropic: { label: 'Anthropic', icon: '⚛️', coming_soon_text: '' },
      openai: { label: 'OpenAI', icon: '🧠', coming_soon_text: "GPT models are being wired up next. Once ready, you'll be able to add OpenAI API keys and assign GPT models to each effort level right here." },
      google: { label: 'Google', icon: '✨', coming_soon_text: "Gemini is next on the roadmap. When it ships, a Google API key here will route each effort level straight to a Gemini model." },
      meta: { label: 'Meta', icon: '🦙', coming_soon_text: "Llama model support is on the way. This page will let you manage Meta API access and pick a Llama model per effort level." },
      alibaba: { label: 'Alibaba', icon: '🧞', coming_soon_text: "Qwen support is queued up behind the scenes. Drop in an Alibaba API key once it lands, and pick a Qwen model for each effort level." },
      deepseek: { label: 'DeepSeek', icon: '🐋', coming_soon_text: "DeepSeek's reasoning models are being integrated. Check back soon to configure DeepSeek access and effort-level assignments." },
      kimi: { label: 'Kimi', icon: '🌙', coming_soon_text: "Kimi support is in the pipeline. Soon you'll be able to bring your own Kimi API key and route work to its models here." },
      openrouter: { label: 'OpenRouter', icon: '🔀', coming_soon_text: "OpenRouter will let you tap into many vendors through a single key. We're building the plumbing — this page will host that configuration." },
    };
    const CLOUD_VENDOR_KEYS = Object.keys(CLOUD_VENDORS);

    const NAV = [
      { key: 'general', label: 'General' },
      { key: 'sessions', label: 'Sessions' },
      { key: 'global-rules', label: 'Global Allow-Rules' },
      { key: 'local-inference', label: 'Local Inference' },
      ...CLOUD_VENDOR_KEYS.map(key => ({ key, label: CLOUD_VENDORS[key].icon + ' ' + CLOUD_VENDORS[key].label })),
    ];

    let _state = {
      rules: [],
      stuckDetection: { active: 'local_only', scope: 'top_level', auto_unstuck_interactive: false },
      llamaCpp: { installedVersion: null, latestVersion: null, busy: false },
      sessions: [],
      sessionRules: null,
      uiSettings: { showTimestamps: false, timezone: 'system', clockFormat: 'ymd_24h' },
      hfTokens: [],
      cloudRegistry: {},
      modelsByVendor: {},
      keysByVendor: {},
      localRegistry: [],
      llamaServerOverridePath: null,
      downloads: [],
      detectedVramGb: null,
      detectedRamGb: null,
      isMac: false,
      updatableNames: [],
    };
    let _selectedKey = 'general';
    const _checked = new Set();
    const _sessionChecked = new Set();
    let _sessionSettingsFor = null; // session id the "Session Settings" modal is open for, or null
    let _addTokenModalOpen = false; // whether the "Add HuggingFace Token" modal is open
    let _addKeyModalVendor = null; // vendor key the "Add API key" modal is open for, or null

    function ruleKey(rule) {
      return rule.kind + '|' + rule.executable + '|' + rule.value;
    }

    function renderNav() {
      const nav = document.getElementById('nav');
      nav.innerHTML = '';
      NAV.forEach(({ key, label }) => {
        if (key === CLOUD_VENDOR_KEYS[0]) {
          const divider = document.createElement('hr');
          divider.className = 'nav-cloud-ai-divider';
          nav.appendChild(divider);
        }
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
      const kindLabel = session.workflowMode === 'guided' ? 'Guided' : 'Problem solving';
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

    function closeAddTokenModal() {
      _addTokenModalOpen = false;
      renderModal();
    }

    function renderAddTokenModal() {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { closeAddTokenModal(); }
      });

      const box = document.createElement('div');
      box.className = 'modal-box narrow-box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.addEventListener('click', (e) => e.stopPropagation());

      const heading = document.createElement('h3');
      heading.textContent = 'Add HuggingFace Token';
      box.appendChild(heading);

      const intro = document.createElement('p');
      intro.className = 'modal-intro';
      intro.textContent = "This token grants access to gated HuggingFace repositories. It is stored securely in VS Code's keychain.";
      box.appendChild(intro);

      const nameField = document.createElement('div');
      nameField.className = 'modal-field';
      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Token name';
      nameLabel.setAttribute('for', 'add-token-name');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.id = 'add-token-name';
      nameInput.placeholder = 'e.g. work, personal';
      nameInput.autocomplete = 'off';
      nameField.appendChild(nameLabel);
      nameField.appendChild(nameInput);
      box.appendChild(nameField);

      const secretField = document.createElement('div');
      secretField.className = 'modal-field';
      const secretLabel = document.createElement('label');
      secretLabel.textContent = 'Access token';
      secretLabel.setAttribute('for', 'add-token-secret');
      const secretInput = document.createElement('input');
      secretInput.type = 'password';
      secretInput.id = 'add-token-secret';
      secretInput.placeholder = 'Paste HF access token';
      secretInput.autocomplete = 'off';
      secretField.appendChild(secretLabel);
      secretField.appendChild(secretInput);
      box.appendChild(secretField);

      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'secondary-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', closeAddTokenModal);
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Add token';
      confirmBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const secret = secretInput.value.trim();
        if (!name || !secret) { return; }
        vsc.postMessage({ type: 'add_hf_token', name, secret });
        closeAddTokenModal();
      });
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      box.appendChild(actions);

      overlay.appendChild(box);
      return overlay;
    }

    function openAddTokenModal() {
      _addTokenModalOpen = true;
      renderModal();
      const input = document.getElementById('add-token-name');
      if (input) { input.focus(); }
    }

    function closeAddKeyModal() {
      _addKeyModalVendor = null;
      renderModal();
    }

    function renderAddKeyModal() {
      const vendor = _addKeyModalVendor;
      const vendorLabel = (CLOUD_VENDORS[vendor] && CLOUD_VENDORS[vendor].label) || vendor;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { closeAddKeyModal(); }
      });

      const box = document.createElement('div');
      box.className = 'modal-box narrow-box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.addEventListener('click', (e) => e.stopPropagation());

      const heading = document.createElement('h3');
      heading.textContent = 'Add API key';
      box.appendChild(heading);

      const intro = document.createElement('p');
      intro.className = 'modal-intro';
      intro.textContent = 'This API key will be used for ' + vendorLabel + '.';
      box.appendChild(intro);

      const nameField = document.createElement('div');
      nameField.className = 'modal-field';
      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Key name';
      nameLabel.setAttribute('for', 'add-key-name');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.id = 'add-key-name';
      nameInput.placeholder = 'e.g. work, personal';
      nameInput.autocomplete = 'off';
      nameField.appendChild(nameLabel);
      nameField.appendChild(nameInput);
      box.appendChild(nameField);

      const secretField = document.createElement('div');
      secretField.className = 'modal-field';
      const secretLabel = document.createElement('label');
      secretLabel.textContent = 'API key';
      secretLabel.setAttribute('for', 'add-key-secret');
      const secretInput = document.createElement('input');
      secretInput.type = 'password';
      secretInput.id = 'add-key-secret';
      secretInput.placeholder = 'Paste API key';
      secretInput.autocomplete = 'off';
      secretField.appendChild(secretLabel);
      secretField.appendChild(secretInput);
      box.appendChild(secretField);

      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'secondary-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', closeAddKeyModal);
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Add API key';
      confirmBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const secret = secretInput.value.trim();
        if (!name || !secret || !vendor) { return; }
        vsc.postMessage({ type: 'add_key', vendor, name, secret });
        closeAddKeyModal();
      });
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      box.appendChild(actions);

      overlay.appendChild(box);
      return overlay;
    }

    function openAddKeyModal(vendor) {
      _addKeyModalVendor = vendor;
      renderModal();
      const input = document.getElementById('add-key-name');
      if (input) { input.focus(); }
    }

    function renderModal() {
      const root = document.getElementById('modal-root');
      root.innerHTML = '';
      const modal = _sessionSettingsFor
        ? renderSessionSettingsModal()
        : (_addTokenModalOpen ? renderAddTokenModal()
        : (_addKeyModalVendor ? renderAddKeyModal() : null));
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

    function renderHuggingFaceSection() {
      const wrap = document.createElement('div');

      const heading = document.createElement('div');
      heading.className = 'section-subheading';
      heading.textContent = 'HuggingFace';
      wrap.appendChild(heading);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = "Manage access tokens for downloading gated models from HuggingFace Hub. Tokens are stored securely in VS Code's keychain and never written to disk.";
      wrap.appendChild(intro);

      // Access Tokens section
      const section = document.createElement('div');
      section.className = 'keys-section';

      const sectionHeading = document.createElement('div');
      sectionHeading.className = 'section-heading';
      sectionHeading.textContent = 'Access Tokens';
      section.appendChild(sectionHeading);

      const divider = document.createElement('hr');
      divider.className = 'section-divider';
      section.appendChild(divider);

      const tokens = _state.hfTokens || [];
      if (tokens.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'no-tokens-msg';
        msg.textContent = 'No HuggingFace access tokens configured yet.';
        section.appendChild(msg);
      } else {
        tokens.forEach(token => {
          const row = document.createElement('div');
          row.className = 'key-row';

          const name = document.createElement('span');
          name.className = 'key-name';
          name.textContent = token.name;
          row.appendChild(name);

          if (token.active) {
            const badge = document.createElement('span');
            badge.className = 'key-active-badge';
            badge.textContent = 'Active';
            row.appendChild(badge);
          } else {
            const makeActiveBtn = document.createElement('button');
            makeActiveBtn.className = 'secondary-btn';
            makeActiveBtn.textContent = 'Make active';
            makeActiveBtn.addEventListener('click', () => {
              vsc.postMessage({ type: 'activate_hf_token', uuid: token.uuid });
            });
            row.appendChild(makeActiveBtn);
          }

          const removeBtn = document.createElement('button');
          removeBtn.className = 'secondary-btn';
          removeBtn.textContent = 'Remove this token';
          removeBtn.addEventListener('click', () => {
            vsc.postMessage({ type: 'remove_hf_token', uuid: token.uuid });
          });
          row.appendChild(removeBtn);

          section.appendChild(row);
        });
      }

      const addBtn = document.createElement('button');
      addBtn.id = 'add-key-btn';
      addBtn.style.marginTop = '15px';
      addBtn.textContent = 'Add new token';
      addBtn.addEventListener('click', () => openAddTokenModal());
      section.appendChild(addBtn);

      wrap.appendChild(section);

      return wrap;
    }

    // --- "Local Inference" tab: llama-server binary override, HuggingFace
    // downloads, and the local LLM registry (former standalone Local
    // Inference Settings panel — kodo/doc/LLM_REGISTRY.md §4). ---

    const DEFAULT_CONTEXT_WINDOW = 262144;
    const HF_REPO_RE = /^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/;

    function parseLlamaArgs(text) {
      const tokens = text.trim().split(/\\s+/).filter(Boolean);
      const result = {};
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        result[tokens[i]] = tokens[i + 1];
      }
      return result;
    }

    function parseNonNegativeInt(text) {
      const trimmed = text.trim();
      if (!trimmed) { return 0; }
      const n = parseInt(trimmed, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function nameTaken(name) {
      return _state.localRegistry.some(e => e.name === name);
    }

    // --- Add from huggingface.com modal ---

    const hfModal = document.getElementById('hf-modal');
    const hfName = document.getElementById('hf-name');
    const hfDescription = document.getElementById('hf-description');
    const hfRepoId = document.getElementById('hf-repo-id');
    const hfFilename = document.getElementById('hf-filename');
    const hfLlamaArgs = document.getElementById('hf-llama-args');
    const hfContextWindow = document.getElementById('hf-context-window');
    const hfAddBtn = document.getElementById('hf-add-btn');

    function openHfModal() {
      hfName.value = '';
      hfDescription.value = '';
      hfRepoId.value = '';
      hfFilename.value = '';
      hfLlamaArgs.value = '';
      hfContextWindow.value = String(DEFAULT_CONTEXT_WINDOW);
      updateHfValidity();
      hfModal.classList.add('open');
      hfName.focus();
    }

    function closeHfModal() {
      hfModal.classList.remove('open');
    }

    function updateHfValidity() {
      const name = hfName.value.trim();
      const repoId = hfRepoId.value.trim();
      const filename = hfFilename.value.trim();
      const repoValid = HF_REPO_RE.test(repoId);
      const filenameValid = filename.toLowerCase().endsWith('.gguf') && filename.length > '.gguf'.length;
      const nameDup = name && nameTaken(name);
      document.getElementById('hf-name-error').textContent = nameDup ? ('An LLM named "' + name + '" already exists.') : '';
      document.getElementById('hf-repo-id-error').textContent = repoId && !repoValid ? 'Expected the form "account/repo".' : '';
      document.getElementById('hf-filename-error').textContent = filename && !filenameValid ? 'Filename must end with ".gguf".' : '';
      hfAddBtn.disabled = !(name && !nameDup && repoValid && filenameValid);
    }

    [hfName, hfRepoId, hfFilename].forEach(el => el.addEventListener('input', updateHfValidity));

    document.getElementById('hf-cancel-btn').addEventListener('click', closeHfModal);
    hfModal.addEventListener('click', (e) => { if (e.target === hfModal) { closeHfModal(); } });
    hfAddBtn.addEventListener('click', () => {
      if (hfAddBtn.disabled) { return; }
      vsc.postMessage({
        type: 'add_huggingface',
        name: hfName.value.trim(),
        description: hfDescription.value.trim(),
        repo_id: hfRepoId.value.trim(),
        filename: hfFilename.value.trim(),
        llama_args: parseLlamaArgs(hfLlamaArgs.value),
        context_window: parseNonNegativeInt(hfContextWindow.value),
      });
      closeHfModal();
    });

    // --- Add from file modal ---

    const fileModal = document.getElementById('file-modal');
    const fileName = document.getElementById('file-name');
    const fileDescription = document.getElementById('file-description');
    const filePickedLabel = document.getElementById('file-picked-label');
    const fileLlamaArgs = document.getElementById('file-llama-args');
    const fileContextWindow = document.getElementById('file-context-window');
    const fileAddBtn = document.getElementById('file-add-btn');
    let _filePickedPath = null;

    function openFileModal() {
      fileName.value = '';
      fileDescription.value = '';
      fileLlamaArgs.value = '';
      fileContextWindow.value = String(DEFAULT_CONTEXT_WINDOW);
      _filePickedPath = null;
      filePickedLabel.textContent = 'No file selected';
      updateFileValidity();
      fileModal.classList.add('open');
      fileName.focus();
    }

    function closeFileModal() {
      fileModal.classList.remove('open');
    }

    function updateFileValidity() {
      const name = fileName.value.trim();
      const nameDup = name && nameTaken(name);
      document.getElementById('file-name-error').textContent = nameDup ? ('An LLM named "' + name + '" already exists.') : '';
      fileAddBtn.disabled = !(name && !nameDup && _filePickedPath);
    }

    fileName.addEventListener('input', updateFileValidity);
    document.getElementById('file-select-btn').addEventListener('click', () => vsc.postMessage({ type: 'pick_gguf_file' }));
    document.getElementById('file-cancel-btn').addEventListener('click', closeFileModal);
    fileModal.addEventListener('click', (e) => { if (e.target === fileModal) { closeFileModal(); } });
    fileAddBtn.addEventListener('click', () => {
      if (fileAddBtn.disabled) { return; }
      vsc.postMessage({
        type: 'add_file',
        name: fileName.value.trim(),
        description: fileDescription.value.trim(),
        path: _filePickedPath,
        llama_args: parseLlamaArgs(fileLlamaArgs.value),
        context_window: parseNonNegativeInt(fileContextWindow.value),
      });
      closeFileModal();
    });

    // --- Add self-hosted llama-server link modal ---

    const serverModal = document.getElementById('server-modal');
    const serverName = document.getElementById('server-name');
    const serverDescription = document.getElementById('server-description');
    const serverUrl = document.getElementById('server-url');
    const serverAddBtn = document.getElementById('server-add-btn');

    function openServerModal() {
      serverName.value = '';
      serverDescription.value = '';
      serverUrl.value = '';
      updateServerValidity();
      serverModal.classList.add('open');
      serverName.focus();
    }

    function closeServerModal() {
      serverModal.classList.remove('open');
    }

    function updateServerValidity() {
      const name = serverName.value.trim();
      const url = serverUrl.value.trim();
      let urlValid = false;
      try {
        const parsed = new URL(url);
        urlValid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch (e) {
        urlValid = false;
      }
      const nameDup = name && nameTaken(name);
      document.getElementById('server-name-error').textContent = nameDup ? ('An LLM named "' + name + '" already exists.') : '';
      document.getElementById('server-url-error').textContent = url && !urlValid ? 'Enter a valid http(s) URL.' : '';
      serverAddBtn.disabled = !(name && !nameDup && urlValid);
    }

    [serverName, serverUrl].forEach(el => el.addEventListener('input', updateServerValidity));

    document.getElementById('server-cancel-btn').addEventListener('click', closeServerModal);
    serverModal.addEventListener('click', (e) => { if (e.target === serverModal) { closeServerModal(); } });
    serverAddBtn.addEventListener('click', () => {
      if (serverAddBtn.disabled) { return; }
      vsc.postMessage({
        type: 'add_server_url',
        name: serverName.value.trim(),
        description: serverDescription.value.trim(),
        url: serverUrl.value.trim(),
      });
      closeServerModal();
    });

    // --- Manage flavors modal ---
    //
    // A list-detail layout: the left pane lists every flavor for the entry
    // the button was opened from; selecting one populates the right pane's
    // form. _selectedFlavorId === null means "add new" mode (the form is
    // blank and Submit creates a brand-new flavor); otherwise Submit updates
    // the selected *custom* flavor in place. Predefined flavors are strictly
    // read-only (kodo/doc/LLM_REGISTRY.md section 4.6) — selecting one fills
    // the form for reference (fields become readonly, so their text stays
    // selectable/copyable into a new flavor) but disables Submit and Remove;
    // the server independently rejects update_flavor/remove_flavor for a
    // predefined flavor_id regardless of this client-side gate.

    const flavorModal = document.getElementById('flavor-modal');
    const flavorModalTitle = document.getElementById('flavor-modal-title');
    const flavorListEl = document.getElementById('flavor-list');
    const flavorAddListBtn = document.getElementById('flavor-add-list-btn');
    const flavorRemoveListBtn = document.getElementById('flavor-remove-list-btn');
    const flavorName = document.getElementById('flavor-name');
    const flavorDescription = document.getElementById('flavor-description');
    const flavorLlamaArgs = document.getElementById('flavor-llama-args');
    const flavorMinRam = document.getElementById('flavor-min-ram');
    const flavorMinVram = document.getElementById('flavor-min-vram');
    const flavorReadonlyHint = document.getElementById('flavor-readonly-hint');
    const flavorSubmitBtn = document.getElementById('flavor-submit-btn');
    const FLAVOR_FIELDS = [flavorName, flavorDescription, flavorLlamaArgs, flavorMinRam, flavorMinVram];
    let _flavorEntryName = null;
    let _selectedFlavorId = null;

    function currentFlavorEntry() {
      return _state.localRegistry.find(e => e.name === _flavorEntryName) || null;
    }

    function selectedFlavorPredefined() {
      const entry = currentFlavorEntry();
      const flavor = entry && (entry.flavors || []).find(f => f.id === _selectedFlavorId);
      return Boolean(flavor && flavor.predefined);
    }

    function llamaArgsToText(llamaArgs) {
      return Object.entries(llamaArgs || {})
        .map(([flag, value]) => value ? (flag + ' ' + value) : flag)
        .join('\\n');
    }

    function openFlavorModal(entryName) {
      _flavorEntryName = entryName;
      const entry = currentFlavorEntry();
      flavorModalTitle.textContent = 'Manage flavors — ' + ((entry && entry.description) || entryName);
      const flavors = (entry && entry.flavors) || [];
      const initialId = (entry && entry.active_flavor) || (flavors[0] && flavors[0].id) || null;
      selectFlavor(initialId);
      flavorModal.classList.add('open');
    }

    function closeFlavorModal() {
      flavorModal.classList.remove('open');
      _flavorEntryName = null;
      _selectedFlavorId = null;
    }

    // Excludes the flavor currently being edited, so re-submitting a flavor
    // under its own unchanged name isn't flagged as a clash with itself.
    function flavorNameTaken(name) {
      const entry = currentFlavorEntry();
      const flavors = (entry && entry.flavors) || [];
      return flavors.some(f => f.id !== _selectedFlavorId && f.name === name);
    }

    function updateFlavorValidity() {
      const name = flavorName.value.trim();
      const nameDup = name && flavorNameTaken(name);
      const readOnly = selectedFlavorPredefined();
      document.getElementById('flavor-name-error').textContent = nameDup ? ('A flavor named "' + name + '" already exists for this LLM.') : '';
      flavorSubmitBtn.disabled = readOnly || !name || nameDup;
    }

    function selectFlavor(flavorId) {
      _selectedFlavorId = flavorId || null;
      const entry = currentFlavorEntry();
      const flavor = entry && (entry.flavors || []).find(f => f.id === _selectedFlavorId);
      if (flavor) {
        flavorName.value = flavor.name;
        flavorDescription.value = flavor.description || '';
        flavorLlamaArgs.value = llamaArgsToText(flavor.llama_args);
        flavorMinRam.value = flavor.min_ram ? String(flavor.min_ram) : '';
        flavorMinVram.value = flavor.min_vram ? String(flavor.min_vram) : '';
      } else {
        flavorName.value = '';
        flavorDescription.value = '';
        flavorLlamaArgs.value = '';
        flavorMinRam.value = '';
        flavorMinVram.value = '';
      }
      const readOnly = selectedFlavorPredefined();
      FLAVOR_FIELDS.forEach(el => { el.readOnly = readOnly; });
      flavorReadonlyHint.classList.toggle('visible', readOnly);
      updateFlavorValidity();
      renderFlavorList();
    }

    function renderFlavorList() {
      flavorListEl.innerHTML = '';
      const entry = currentFlavorEntry();
      const flavors = (entry && entry.flavors) || [];
      const activeId = (entry && entry.active_flavor) || (flavors[0] && flavors[0].id) || '';
      flavors.forEach(f => {
        const row = document.createElement('div');
        row.className = 'flavor-list-row' + (f.id === _selectedFlavorId ? ' selected' : '');

        const nameLine = document.createElement('div');
        nameLine.className = 'flavor-row-name';
        nameLine.textContent = f.name + (f.id === activeId ? ' (active)' : '') + (f.predefined ? ' — built-in' : '');
        row.appendChild(nameLine);

        if (f.description) {
          const desc = document.createElement('div');
          desc.className = 'flavor-row-desc';
          desc.textContent = f.description;
          row.appendChild(desc);
        }

        row.addEventListener('click', () => selectFlavor(f.id));
        flavorListEl.appendChild(row);
      });

      const selected = flavors.find(f => f.id === _selectedFlavorId);
      flavorRemoveListBtn.disabled = !selected || selected.predefined;
    }

    // If the flavor modal is open, re-syncs it against the latest _state
    // (called from the top-level render() on every state-changing update) —
    // falls back off a selection that no longer exists (e.g. it was just
    // removed).
    function refreshFlavorModalIfOpen() {
      if (!_flavorEntryName) { return; }
      const entry = currentFlavorEntry();
      const flavors = (entry && entry.flavors) || [];
      if (_selectedFlavorId && !flavors.some(f => f.id === _selectedFlavorId)) {
        selectFlavor(flavors[0] ? flavors[0].id : null);
      } else {
        renderFlavorList();
      }
    }

    flavorName.addEventListener('input', updateFlavorValidity);
    document.getElementById('flavor-close-btn').addEventListener('click', closeFlavorModal);
    flavorModal.addEventListener('click', (e) => { if (e.target === flavorModal) { closeFlavorModal(); } });

    flavorAddListBtn.addEventListener('click', () => {
      selectFlavor(null);
      flavorName.focus();
    });

    flavorRemoveListBtn.addEventListener('click', () => {
      if (flavorRemoveListBtn.disabled || !_flavorEntryName || !_selectedFlavorId) { return; }
      vsc.postMessage({ type: 'remove_flavor', name: _flavorEntryName, flavor_id: _selectedFlavorId });
    });

    flavorSubmitBtn.addEventListener('click', () => {
      if (flavorSubmitBtn.disabled || !_flavorEntryName) { return; }
      if (_selectedFlavorId) {
        vsc.postMessage({
          type: 'update_flavor',
          name: _flavorEntryName,
          flavor_id: _selectedFlavorId,
          flavor_name: flavorName.value.trim(),
          description: flavorDescription.value.trim(),
          llama_args_text: flavorLlamaArgs.value,
          min_ram: parseNonNegativeInt(flavorMinRam.value),
          min_vram: parseNonNegativeInt(flavorMinVram.value),
        });
      } else {
        vsc.postMessage({
          type: 'add_flavor',
          name: _flavorEntryName,
          flavor_name: flavorName.value.trim(),
          description: flavorDescription.value.trim(),
          llama_args_text: flavorLlamaArgs.value,
          min_ram: parseNonNegativeInt(flavorMinRam.value),
          min_vram: parseNonNegativeInt(flavorMinVram.value),
        });
        // Stays open in "add another" mode — the freshly-added flavor shows
        // up in the left pane once the next registry_state arrives.
        flavorName.value = '';
        flavorDescription.value = '';
        flavorLlamaArgs.value = '';
        flavorMinRam.value = '';
        flavorMinVram.value = '';
        updateFlavorValidity();
      }
    });

    const DOWNLOADABLE = new Set(['hardcoded_hf', 'custom_hf']);
    const CUSTOM = new Set(['custom_hf', 'custom_file', 'custom_server_url']);
    const FLAVOR_CAPABLE = new Set(['hardcoded_hf', 'custom_hf', 'custom_file']);
    const _expandedGroups = new Set();
    let _installedExpanded = false;

    function formatBytes(n) {
      if (n == null) { return ''; }
      const mb = n / (1024 * 1024);
      return mb < 1024 ? Math.round(mb) + ' MB' : (mb / 1024).toFixed(2) + ' GB';
    }

    // Auto-scales B/s -> KB/s -> MB/s -> GB/s (1024-based), unlike formatBytes
    // above: a speed can legitimately sit well under 1 MB/s on a slow
    // connection, where formatBytes' MB/GB-only scale would round to '0 MB'.
    function formatSpeed(bytesPerSecond) {
      if (bytesPerSecond == null || bytesPerSecond < 0) { return ''; }
      const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
      let value = bytesPerSecond;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
      }
      const formatted = unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1);
      return formatted + ' ' + units[unitIndex];
    }

    // Rules (per product spec): red if below the absolute minimum; yellow if
    // below the recommended amount. When min_memory === memory, the red check
    // already covers every case the yellow check would (vram >= min == memory
    // implies vram >= memory), so only red can ever fire — no special-casing
    // needed. A 0 value means "unknown — don't warn" for that threshold.
    // vram/ram are summed into one "total memory available for a
    // GPU+CPU-offloaded model" figure — on macOS ram is always null (vram
    // already reports the full unified-memory pool), so the sum degrades to
    // vram alone there. See doc/LLM_REGISTRY.md §4.4 in the kodo repo.
    function ramWarning(entry, vram, ram) {
      if (vram == null && ram == null) { return null; }
      const total = (vram || 0) + (ram || 0);
      const min = entry.min_memory || 0;
      const rec = entry.memory || 0;
      if (min > 0 && total < min) {
        return {
          level: 'red',
          text: '⛔ This LLM will likely not run on this machine — it needs at least ' +
            min + ' GB of combined VRAM + RAM, but only ' + total + ' GB was detected.',
        };
      }
      if (rec > 0 && total < rec) {
        return {
          level: 'yellow',
          text: '⚠️ This LLM may not perform well with large contexts on this machine — ' +
            rec + ' GB of combined VRAM + RAM is recommended, but only ' + total + ' GB was detected.',
        };
      }
      return null;
    }

    // Returns null when there's nothing to show — the caller only appends it
    // when non-null, unlike the former standalone panel's always-present,
    // CSS-toggled-visible element (this tab tears down and rebuilds its whole
    // content div on every render, so there's no persistent node to toggle).
    function renderUpdatesBanner() {
      const names = _state.updatableNames || [];
      if (names.length === 0) { return null; }
      const labels = names.map(name => {
        const entry = _state.localRegistry.find(e => e.name === name);
        return (entry && entry.description) || name;
      });
      const banner = document.createElement('div');
      banner.id = 'updates-banner';
      banner.textContent = '⚠️ ' + (names.length === 1
        ? ('An update is available for ' + labels[0] + '.')
        : ('Updates are available for ' + names.length + ' models: ' + labels.join(', ') + '.'));
      return banner;
    }

    function renderDownloads() {
      const downloads = _state.downloads || [];
      if (downloads.length === 0) { return null; } // nothing downloading — show nothing at all

      const section = document.createElement('div');
      section.id = 'downloads-section';
      section.appendChild(document.createElement('hr')).className = 'divider';
      downloads.forEach(dl => {
        const row = document.createElement('div');
        row.className = 'download-row';

        const dlEntry = _state.localRegistry.find(e => e.name === dl.name);
        const name = document.createElement('div');
        name.className = 'download-name';
        name.textContent = (dlEntry && dlEntry.description) || dl.name;
        row.appendChild(name);

        const repo = document.createElement('div');
        repo.className = 'download-repo';
        repo.textContent = dl.repo_id;
        row.appendChild(repo);

        const track = document.createElement('div');
        track.className = 'progress-track';
        const fill = document.createElement('div');
        fill.className = 'progress-fill';
        const pct = dl.bytes_total ? Math.min(100, (dl.bytes_downloaded / dl.bytes_total) * 100) : 0;
        fill.style.width = pct + '%';
        track.appendChild(fill);
        row.appendChild(track);

        const label = document.createElement('div');
        label.className = 'progress-label';
        let labelText = dl.bytes_total
          ? (formatBytes(dl.bytes_downloaded) + ' / ' + formatBytes(dl.bytes_total))
          : (formatBytes(dl.bytes_downloaded) + ' downloaded');
        if (dl.status === 'downloading' && dl.bytes_per_second != null) {
          labelText += ' — ' + formatSpeed(dl.bytes_per_second);
        }
        label.textContent = labelText;
        row.appendChild(label);

        const status = document.createElement('div');
        status.className = 'download-status ' + dl.status;
        status.textContent = dl.status === 'paused' ? 'Paused'
          : dl.status === 'failed' ? ('Failed' + (dl.error ? ': ' + dl.error : ''))
          : 'Downloading…';
        row.appendChild(status);

        const buttons = document.createElement('div');
        buttons.className = 'row-buttons';
        if (dl.status === 'downloading') {
          const pauseBtn = document.createElement('button');
          pauseBtn.className = 'secondary-btn';
          pauseBtn.textContent = 'Pause';
          pauseBtn.addEventListener('click', () => {
            // Same immediate-feedback pattern as "Download and Install" below:
            // the next 'update' (disk-poll tick reflecting the new status)
            // always re-renders this row from scratch, so there's no separate
            // re-enable path to maintain.
            pauseBtn.disabled = true;
            pauseBtn.textContent = 'Pausing…';
            vsc.postMessage({ type: 'pause', name: dl.name });
          });
          buttons.appendChild(pauseBtn);
        } else {
          const resumeBtn = document.createElement('button');
          resumeBtn.textContent = 'Resume';
          resumeBtn.addEventListener('click', () => {
            resumeBtn.disabled = true;
            resumeBtn.textContent = 'Resuming…';
            vsc.postMessage({ type: 'resume', name: dl.name });
          });
          buttons.appendChild(resumeBtn);
        }
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'secondary-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => vsc.postMessage({ type: 'cancel', name: dl.name }));
        buttons.appendChild(cancelBtn);
        row.appendChild(buttons);

        section.appendChild(row);
        section.appendChild(document.createElement('hr')).className = 'divider';
      });
      return section;
    }

    function renderModelCard(entry, downloadingNames) {
      const card = document.createElement('div');
      card.className = 'model-card';

      const name = document.createElement('div');
      name.className = 'cell-name';
      // entry.name is an internal identifier for hardcoded entries (a slug);
      // only custom entries lack a description and fall back to the
      // user-typed name.
      name.textContent = entry.description || entry.name;
      card.appendChild(name);

      if (entry.quant_type || entry.quant_author) {
        const line = document.createElement('div');
        line.className = 'model-meta-line';
        line.textContent = [entry.quant_type, entry.quant_author].filter(Boolean).join(' · ');
        card.appendChild(line);
      }

      if (entry.repo_id) {
        const line = document.createElement('div');
        line.className = 'model-meta-line';
        const link = document.createElement('a');
        link.href = 'https://huggingface.co/' + entry.repo_id;
        link.textContent = entry.repo_id;
        line.appendChild(link);
        card.appendChild(line);
      } else if (entry.kind === 'custom_file' && entry.path) {
        const line = document.createElement('div');
        line.className = 'model-meta-line';
        line.textContent = entry.path;
        card.appendChild(line);
      } else if (entry.kind === 'custom_server_url' && entry.url) {
        const line = document.createElement('div');
        line.className = 'model-meta-line';
        line.textContent = entry.url;
        card.appendChild(line);
      }

      if (entry.size_hint) {
        const line = document.createElement('div');
        line.className = 'model-meta-line';
        const label = document.createElement('span');
        label.className = 'meta-label';
        label.textContent = 'Size: ';
        line.appendChild(label);
        line.appendChild(document.createTextNode(entry.size_hint));
        card.appendChild(line);
      }

      const tip = _state.isMac ? entry.mac_tip : entry.gpu_tip;
      if (tip) {
        const tipEl = document.createElement('div');
        tipEl.className = 'hw-tip';
        tipEl.textContent = tip;
        card.appendChild(tipEl);
      }

      const warning = ramWarning(entry, _state.detectedVramGb, _state.detectedRamGb);
      if (warning) {
        const w = document.createElement('div');
        w.className = 'ram-warning ' + warning.level;
        w.textContent = warning.text;
        card.appendChild(w);
      }

      if (entry.installed) {
        const tag = document.createElement('span');
        tag.className = 'installed-tag';
        tag.textContent = 'Installed';
        card.appendChild(tag);
      }

      if (DOWNLOADABLE.has(entry.kind) && entry.installed && (_state.updatableNames || []).includes(entry.name)) {
        const updateTag = document.createElement('div');
        updateTag.className = 'update-available-tag';
        updateTag.textContent = '⚠️ Update available';
        card.appendChild(updateTag);
      }

      const buttons = document.createElement('div');
      buttons.className = 'row-buttons';

      // Flavor *selection* lives only in the sidebar now — this button just
      // opens the "Manage flavors" modal (add/edit/remove definitions).
      // Only meaningful once the model is installed — flavors are local files.
      if (FLAVOR_CAPABLE.has(entry.kind) && entry.installed) {
        const manageBtn = document.createElement('button');
        manageBtn.className = 'secondary-btn';
        manageBtn.type = 'button';
        manageBtn.textContent = 'Manage flavors';
        manageBtn.addEventListener('click', () => openFlavorModal(entry.name));
        buttons.appendChild(manageBtn);
      }

      if (DOWNLOADABLE.has(entry.kind) && !entry.installed) {
        if (downloadingNames.has(entry.name)) {
          const note = document.createElement('span');
          note.className = 'download-repo';
          note.textContent = 'Downloading — see progress above.';
          buttons.appendChild(note);
        } else {
          const installBtn = document.createElement('button');
          installBtn.textContent = 'Download and Install';
          installBtn.addEventListener('click', () => {
            // Immediate feedback only — the next 'update' (kickoff reply, disk-poll
            // tick, or an error event's registry_state) always re-renders this button
            // from scratch, so a silent early failure just gets a normal one back.
            installBtn.disabled = true;
            installBtn.textContent = 'Starting download…';
            vsc.postMessage({ type: 'install', name: entry.name });
          });
          buttons.appendChild(installBtn);
        }
      }

      if (entry.installed && entry.installed_path) {
        const revealBtn = document.createElement('button');
        revealBtn.className = 'secondary-btn';
        revealBtn.textContent = 'Show me local files';
        revealBtn.addEventListener('click', () => vsc.postMessage({ type: 'reveal', name: entry.name }));
        buttons.appendChild(revealBtn);
      }

      if (DOWNLOADABLE.has(entry.kind) && entry.installed && (_state.updatableNames || []).includes(entry.name)) {
        const updateBtn = document.createElement('button');
        updateBtn.textContent = 'Update';
        updateBtn.addEventListener('click', () => {
          // Same immediate-feedback pattern as "Download and Install" above: the
          // update is a server-side uninstall-then-reinstall (doc/LOCAL_MODEL_
          // MANAGER.md §12), so the entry briefly becomes not-installed and this
          // button disappears on its own — the next 'update' postMessage always
          // rebuilds the card from scratch, no separate re-enable path needed.
          updateBtn.disabled = true;
          updateBtn.textContent = 'Updating…';
          vsc.postMessage({ type: 'update', name: entry.name });
        });
        buttons.appendChild(updateBtn);
      }

      if (DOWNLOADABLE.has(entry.kind) && entry.installed) {
        const uninstallBtn = document.createElement('button');
        uninstallBtn.className = 'secondary-btn';
        uninstallBtn.textContent = 'Uninstall';
        uninstallBtn.addEventListener('click', () => vsc.postMessage({ type: 'uninstall', name: entry.name }));
        buttons.appendChild(uninstallBtn);
      }

      if (CUSTOM.has(entry.kind)) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'secondary-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => vsc.postMessage({ type: 'remove', name: entry.name }));
        buttons.appendChild(removeBtn);
      }

      card.appendChild(buttons);
      return card;
    }

    function renderCards() {
      const cards = document.createElement('div');
      cards.id = 'cards';

      if (_state.localRegistry.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = 'No local LLMs yet — add one above.';
        cards.appendChild(msg);
        return cards;
      }

      const groups = new Map();
      _state.localRegistry.forEach(entry => {
        const key = entry.base_llm || entry.name;
        if (!groups.has(key)) { groups.set(key, []); }
        groups.get(key).push(entry);
      });

      const downloadingNames = new Set((_state.downloads || []).map(d => d.name));

      groups.forEach((entries, key) => {
        const group = document.createElement('div');
        group.className = 'base-llm-group';
        const expanded = _expandedGroups.has(key);

        const header = document.createElement('div');
        header.className = 'group-header' + (expanded ? ' expanded' : '');
        const chevron = document.createElement('span');
        chevron.className = 'chevron';
        chevron.textContent = '▶';
        header.appendChild(chevron);
        const title = document.createElement('span');
        title.className = 'group-title';
        title.textContent = key;
        header.appendChild(title);
        const count = document.createElement('span');
        count.className = 'group-count';
        count.textContent = '(' + entries.length + ')';
        header.appendChild(count);
        header.addEventListener('click', () => {
          if (_expandedGroups.has(key)) { _expandedGroups.delete(key); } else { _expandedGroups.add(key); }
          render();
        });
        group.appendChild(header);

        const body = document.createElement('div');
        body.className = 'group-body' + (expanded ? ' expanded' : '');
        entries.forEach(entry => body.appendChild(renderModelCard(entry, downloadingNames)));
        group.appendChild(body);

        cards.appendChild(group);
      });

      return cards;
    }

    function renderInstalled() {
      const section = document.createElement('div');
      section.id = 'installed-section';

      const installed = _state.localRegistry.filter(e => e.installed);

      const group = document.createElement('div');
      group.className = 'base-llm-group';

      const header = document.createElement('div');
      header.className = 'group-header' + (_installedExpanded ? ' expanded' : '');
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '▶';
      header.appendChild(chevron);
      const title = document.createElement('span');
      title.className = 'group-title';
      title.textContent = 'Installed';
      header.appendChild(title);
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = '(' + installed.length + ')';
      header.appendChild(count);
      header.addEventListener('click', () => {
        _installedExpanded = !_installedExpanded;
        render();
      });
      group.appendChild(header);

      const body = document.createElement('div');
      body.className = 'group-body' + (_installedExpanded ? ' expanded' : '');
      if (installed.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = 'Nothing installed yet — download one of the quants below.';
        body.appendChild(msg);
      } else {
        const downloadingNames = new Set((_state.downloads || []).map(d => d.name));
        installed.forEach(entry => body.appendChild(renderModelCard(entry, downloadingNames)));
      }
      group.appendChild(body);

      section.appendChild(group);
      section.appendChild(document.createElement('hr')).className = 'divider';
      return section;
    }

    function renderLlamaOverrideSection() {
      const wrap = document.createElement('div');

      const subheading = document.createElement('div');
      subheading.className = 'section-subheading';
      subheading.textContent = 'Llama-server binary override';
      wrap.appendChild(subheading);

      const intro = document.createElement('p');
      intro.className = 'explain';
      intro.textContent = 'You can build and manage your own installation of llama.cpp instead of using the '
        + 'bundled binary — this can be especially useful on Linux, where you may want to build '
        + 'a custom llama.cpp with CUDA support.';
      wrap.appendChild(intro);

      const overridePath = document.createElement('div');
      overridePath.id = 'override-path';
      overridePath.textContent = _state.llamaServerOverridePath
        ? _state.llamaServerOverridePath
        : 'No override — using the bundled llama.cpp binary.';
      wrap.appendChild(overridePath);

      const spacer1 = document.createElement('div');
      spacer1.className = 'spacer';
      wrap.appendChild(spacer1);

      const setIntro = document.createElement('p');
      setIntro.className = 'explain';
      setIntro.textContent = 'Point Kōdo at a llama-server binary from your own llama.cpp build.';
      wrap.appendChild(setIntro);

      const setBtn = document.createElement('button');
      setBtn.className = 'action-btn';
      setBtn.textContent = 'Set llama.cpp override';
      setBtn.addEventListener('click', () => vsc.postMessage({ type: 'set_override' }));
      wrap.appendChild(setBtn);

      const spacer2 = document.createElement('div');
      spacer2.className = 'spacer';
      wrap.appendChild(spacer2);

      const removeIntro = document.createElement('p');
      removeIntro.className = 'explain';
      removeIntro.textContent = 'Clear the override and go back to the bundled llama.cpp binary.';
      wrap.appendChild(removeIntro);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'action-btn';
      removeBtn.textContent = 'Remove llama.cpp override';
      removeBtn.disabled = !_state.llamaServerOverridePath;
      removeBtn.addEventListener('click', () => {
        if (!_state.llamaServerOverridePath) { return; }
        vsc.postMessage({ type: 'remove_override' });
      });
      wrap.appendChild(removeBtn);

      return wrap;
    }

    function renderLocalLlmsSection() {
      const wrap = document.createElement('div');

      const subheading = document.createElement('div');
      subheading.className = 'section-subheading';
      subheading.textContent = 'Local LLMs';
      wrap.appendChild(subheading);

      const hfIntro = document.createElement('p');
      hfIntro.className = 'explain';
      hfIntro.textContent = 'Download a GGUF model from huggingface.com and add it to your local registry.';
      wrap.appendChild(hfIntro);
      const addHfBtn = document.createElement('button');
      addHfBtn.className = 'action-btn';
      addHfBtn.textContent = 'Add local LLM (GGUF) from huggingface.com';
      addHfBtn.addEventListener('click', () => openHfModal());
      wrap.appendChild(addHfBtn);

      const spacer1 = document.createElement('div');
      spacer1.className = 'spacer';
      wrap.appendChild(spacer1);

      const fileIntro = document.createElement('p');
      fileIntro.className = 'explain';
      fileIntro.textContent = 'Add a GGUF file you already have on disk.';
      wrap.appendChild(fileIntro);
      const addFileBtn = document.createElement('button');
      addFileBtn.className = 'action-btn';
      addFileBtn.textContent = 'Add local LLM (GGUF) from file';
      addFileBtn.addEventListener('click', () => openFileModal());
      wrap.appendChild(addFileBtn);

      const spacer2 = document.createElement('div');
      spacer2.className = 'spacer';
      wrap.appendChild(spacer2);

      const serverIntro = document.createElement('p');
      serverIntro.className = 'explain';
      serverIntro.textContent = 'Point Kōdo at a llama-server (or OpenAI-compatible) instance you host yourself — '
        + 'on this machine or anywhere else on your network.';
      wrap.appendChild(serverIntro);
      const addServerBtn = document.createElement('button');
      addServerBtn.className = 'action-btn';
      addServerBtn.textContent = 'Add a link to self-hosted llama-server';
      addServerBtn.addEventListener('click', () => openServerModal());
      wrap.appendChild(addServerBtn);

      const btnDivider = document.createElement('hr');
      btnDivider.className = 'divider';
      wrap.appendChild(btnDivider);

      const downloads = renderDownloads();
      if (downloads) { wrap.appendChild(downloads); }

      const updatesBanner = renderUpdatesBanner();
      if (updatesBanner) { wrap.appendChild(updatesBanner); }

      wrap.appendChild(renderInstalled());

      const availableHeading = document.createElement('div');
      availableHeading.className = 'section-heading';
      availableHeading.textContent = 'Available local LLM quants';
      wrap.appendChild(availableHeading);

      const availableIntro = document.createElement('p');
      availableIntro.className = 'explain';
      availableIntro.textContent = 'Browse the quants below and click "Download and Install" to fetch one — once it '
        + 'finishes, it shows up above under Installed and is ready to use.';
      wrap.appendChild(availableIntro);

      wrap.appendChild(renderCards());

      return wrap;
    }

    function renderLocalInferenceSection() {
      const wrap = document.createElement('div');

      const heading = document.createElement('h2');
      heading.textContent = 'Local Inference';
      wrap.appendChild(heading);

      const topDivider = document.createElement('hr');
      topDivider.className = 'section-divider';
      wrap.appendChild(topDivider);

      wrap.appendChild(renderLlamaCppSection());

      const d1 = document.createElement('hr');
      d1.className = 'section-divider';
      wrap.appendChild(d1);

      wrap.appendChild(renderLlamaOverrideSection());

      const d2 = document.createElement('hr');
      d2.className = 'section-divider';
      wrap.appendChild(d2);

      wrap.appendChild(renderHuggingFaceSection());

      const d3 = document.createElement('hr');
      d3.className = 'section-divider';
      wrap.appendChild(d3);

      wrap.appendChild(renderLocalLlmsSection());

      return wrap;
    }

    // --- Cloud vendor tabs (former standalone Cloud AI Settings panel) ---

    function renderCloudKeysSection(vendor, vendorLabel) {
      const section = document.createElement('div');
      section.className = 'keys-section';

      const heading = document.createElement('div');
      heading.className = 'section-heading';
      heading.textContent = 'API access keys';
      section.appendChild(heading);

      const divider = document.createElement('hr');
      divider.className = 'section-divider';
      section.appendChild(divider);

      const keys = (_state.keysByVendor && _state.keysByVendor[vendor]) || [];
      if (keys.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'no-keys-msg';
        msg.textContent = 'No API keys configured for ' + vendorLabel + ' yet.';
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
      addBtn.addEventListener('click', () => openAddKeyModal(vendor));
      section.appendChild(addBtn);

      return section;
    }

    function renderEffortSection(vendor, info, effort) {
      const vendorModels = (_state.modelsByVendor && _state.modelsByVendor[vendor]) || {};
      const section = document.createElement('div');

      const title = document.createElement('div');
      title.className = 'effort-title';
      title.textContent = EFFORT_LABELS[effort];
      section.appendChild(title);

      const example = document.createElement('div');
      example.className = 'effort-example';
      example.textContent = EFFORT_EXAMPLES[effort];
      section.appendChild(example);

      const select = document.createElement('select');
      select.className = 'settings-select model-select';
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

    function renderCloudVendorPanel(vendor, info) {
      const wrap = document.createElement('div');
      const vendorMeta = CLOUD_VENDORS[vendor] || { icon: '🧩' };

      const heading = document.createElement('h2');
      heading.textContent = vendorMeta.icon + ' ' + info.display_name + ' LLMs';
      wrap.appendChild(heading);

      const topDivider = document.createElement('hr');
      topDivider.className = 'section-divider';
      wrap.appendChild(topDivider);

      const intro = document.createElement('p');
      intro.className = 'intro-text';
      intro.textContent = 'Configure access to ' + info.display_name + "'s models: add or remove API access tokens, and choose which model handles each level of effort, from quick low-effort subagent tasks up to the hardest max-effort problems.";
      wrap.appendChild(intro);

      wrap.appendChild(renderCloudKeysSection(vendor, info.display_name));

      EFFORT_LEVELS.forEach(effort => {
        const d = document.createElement('hr');
        d.className = 'section-divider';
        wrap.appendChild(d);
        wrap.appendChild(renderEffortSection(vendor, info, effort));
      });

      return wrap;
    }

    function renderCloudComingSoon(vendor) {
      const wrap = document.createElement('div');
      wrap.className = 'coming-soon';
      const vendorMeta = CLOUD_VENDORS[vendor] || { icon: '🧩', label: vendor, coming_soon_text: 'Support for this vendor is on the way.' };

      const heading = document.createElement('h2');
      heading.textContent = vendorMeta.icon + ' ' + vendorMeta.label;
      wrap.appendChild(heading);

      const topDivider = document.createElement('hr');
      topDivider.className = 'section-divider';
      wrap.appendChild(topDivider);

      const text = document.createElement('p');
      text.textContent = vendorMeta.coming_soon_text;
      wrap.appendChild(text);

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Coming soon';
      wrap.appendChild(badge);

      return wrap;
    }

    function renderCloudVendorSection(vendor) {
      const info = _state.cloudRegistry[vendor];
      return info ? renderCloudVendorPanel(vendor, info) : renderCloudComingSoon(vendor);
    }

    function render() {
      renderNav();
      const content = document.getElementById('content');
      content.innerHTML = '';
      if (_selectedKey === 'general') {
        content.appendChild(renderGeneralSection());
      } else if (_selectedKey === 'sessions') {
        content.appendChild(renderSessionsSection());
      } else if (_selectedKey === 'global-rules') {
        content.appendChild(renderGlobalRulesSection());
      } else if (_selectedKey === 'local-inference') {
        content.appendChild(renderLocalInferenceSection());
      } else if (CLOUD_VENDOR_KEYS.includes(_selectedKey)) {
        content.appendChild(renderCloudVendorSection(_selectedKey));
      }
      renderModal();
      // The flavor modal is a static top-level node (kept out of #content so
      // it survives the teardown/rebuild above) — re-sync it against the
      // latest state on every render regardless of the active tab; a no-op
      // unless it's actually open.
      refreshFlavorModalIfOpen();
    }

    window.addEventListener('message', ({ data }) => {
      if (data.type === 'gguf_file_picked') {
        if (data.path) {
          _filePickedPath = data.path;
          filePickedLabel.textContent = data.path;
        }
        updateFileValidity();
        return;
      }
      if (data.type === 'select_section') {
        _selectedKey = data.key;
        render();
        return;
      }
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
      if (Array.isArray(data.hfTokens)) {
        _state.hfTokens = data.hfTokens;
      }
      if (data.cloudRegistry && typeof data.cloudRegistry === 'object') {
        _state.cloudRegistry = data.cloudRegistry;
      }
      if (data.modelsByVendor && typeof data.modelsByVendor === 'object') {
        _state.modelsByVendor = data.modelsByVendor;
      }
      if (data.keysByVendor && typeof data.keysByVendor === 'object') {
        _state.keysByVendor = data.keysByVendor;
      }
      _state.localRegistry = data.localRegistry || _state.localRegistry;
      _state.llamaServerOverridePath = data.llamaServerOverridePath !== undefined
        ? data.llamaServerOverridePath : _state.llamaServerOverridePath;
      _state.downloads = data.downloads || [];
      _state.detectedVramGb = data.detectedVramGb !== undefined ? data.detectedVramGb : _state.detectedVramGb;
      _state.detectedRamGb = data.detectedRamGb !== undefined ? data.detectedRamGb : _state.detectedRamGb;
      _state.isMac = Boolean(data.isMac);
      _state.updatableNames = data.updatableNames !== undefined ? data.updatableNames : _state.updatableNames;
      render();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') { return; }
      if (_sessionSettingsFor) { closeSessionSettings(); }
      if (_addTokenModalOpen) { closeAddTokenModal(); }
      if (_addKeyModalVendor) { closeAddKeyModal(); }
      if (hfModal.classList.contains('open')) { closeHfModal(); }
      if (fileModal.classList.contains('open')) { closeFileModal(); }
      if (serverModal.classList.contains('open')) { closeServerModal(); }
      if (flavorModal.classList.contains('open')) { closeFlavorModal(); }
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
