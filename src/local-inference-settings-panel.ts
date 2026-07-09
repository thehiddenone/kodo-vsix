import * as vscode from 'vscode';
import type { LocalDownloadState, LocalRegistryEntry } from './llm-registry-types';

export interface LocalInferenceSettingsState {
  localRegistry: LocalRegistryEntry[];
  llamaServerOverridePath: string | null;
  detectedVramGb: number | null;
  /** Live download progress, polled off disk — see local-model-downloads.ts. */
  downloads: LocalDownloadState[];
  /** Picks gpu_tip vs mac_tip and the "Show me local files" label. */
  isMac: boolean;
}

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

export type LocalInferenceSettingsMessage =
  | { type: 'ready' }
  | ({ type: 'add_huggingface' } & AddHuggingfaceLlmPayload)
  | ({ type: 'add_file' } & AddFileLlmPayload)
  | ({ type: 'add_server_url' } & AddServerUrlLlmPayload)
  | { type: 'pick_gguf_file' }
  | { type: 'install'; name: string }
  | { type: 'pause'; name: string }
  | { type: 'resume'; name: string }
  | { type: 'cancel'; name: string }
  | { type: 'uninstall'; name: string }
  | { type: 'remove'; name: string }
  | { type: 'reveal'; name: string }
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
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #content {
      margin-left: 100px;
      padding: 20px 24px 40px 0;
      max-width: 640px;
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
    .action-btn { height: 35px; }
    h2 { font-size: 1.1em; margin: 0 0 8px; }
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
    .cell-desc {
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
      margin-bottom: 10px;
    }
    .llm-cell { margin-bottom: 20px; }
    .llm-cell button { margin-bottom: 8px; }
    #empty-msg { color: var(--vscode-descriptionForeground); padding: 8px 0; }

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
    .secondary-btn {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }
    .secondary-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
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
      background: var(--vscode-progressBar-background, #333);
      opacity: 0.35;
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
    .installed-tag {
      display: inline-block;
      font-size: 0.78em;
      color: #4caf50;
      border: 1px solid #4caf50;
      border-radius: 10px;
      padding: 1px 8px;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <div id="content">
    <section class="group">
      <h2>llama-server binary override</h2>
      <p class="explain">
        You can build and manage your own installation of llama.cpp instead of using the
        bundled binary — this can be especially useful on Linux, where you may want to build
        a custom llama.cpp with CUDA support.
      </p>
      <div id="override-path"></div>
      <div class="spacer"></div>
      <p class="explain">Point Kōdo at a llama-server binary from your own llama.cpp build.</p>
      <button id="set-override" class="action-btn">Set llama.cpp override</button>
      <div class="spacer"></div>
      <p class="explain">Clear the override and go back to the bundled llama.cpp binary.</p>
      <button id="remove-override" class="action-btn">Remove llama.cpp override</button>
      <hr class="divider">
    </section>

    <section class="group">
      <p class="explain">Download a GGUF model from huggingface.com and add it to your local registry.</p>
      <button id="add-hf" class="action-btn">Add local LLM (GGUF) from huggingface.com</button>
      <div class="spacer"></div>
      <p class="explain">Add a GGUF file you already have on disk.</p>
      <button id="add-file" class="action-btn">Add local LLM (GGUF) from file</button>
      <div class="spacer"></div>
      <p class="explain">
        Point Kōdo at a llama-server (or OpenAI-compatible) instance you host yourself —
        on this machine or anywhere else on your network.
      </p>
      <button id="add-server" class="action-btn">Add a link to self-hosted llama-server</button>
      <hr class="divider">
    </section>

    <section class="group" id="downloads-section"></section>

    <section class="group" id="cards"></section>
  </div>

  <div class="modal-overlay" id="hf-modal">
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

  <div class="modal-overlay" id="file-modal">
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

  <div class="modal-overlay" id="server-modal">
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

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();
    vsc.postMessage({ type: 'ready' });

    const DEFAULT_CONTEXT_WINDOW = 262144;
    const HF_REPO_RE = /^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/;

    let _state = {
      localRegistry: [],
      llamaServerOverridePath: null,
      downloads: [],
      detectedVramGb: null,
      isMac: false,
    };

    document.getElementById('add-hf').addEventListener('click', openHfModal);
    document.getElementById('add-file').addEventListener('click', openFileModal);
    document.getElementById('add-server').addEventListener('click', openServerModal);
    document.getElementById('set-override').addEventListener('click', () => vsc.postMessage({ type: 'set_override' }));
    document.getElementById('remove-override').addEventListener('click', () => {
      if (!_state.llamaServerOverridePath) { return; }
      vsc.postMessage({ type: 'remove_override' });
    });

    function parseLlamaArgs(text) {
      const tokens = text.trim().split(/\\s+/).filter(Boolean);
      const result = {};
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        result[tokens[i]] = tokens[i + 1];
      }
      return result;
    }

    function parseContextWindow(text) {
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
        context_window: parseContextWindow(hfContextWindow.value),
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
        context_window: parseContextWindow(fileContextWindow.value),
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

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') { return; }
      if (hfModal.classList.contains('open')) { closeHfModal(); }
      if (fileModal.classList.contains('open')) { closeFileModal(); }
      if (serverModal.classList.contains('open')) { closeServerModal(); }
    });

    const DOWNLOADABLE = new Set(['hardcoded_hf', 'custom_hf']);
    const CUSTOM = new Set(['custom_hf', 'custom_file', 'custom_server_url']);
    const _expandedGroups = new Set();

    function formatBytes(n) {
      if (n == null) { return ''; }
      const mb = n / (1024 * 1024);
      return mb < 1024 ? Math.round(mb) + ' MB' : (mb / 1024).toFixed(2) + ' GB';
    }

    // Rules (per product spec): red if below the absolute minimum; yellow if
    // below the recommended amount. When min_memory === memory, the red check
    // already covers every case the yellow check would (vram >= min == memory
    // implies vram >= memory), so only red can ever fire — no special-casing
    // needed. A 0 value means "unknown — don't warn" for that threshold.
    function ramWarning(entry, vram) {
      if (vram == null) { return null; }
      const min = entry.min_memory || 0;
      const rec = entry.memory || 0;
      if (min > 0 && vram < min) {
        return {
          level: 'red',
          text: '⛔ This LLM will likely not run on this machine — it needs at least ' +
            min + ' GB, but only ' + vram + ' GB was detected.',
        };
      }
      if (rec > 0 && vram < rec) {
        return {
          level: 'yellow',
          text: '⚠️ This LLM may not perform well with large contexts on this machine — ' +
            rec + ' GB is recommended, but only ' + vram + ' GB was detected.',
        };
      }
      return null;
    }

    function renderDownloads() {
      const section = document.getElementById('downloads-section');
      section.innerHTML = '';
      const downloads = _state.downloads || [];
      if (downloads.length === 0) { return; } // nothing downloading — show nothing at all

      section.appendChild(document.createElement('hr')).className = 'divider';
      downloads.forEach(dl => {
        const row = document.createElement('div');
        row.className = 'download-row';

        const name = document.createElement('div');
        name.className = 'download-name';
        name.textContent = dl.name;
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
        label.textContent = dl.bytes_total
          ? (formatBytes(dl.bytes_downloaded) + ' / ' + formatBytes(dl.bytes_total))
          : (formatBytes(dl.bytes_downloaded) + ' downloaded');
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
          pauseBtn.addEventListener('click', () => vsc.postMessage({ type: 'pause', name: dl.name }));
          buttons.appendChild(pauseBtn);
        } else {
          const resumeBtn = document.createElement('button');
          resumeBtn.textContent = 'Resume';
          resumeBtn.addEventListener('click', () => vsc.postMessage({ type: 'resume', name: dl.name }));
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
    }

    function renderModelCard(entry, downloadingNames) {
      const card = document.createElement('div');
      card.className = 'model-card';

      const name = document.createElement('div');
      name.className = 'cell-name';
      name.textContent = entry.name;
      card.appendChild(name);

      if (entry.description) {
        const desc = document.createElement('div');
        desc.className = 'cell-desc';
        desc.textContent = entry.description;
        card.appendChild(desc);
      }

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

      const warning = ramWarning(entry, _state.detectedVramGb);
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

      const buttons = document.createElement('div');
      buttons.className = 'row-buttons';

      if (DOWNLOADABLE.has(entry.kind) && !entry.installed) {
        if (downloadingNames.has(entry.name)) {
          const note = document.createElement('span');
          note.className = 'download-repo';
          note.textContent = 'Downloading — see progress above.';
          buttons.appendChild(note);
        } else {
          const installBtn = document.createElement('button');
          installBtn.textContent = 'Download and Install';
          installBtn.addEventListener('click', () => vsc.postMessage({ type: 'install', name: entry.name }));
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
      const cards = document.getElementById('cards');
      cards.innerHTML = '';

      if (_state.localRegistry.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'empty-msg';
        msg.textContent = 'No local LLMs yet — add one above.';
        cards.appendChild(msg);
        return;
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
          renderCards();
        });
        group.appendChild(header);

        const body = document.createElement('div');
        body.className = 'group-body' + (expanded ? ' expanded' : '');
        entries.forEach(entry => body.appendChild(renderModelCard(entry, downloadingNames)));
        group.appendChild(body);

        cards.appendChild(group);
      });
    }

    function render() {
      const overrideEl = document.getElementById('override-path');
      overrideEl.textContent = _state.llamaServerOverridePath
        ? _state.llamaServerOverridePath
        : 'No override — using the bundled llama.cpp binary.';
      document.getElementById('remove-override').disabled = !_state.llamaServerOverridePath;

      renderDownloads();
      renderCards();
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
      if (data.type !== 'update') { return; }
      _state.localRegistry = data.localRegistry || _state.localRegistry;
      _state.llamaServerOverridePath = data.llamaServerOverridePath !== undefined
        ? data.llamaServerOverridePath : _state.llamaServerOverridePath;
      _state.downloads = data.downloads || [];
      _state.detectedVramGb = data.detectedVramGb !== undefined ? data.detectedVramGb : _state.detectedVramGb;
      _state.isMac = Boolean(data.isMac);
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
