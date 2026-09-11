import * as vscode from 'vscode';
import type {
  BedrockModelInfo,
  CloudRegistry,
  CloudUniformEntry,
  EffortLevel,
  LocalLaunchWarning,
  LocalRegistryEntry,
  OpenRouterModelInfo,
} from './llm-registry-types';
import { localLaunchWarnings } from './llm-registry-types';

/**
 * One row of the cloud footer's search-as-you-type model picker, normalised
 * from whichever fetched-catalog vendor is active. Mirrors the interface of
 * the same name in `settings-webview/CloudVendorSection.tsx` — the two
 * surfaces offer the same catalogs, so they normalise them identically.
 */
export interface CloudPickerOption {
  id: string;
  name: string;
  /** Optional trailing note on the row, e.g. Bedrock's provider name. */
  hint?: string;
}

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
  /** `true` on Apple Silicon (`process.platform === 'darwin'`), `false` for a
   *  Windows/Linux discrete-GPU host. Never changes at runtime; set once at
   *  startup. Only used for hardware-tip wording now — the per-configuration
   *  platform filter went away with flavors (kodo/doc/LLM_REGISTRY.md §4.6). */
  isMac: boolean;
  /** Pinned local LLM registry names, in pin order (oldest pin first/topmost)
   *  — pinned cards render above unpinned ones in `renderLocalCards`.
   *  Persisted in `~/.kodo/etc/ui-settings.json` (`settings-io.ts`). */
  pinnedLocalModels: string[];
  /** Same as `pinnedLocalModels` but for cloud vendor keys. */
  pinnedCloudVendors: string[];
  /** `models.cloud` from settings.json — vendor -> effort tier -> model id
   *  (kodo/doc/LLM_REGISTRY.md §2). Backs the cloud footer's four per-tier
   *  pickers. This is the very same map the Kōdo Settings Cloud AI tab edits;
   *  both surfaces are refreshed from `pushCloudAiSettingsState`
   *  (extension/cloud-ai-settings.ts) so they can never drift apart. */
  cloudModels: Record<string, Record<string, string>>;
  /** `models.cloud_uniform` — vendor -> its "use the same LLM for all agents"
   *  shortcut (kodo/doc/LLM_REGISTRY.md §3c). Enabling it does NOT overwrite
   *  `cloudModels`, so unchecking restores the per-tier picks untouched. */
  cloudUniform: Record<string, CloudUniformEntry>;
  /** OpenRouter's account-wide Auto mode (§3a). Mutually exclusive with the
   *  uniform shortcut at the UI layer, so the footer locks itself while it's
   *  on — same rule `OpenRouterVendorPanel` enforces in Kōdo Settings. */
  openRouterAutoMode: boolean;
  /** The two aggregator vendors' runtime-fetched catalogs (§3a/§3b) — neither
   *  has a compiled-in `cloudRegistry` entry. Held here but deliberately NOT
   *  put on the wire whole: `_post` narrows them to the active vendor's rows.
   */
  openRouterCatalog: OpenRouterModelInfo[];
  bedrockCatalog: BedrockModelInfo[];
  /** vendor -> whether it has at least one API key configured. Only used for
   *  the catalog picker's empty-state copy: without a key the catalog can
   *  never populate, so "API key is required" beats "Loading…". */
  cloudHasKey: Record<string, boolean>;
}

export type SidebarMessage =
  | { type: 'list_sessions' }
  | { type: 'new_session' }
  | { type: 'set_mode'; mode: 'local' | 'cloud' }
  | { type: 'set_active_model'; name: string }
  | { type: 'set_active_profile'; name: string; profile_id: string }
  | { type: 'configure_local_model'; name: string }
  | { type: 'set_cloud_vendor'; vendor: string }
  | { type: 'set_cloud_model'; vendor: string; effort: EffortLevel; model_id: string }
  | { type: 'set_cloud_uniform_enabled'; vendor: string; enabled: boolean }
  | { type: 'set_cloud_uniform_model'; vendor: string; model_id: string }
  | { type: 'toggle_pin_local_model'; name: string }
  | { type: 'toggle_pin_cloud_vendor'; vendor: string }
  | { type: 'open_local_inference_settings' }
  | { type: 'open_cloud_ai_settings' }
  | { type: 'open_kodo_settings' }
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
    const payload: Record<string, unknown> = { type: 'update', ...state };
    // The aggregator catalogs are hundreds of entries each and would
    // otherwise ride along on every unrelated sidebar update (connection
    // blips, llama.cpp status, session stage…). Only the active vendor's
    // rows can ever be rendered, and only the three fields the picker shows,
    // so they are narrowed here instead — same "derive it host-side" reason
    // as `_computeLocalWarnings` below.
    delete payload.openRouterCatalog;
    delete payload.bedrockCatalog;
    payload.cloudCatalogOptions = this._cloudCatalogOptions(state);
    payload.localWarnings = this._computeLocalWarnings(state);
    this._view?.webview.postMessage(payload);
  }

  // The active vendor's fetched catalog as picker rows, or `[]` for the seven
  // compiled-in vendors (whose short model lists already travel inside
  // `cloudRegistry` and render as a plain <select> instead). Normalises each
  // catalog exactly as `CloudVendorSection.tsx`'s `pickerOptions` memos do —
  // notably labelling Bedrock's cross-region inference profiles, which are
  // how most Bedrock models must actually be invoked.
  private _cloudCatalogOptions(state: SidebarState): CloudPickerOption[] {
    if (state.activeCloudVendor === 'openrouter') {
      return state.openRouterCatalog.map((m) => ({ id: m.id, name: m.name }));
    }
    if (state.activeCloudVendor === 'bedrock') {
      return state.bedrockCatalog.map((m) => ({
        id: m.id,
        name: m.inference_profile ? `${m.name} (cross-region profile)` : m.name,
        hint: m.provider,
      }));
    }
    return [];
  }

  // Outstanding memory/llama.cpp-version warnings per local LLM, keyed by
  // registry name — computed here (not in the webview's plain-JS script,
  // which can't import this TS module) so the sidebar card's warning icon
  // uses the exact same rules as the launch-gating confirm dialog
  // (`activeLocalLaunchWarnings` in extension/local-llm-registry.ts).
  private _computeLocalWarnings(state: SidebarState): Record<string, LocalLaunchWarning[]> {
    const installedVersion = state.llamaInstalled && state.llamaVersion ? state.llamaVersion : null;
    const result: Record<string, LocalLaunchWarning[]> = {};
    for (const entry of state.localRegistry) {
      const warnings = localLaunchWarnings(
        entry,
        state.detectedVramGb,
        state.detectedRamGb,
        installedVersion,
      );
      if (warnings.length > 0) {
        result[entry.name] = warnings;
      }
    }
    return result;
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
    /* Three fixed bands: a header that never scrolls, one scrolling middle
       (the LLM / provider cards), and a bottom-anchored footer. Before this
       the sidebar was one long scrolling document, so a user with many
       installed local LLMs pushed the status line and the session buttons
       clean out of view. */
    body {
      padding: 0;
      margin: 0;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      box-sizing: border-box;
    }
    /* Full height whenever it fits, which is the normal case. It shrinks (and
       scrolls internally) only after #scroll-area has given up everything —
       see the flex-basis note below — because a sidebar sharing its column
       with several other views can be shorter than header + footer, and
       nothing may ever become unreachable. */
    #header {
      flex: 0 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 12px 0;
    }
    /* \`flex: 1 1 0\` is doing something subtle and load-bearing. The \`0\`
       basis is what orders the degradation: flexbox shares a shortfall out in
       proportion to each item's basis, so a zero-basis item absorbs none of
       it and the header would be squeezed alongside this band on any sidebar
       too short for both — even a comfortably sized one. With basis 0 this
       band instead simply takes whatever space is left over (flex-grow), and
       the header only starts shrinking once there is none left. \`min-height:
       0\` is separately required: without it the band grows to fit every card
       and nothing ever scrolls, which was the original bug. */
    #scroll-area {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      padding: 0 12px 8px;
    }
    /* Painted above #scroll-area so the model picker's dropdown — which opens
       *upward*, there being no room below a bottom-anchored section — is
       never drawn under a provider card. \`:empty\` keeps local mode, which
       has no footer, pixel-identical to before. */
    /* Never shrinks and never scrolls internally: it is the band the user
       asked to have anchored, and an \`overflow\` here would clip the model
       picker's dropdown (which deliberately overflows upward out of this
       box). Degradation order is therefore card list, then header, never
       this. */
    #footer-section {
      flex: 0 0 auto;
      padding: 0 12px 8px;
      position: relative;
      z-index: 2;
    }
    #footer-section:empty { display: none; }
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
    #open-settings-btn { margin-bottom: 8px; }
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
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .card.active .card-meta-line {
      color: var(--vscode-button-foreground);
      opacity: 0.85;
    }
    .card.active .pin-btn:not(.pinned) {
      color: var(--vscode-button-foreground);
      opacity: 0.7;
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
      min-width: 0;
    }
    .pin-btn {
      all: unset;
      flex-shrink: 0;
      cursor: pointer;
      line-height: 1;
      font-size: 1em;
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
    }
    .pin-btn:hover { opacity: 1; }
    .pin-btn.pinned {
      color: var(--vscode-charts-yellow, #cca700);
      opacity: 1;
    }
    .warn-btn {
      all: unset;
      flex-shrink: 0;
      cursor: default;
      line-height: 1;
      font-size: 1em;
    }
    .warn-btn.level-yellow { color: var(--vscode-charts-yellow, #cca700); }
    .warn-btn.level-red { color: var(--vscode-errorForeground, #f44336); }
    .card-meta-line {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .pin-divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      margin: 4px 0;
    }
    .profile-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
    }
    button.configure-btn {
      /* Secondary styling — the card's primary action is the radio that
         selects the model, not this. Square gear button sitting beside the
         profile picker; disabled (never hidden) whenever a user-defined
         profile is selected, since knobs only exist on the Default profile —
         disabling instead of hiding keeps the row's layout stable. */
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      padding: 3px 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.95em;
      line-height: 1;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    button.configure-btn:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    select.profile-select {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
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
    /* --- Cloud footer: per-vendor model selection ------------------------ */
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      font-size: 0.9em;
      margin-bottom: 6px;
    }
    input[type="checkbox"] {
      accent-color: var(--vscode-button-background);
      cursor: pointer;
      margin: 0;
      flex-shrink: 0;
    }
    input[type="checkbox"]:disabled { cursor: default; }
    select.model-select {
      width: 100%;
      box-sizing: border-box;
      padding: 3px 5px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: 0.9em;
    }
    /* Compact per-tier row: a small caption over a full-width picker. The
       effort tiers' "example workload" blurbs from Kōdo Settings are
       deliberately omitted — there is no room for them at sidebar width. */
    .tier-row { margin-bottom: 6px; }
    .tier-label {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .model-note {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
      margin-bottom: 6px;
    }
    /* Search-as-you-type combobox for the two aggregator vendors, whose
       catalogs (~400 OpenRouter models, Bedrock's whole region) are far too
       long for a <select>. Styling mirrors the Kōdo Settings webview's
       \`.model-picker*\` rules (settings-webview/styles.css). */
    .model-picker { position: relative; }
    .model-picker-input {
      width: 100%;
      box-sizing: border-box;
      padding: 3px 5px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: 0.9em;
    }
    .model-picker-input:disabled { opacity: 0.5; cursor: default; }
    /* Opens upward (\`bottom\`, not \`top\`): this lives in the bottom-anchored
       footer, so a downward dropdown would be clipped by \`body\`'s hidden
       overflow. The Kōdo Settings copy opens downward for the same reason
       reversed — it has a whole page below it. */
    .model-picker-dropdown {
      position: absolute;
      z-index: 10;
      bottom: calc(100% + 2px);
      left: 0;
      right: 0;
      max-height: 240px;
      overflow-y: auto;
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, #444));
      border-radius: 2px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    .model-picker-option {
      padding: 5px 8px;
      cursor: pointer;
      font-size: 0.88em;
    }
    .model-picker-option:hover { background: var(--vscode-list-hoverBackground); }
    .model-picker-option-id {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.92em;
      overflow-wrap: anywhere;
    }
    .model-picker-option-name {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      overflow-wrap: anywhere;
    }
    .model-picker-empty {
      padding: 6px 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.88em;
    }
    .model-picker-current {
      margin-top: 4px;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    .model-picker-current .value-code { color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <!-- Band 1: never scrolls. Everything a user must always be able to reach -
       connection status, the session buttons, the local/cloud switch - plus
       whichever mode-specific controls that mode pins (#mode-fixed): the
       llama.cpp start/stop pair in local mode, the cloud disclaimer and the
       Cloud AI settings button in cloud mode. -->
  <div id="header">
    <div class="status-row">
      <div class="status">
        <span id="conn-dot" class="conn-dot off"></span>
        <span id="conn-lbl">Status: Disconnected</span>
      </div>
    </div>
    <button id="new-btn" class="toggle-btn">+ Start new Kōdo session</button>
    <button id="open-btn" class="toggle-btn">⟳ Re-open existing Kōdo session</button>
    <button id="open-settings-btn" class="toggle-btn">⚙ Open Kōdo settings</button>

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
    <div id="mode-fixed"></div>
  </div>

  <!-- Band 2: the only scrolling region - local LLM cards, or cloud provider
       cards. However many are installed, band 1 stays put. -->
  <div id="scroll-area">
    <div id="cards-section"></div>
  </div>

  <!-- Band 3: bottom-anchored, cloud mode only - the active vendor's model
       selection. Empty (and display:none) in local mode. -->
  <div id="footer-section"></div>

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

    document.getElementById('open-settings-btn').addEventListener('click', () => {
      vsc.postMessage({ type: 'open_kodo_settings' });
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
      isMac: false,
      pinnedLocalModels: [],
      pinnedCloudVendors: [],
      localWarnings: {},
      cloudModels: {},
      cloudUniform: {},
      openRouterAutoMode: false,
      // Already narrowed to the active vendor by SidebarProvider._post —
      // never the whole catalog, and empty for the seven compiled-in vendors.
      cloudCatalogOptions: [],
      cloudHasKey: {},
    };

    // Sorts \`items\` so entries named in \`pinned\` (pin order — oldest pin
    // first) come first, followed by the rest in their original order.
    function sortByPinned(items, pinned, keyFn) {
      const pinnedSet = new Set(pinned);
      const pinnedItems = pinned
        .map(name => items.find(item => keyFn(item) === name))
        .filter(item => item !== undefined);
      const rest = items.filter(item => !pinnedSet.has(keyFn(item)));
      return pinnedItems.concat(rest);
    }

    function makePinButton(isPinned, onToggle) {
      const btn = document.createElement('span');
      btn.className = 'pin-btn' + (isPinned ? ' pinned' : '');
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.title = isPinned ? 'Unpin' : 'Pin to top';
      btn.textContent = isPinned ? '★' : '☆';
      btn.addEventListener('click', onToggle);
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      });
      return btn;
    }

    // \`warnings\` is the model's LocalLaunchWarning[] (kind/level/text) sent
    // by the extension host (see SidebarProvider._computeLocalWarnings in
    // sidebar-provider.ts) — 'red' outranks 'yellow' for the icon's color
    // when both are present. Returns null when there's nothing to show.
    function makeWarningButton(warnings) {
      if (!warnings || warnings.length === 0) { return null; }
      const level = warnings.some(w => w.level === 'red') ? 'red' : 'yellow';
      const btn = document.createElement('span');
      btn.className = 'warn-btn level-' + level;
      btn.textContent = '⚠';
      btn.title = warnings.map(w => w.text).join('\\n');
      return btn;
    }

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
        const runningEntry = _state.localRegistry.find(m => m.name === _state.llamaRunningModel);
        const runningLabel = runningEntry ? runningEntry.description : _state.llamaRunningModel;
        const ver = document.createElement('div');
        ver.style.cssText = 'font-size:0.8em;color:var(--vscode-descriptionForeground);margin-bottom:6px;';
        ver.textContent = 'llama.cpp ' + _state.llamaVersion
          + (_state.llamaRunning && _state.llamaRunningModel ? '  ·  running: ' + runningLabel : '');
        section.appendChild(ver);
      }

      // Closes the fixed band, so the scrolling card list below reads as its
      // own area rather than running straight into these controls.
      section.appendChild(document.createElement('hr'));
    }

    // Mirrors llm-registry-types.ts's llamaArgsContextSize/resolveContextSize,
    // which in turn mirror kodo's LlmProfile.get_context_size()/
    // resolve_context_window — see doc/LLM_REGISTRY.md §4.4. Can't import the
    // TS copy from this plain-JS webview script, so it's duplicated here;
    // keep both in sync by hand.
    function llamaArgsContextSize(llamaArgs) {
      const raw = llamaArgs['--ctx-size'] ?? llamaArgs['-c'];
      if (raw === undefined) {
        return 0;
      }
      const value = parseInt(String(raw).trim(), 10);
      return Number.isFinite(value) ? value : 0;
    }

    function resolveContextSize(model, llamaArgs) {
      const size = llamaArgsContextSize(llamaArgs || {});
      return size > 0 ? size : model.context_window;
    }

    // The launch args a given profile id would start llama-server with: a
    // user-defined profile's own args, or the server-computed Default profile
    // args for ''. Mirrors effectiveLlamaArgs in llm-registry-types.ts, but
    // takes the id explicitly so the Context line can be recomputed for a
    // *pending* selection before the server round trip lands.
    function profileLlamaArgs(model, profileId) {
      if (profileId) {
        const profile = (model.profiles || []).find(p => p.id === profileId);
        if (profile) { return profile.llama_args || {}; }
      }
      return model.default_profile_args || {};
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

      const ordered = sortByPinned(installed, _state.pinnedLocalModels, m => m.name);
      const pinnedCount = ordered.filter(m => _state.pinnedLocalModels.includes(m.name)).length;

      ordered.forEach((model, index) => {
        if (index === pinnedCount && pinnedCount > 0) {
          section.appendChild(document.createElement('hr')).className = 'pin-divider';
        }

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
        nameEl.textContent = model.description;
        header.appendChild(nameEl);

        const warnBtn = makeWarningButton(_state.localWarnings[model.name]);
        if (warnBtn) { header.appendChild(warnBtn); }

        const isPinned = _state.pinnedLocalModels.includes(model.name);
        header.appendChild(makePinButton(isPinned, () => {
          vsc.postMessage({ type: 'toggle_pin_local_model', name: model.name });
        }));

        card.appendChild(header);

        const quantLine = document.createElement('div');
        quantLine.className = 'card-meta-line';
        quantLine.textContent = 'Quant: ' + (model.quant_type || '—');
        card.appendChild(quantLine);

        const activeProfileId = model.active_profile || '';
        const contextLine = document.createElement('div');
        contextLine.className = 'card-meta-line';
        contextLine.textContent =
          'Context: ' + resolveContextSize(model, profileLlamaArgs(model, activeProfileId)).toLocaleString();
        card.appendChild(contextLine);

        // Launch configuration: a picker over "Default" + the entry's
        // user-defined profiles, plus a Configure button that opens the
        // Default profile's knobs in Kōdo Settings. Not offered for
        // custom_server_url — kodo doesn't launch that process, so it has no
        // launch args to configure (doc/LLM_REGISTRY.md §4.6).
        if (model.kind !== 'custom_server_url') {
          const profiles = model.profiles || [];
          const select = document.createElement('select');
          select.className = 'profile-select';
          const defaultOption = document.createElement('option');
          defaultOption.value = '';
          defaultOption.textContent = 'Profile: Default';
          select.appendChild(defaultOption);
          profiles.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = 'Profile: ' + p.name;
            select.appendChild(option);
          });
          select.value = activeProfileId;

          // Enabled only while the Default profile is selected — knobs exist
          // only on that one; a user-defined profile is edited as raw args in
          // Kōdo Settings' "Manage profiles" instead. Disabled rather than
          // hidden so the row's layout never shifts on selection.
          const configureBtn = document.createElement('button');
          configureBtn.className = 'configure-btn';
          configureBtn.textContent = '⚙';
          configureBtn.title = 'Configure';
          configureBtn.disabled = !!activeProfileId;
          configureBtn.addEventListener('click', () => {
            vsc.postMessage({ type: 'configure_local_model', name: model.name });
          });

          select.addEventListener('change', () => {
            contextLine.textContent =
              'Context: ' + resolveContextSize(model, profileLlamaArgs(model, select.value)).toLocaleString();
            configureBtn.disabled = !!select.value;
            vsc.postMessage({ type: 'set_active_profile', name: model.name, profile_id: select.value });
          });

          const profileRow = document.createElement('div');
          profileRow.className = 'profile-row';
          profileRow.appendChild(select);
          profileRow.appendChild(configureBtn);
          card.appendChild(profileRow);
        }

        section.appendChild(card);
      });
    }

    // ----------------------------------------------------------------
    // Cloud mode: vendor list + "Cloud AI settings"
    // ----------------------------------------------------------------
    // All 9 cloud vendors are live -- empty for now, kept as the landing spot
    // for whatever cloud vendor is added next.
    const DISABLED_VENDORS = [];

    // The two aggregator vendors deliberately have no cloudRegistry entry
    // (no compiled-in model tuple -- their catalogs are fetched at runtime;
    // kodo/doc/LLM_REGISTRY.md §3a/§3b), so they're never keys of
    // _state.cloudRegistry and the loop below would otherwise never render a
    // card for either. Same special-case CloudVendorSection.tsx makes for the
    // Kōdo Settings webview's vendor nav.
    const CATALOG_VENDOR_DISPLAY_NAMES = {
      openrouter: 'OpenRouter',
      bedrock: 'AWS Bedrock',
    };

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

    // The always-visible half of cloud mode: the disclaimer and the settings
    // button are pinned in the fixed band, so scrolling a long provider list
    // can never hide either.
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

      section.appendChild(document.createElement('hr'));
    }

    // The scrolling half: the provider cards themselves.
    function renderCloudVendorCards(section) {
      const heading = document.createElement('div');
      heading.className = 'provider-heading';
      heading.textContent = 'Select LLM provider';
      section.appendChild(heading);

      const vendors = sortByPinned(
        Object.keys(_state.cloudRegistry).concat(Object.keys(CATALOG_VENDOR_DISPLAY_NAMES)),
        _state.pinnedCloudVendors,
        v => v,
      );
      const pinnedVendorCount = vendors.filter(v => _state.pinnedCloudVendors.includes(v)).length;

      vendors.forEach((vendor, index) => {
        if (index === pinnedVendorCount && pinnedVendorCount > 0) {
          section.appendChild(document.createElement('hr')).className = 'pin-divider';
        }

        const displayName = CATALOG_VENDOR_DISPLAY_NAMES[vendor] || _state.cloudRegistry[vendor].display_name;
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
        nameEl.textContent = displayName;
        header.appendChild(nameEl);

        const isPinned = _state.pinnedCloudVendors.includes(vendor);
        header.appendChild(makePinButton(isPinned, () => {
          vsc.postMessage({ type: 'toggle_pin_cloud_vendor', vendor });
        }));

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

    // ----------------------------------------------------------------
    // Cloud mode: the active vendor's model selection (bottom-anchored)
    // ----------------------------------------------------------------
    // The four agent capability tiers, exactly as kodo resolves them
    // (kodo/doc/LLM_REGISTRY.md §2). Their "example workload" blurbs from the
    // Kōdo Settings tab are deliberately dropped here — sidebar width has no
    // room for them, and the tier name alone is the part users navigate by.
    const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'];
    const EFFORT_LABELS = {
      low: 'Low effort',
      medium: 'Medium effort',
      high: 'High effort',
      max: 'Max effort',
    };

    const MAX_MODEL_PICKER_RESULTS = 40;

    // Transient UI state for the search combobox below, deliberately kept
    // OUTSIDE the DOM: renderCards() rebuilds the whole footer on every state
    // push (a session's stage ticking over, llama.cpp status, a reconnect…),
    // and a half-typed query must survive one that lands mid-search. \`key\`
    // scopes it to one picker — 'openrouter|uniform', 'bedrock|high', … — so
    // switching vendors or tiers always starts clean.
    let _pickerUi = { key: '', query: '', open: false };

    // Plain <select> over a compiled-in vendor's short model list. Mirrors
    // EffortSection/UniformModelSelect in CloudVendorSection.tsx, including
    // its fallback to the first model when the stored id isn't in the list.
    function makeModelSelect(options, modelId, onSelect) {
      const select = document.createElement('select');
      select.className = 'model-select';
      options.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        select.appendChild(opt);
      });
      const known = options.some(m => m.id === modelId);
      select.value = known ? modelId : (options.length ? options[0].id : '');
      select.addEventListener('change', () => { onSelect(select.value); });
      return select;
    }

    // Search-as-you-type combobox over a fetched catalog — the sidebar twin of
    // CatalogModelPicker in CloudVendorSection.tsx, for the two aggregator
    // vendors whose catalogs (~400 OpenRouter models, Bedrock's whole region)
    // are pushed whole and filtered client-side. A several-hundred-option
    // <select> is unusable at any width, let alone this one.
    function makeCatalogPicker(key, modelId, options, placeholderNoun, hasKey, onSelect) {
      const wrap = document.createElement('div');
      wrap.className = 'model-picker';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'model-picker-input';
      // Read back by renderCards() to restore focus across a re-render.
      input.dataset.pickerKey = key;
      input.placeholder = options.length
        ? 'Search ' + options.length + ' ' + placeholderNoun + '…'
        // Without a key the catalog can never populate, so don't pretend it
        // is still loading.
        : (hasKey ? 'Loading model list…' : 'API key is required to load model list');
      input.value = _pickerUi.key === key ? _pickerUi.query : '';

      const dropdown = document.createElement('div');
      dropdown.className = 'model-picker-dropdown';

      const current = document.createElement('div');
      current.className = 'model-picker-current';
      if (modelId) {
        current.appendChild(document.createTextNode('Currently: '));
        const code = document.createElement('span');
        code.className = 'value-code';
        code.textContent = modelId;
        current.appendChild(code);
        const match = options.find(m => m.id === modelId);
        if (match && match.name !== modelId) {
          current.appendChild(document.createTextNode(' — ' + match.name));
        }
      }

      function refresh() {
        const open = _pickerUi.key === key && _pickerUi.open;
        dropdown.style.display = open ? '' : 'none';
        current.style.display = open || !modelId ? 'none' : '';
        if (!open) { return; }
        const q = (_pickerUi.query || '').trim().toLowerCase();
        const matches = (q
          ? options.filter(m =>
              m.id.toLowerCase().includes(q)
              || m.name.toLowerCase().includes(q)
              || (m.hint || '').toLowerCase().includes(q))
          : options
        ).slice(0, MAX_MODEL_PICKER_RESULTS);

        dropdown.innerHTML = '';
        if (matches.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'model-picker-empty';
          empty.textContent = 'No matching models.';
          dropdown.appendChild(empty);
          return;
        }
        matches.forEach(m => {
          const row = document.createElement('div');
          row.className = 'model-picker-option';

          const idEl = document.createElement('div');
          idEl.className = 'model-picker-option-id';
          idEl.textContent = m.id;
          row.appendChild(idEl);

          const nameEl = document.createElement('div');
          nameEl.className = 'model-picker-option-name';
          nameEl.textContent = m.hint ? m.hint + ' — ' + m.name : m.name;
          row.appendChild(nameEl);

          // mousedown, not click: the input's blur would otherwise close the
          // dropdown before a click ever landed on the row.
          row.addEventListener('mousedown', e => {
            e.preventDefault();
            _pickerUi = { key: '', query: '', open: false };
            onSelect(m.id);
          });
          dropdown.appendChild(row);
        });
      }

      input.addEventListener('input', () => {
        _pickerUi = { key, query: input.value, open: true };
        refresh();
      });
      input.addEventListener('focus', () => {
        _pickerUi = { key, query: input.value, open: true };
        refresh();
      });
      input.addEventListener('blur', () => {
        // Deferred so a pick (mousedown above) is committed first.
        window.setTimeout(() => {
          if (_pickerUi.key === key) { _pickerUi.open = false; }
          refresh();
        }, 150);
      });

      wrap.appendChild(input);
      wrap.appendChild(dropdown);
      wrap.appendChild(current);
      refresh();
      return wrap;
    }

    // "Use the same LLM for all agents" (kodo/doc/LLM_REGISTRY.md §3c) plus
    // either its single picker or the four per-tier ones — the sidebar
    // equivalent of the Kōdo Settings Cloud AI tab's UniformModelSection +
    // EffortSection stack, writing the same \`models.cloud_uniform\` /
    // \`models.cloud\` settings through the same host-side setters. Rendered
    // into the bottom-anchored band so it stays reachable no matter how far
    // the provider list above is scrolled.
    function renderCloudModelSection(footer) {
      const vendor = _state.activeCloudVendor;
      if (!vendor) { return; }
      // The aggregators have no compiled-in registry entry, so their models
      // come from the fetched catalog instead; a vendor that is in neither is
      // a not-yet-supported one with nothing to pick.
      const isCatalogVendor = Boolean(CATALOG_VENDOR_DISPLAY_NAMES[vendor]);
      const info = _state.cloudRegistry[vendor];
      if (!isCatalogVendor && !info) { return; }

      footer.appendChild(document.createElement('hr'));

      const heading = document.createElement('div');
      heading.className = 'provider-heading';
      heading.textContent = 'Select LLM model';
      footer.appendChild(heading);

      const uniform = _state.cloudUniform[vendor] || { enabled: false, modelId: null };
      // OpenRouter's Auto mode hands model choice to OpenRouter's own router
      // for every tier, so nothing here is editable while it is on — the same
      // mutual exclusion OpenRouterVendorPanel enforces in Kōdo Settings
      // (kodo/doc/LLM_REGISTRY.md §3a/§3c).
      const autoMode = vendor === 'openrouter' && _state.openRouterAutoMode;

      const label = document.createElement('label');
      label.className = 'checkbox-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = uniform.enabled;
      box.disabled = autoMode;
      box.addEventListener('change', () => {
        vsc.postMessage({ type: 'set_cloud_uniform_enabled', vendor, enabled: box.checked });
      });
      label.appendChild(box);
      label.appendChild(document.createTextNode('Use the same LLM for all agents'));
      footer.appendChild(label);

      if (autoMode) {
        const note = document.createElement('div');
        note.className = 'model-note';
        note.textContent =
          'OpenRouter Auto mode is picking a model for every request. '
          + 'Turn it off in Cloud AI settings to choose models here.';
        footer.appendChild(note);
        return;
      }

      const options = isCatalogVendor
        ? _state.cloudCatalogOptions
        : (info.models || []).map(m => ({ id: m.model_id, name: m.name }));
      const placeholderNoun = vendor === 'bedrock' ? 'models and inference profiles' : 'models';
      const hasKey = Boolean(_state.cloudHasKey[vendor]);
      const perTier = _state.cloudModels[vendor] || {};

      function makePicker(slot, modelId, onSelect) {
        return isCatalogVendor
          ? makeCatalogPicker(vendor + '|' + slot, modelId || '', options, placeholderNoun, hasKey, onSelect)
          : makeModelSelect(options, modelId || '', onSelect);
      }

      if (uniform.enabled) {
        footer.appendChild(makePicker('uniform', uniform.modelId, model_id => {
          vsc.postMessage({ type: 'set_cloud_uniform_model', vendor, model_id });
        }));
        return;
      }

      EFFORT_LEVELS.forEach(effort => {
        const row = document.createElement('div');
        row.className = 'tier-row';

        const tierLabel = document.createElement('div');
        tierLabel.className = 'tier-label';
        tierLabel.textContent = EFFORT_LABELS[effort];
        row.appendChild(tierLabel);

        row.appendChild(makePicker(effort, perTier[effort], model_id => {
          vsc.postMessage({ type: 'set_cloud_model', vendor, effort, model_id });
        }));
        footer.appendChild(row);
      });
    }

    function renderCards() {
      const fixed = document.getElementById('mode-fixed');
      const scrollArea = document.getElementById('scroll-area');
      const section = document.getElementById('cards-section');
      const footer = document.getElementById('footer-section');

      // Every state push rebuilds all three bands, so anything the user was
      // in the middle of has to be carried across by hand: how far they had
      // scrolled the card list, and which model search box they were typing
      // in (its text lives in _pickerUi). Without this, an unrelated update —
      // a session's stage changing, say — would yank the list back to the top
      // mid-scroll.
      const scrollTop = scrollArea.scrollTop;
      const active = document.activeElement;
      const focusedPicker = active && active.dataset ? (active.dataset.pickerKey || '') : '';

      fixed.innerHTML = '';
      section.innerHTML = '';
      footer.innerHTML = '';

      if (_state.mode === 'local') {
        renderLlamaControls(fixed);
        renderLocalCards(section);
      } else {
        renderCloudControls(fixed);
        renderCloudVendorCards(section);
        renderCloudModelSection(footer);
      }

      scrollArea.scrollTop = scrollTop;
      if (focusedPicker) {
        const input = footer.querySelector('[data-picker-key="' + focusedPicker + '"]');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    }

    // ----------------------------------------------------------------
    // Message handler
    // ----------------------------------------------------------------
    window.addEventListener('message', ({ data }) => {
      if (data.type !== 'update') { return; }

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
      if (data.isMac !== undefined) { _state.isMac = Boolean(data.isMac); }
      if (Array.isArray(data.pinnedLocalModels)) { _state.pinnedLocalModels = data.pinnedLocalModels; }
      if (Array.isArray(data.pinnedCloudVendors)) { _state.pinnedCloudVendors = data.pinnedCloudVendors; }
      if (data.localWarnings && typeof data.localWarnings === 'object') { _state.localWarnings = data.localWarnings; }
      if (data.cloudModels && typeof data.cloudModels === 'object') { _state.cloudModels = data.cloudModels; }
      if (data.cloudUniform && typeof data.cloudUniform === 'object') { _state.cloudUniform = data.cloudUniform; }
      if (data.openRouterAutoMode !== undefined) { _state.openRouterAutoMode = Boolean(data.openRouterAutoMode); }
      if (Array.isArray(data.cloudCatalogOptions)) { _state.cloudCatalogOptions = data.cloudCatalogOptions; }
      if (data.cloudHasKey && typeof data.cloudHasKey === 'object') { _state.cloudHasKey = data.cloudHasKey; }

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
