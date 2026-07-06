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
  | { type: 'add_key'; vendor: string }
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
      padding: 16px 20px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    h2 { font-size: 1.15em; margin: 0 0 10px; }
    .vendor-layer {
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      padding: 14px 0;
    }
    .vendor-layer:first-child { padding-top: 0; }
    .effort-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 14px;
    }
    .effort-panel {
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #444));
      border-radius: 4px;
      padding: 8px 10px;
    }
    .effort-title { font-weight: 600; margin-bottom: 6px; font-size: 0.92em; }
    .effort-option {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      cursor: pointer;
      user-select: none;
      font-size: 0.9em;
    }
    input[type="radio"] {
      accent-color: var(--vscode-button-background);
      cursor: pointer;
      margin: 0;
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
  </style>
</head>
<body>
  <div id="vendors"></div>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();
    vsc.postMessage({ type: 'ready' });

    const EFFORT_LEVELS = ${effortLevelsJson};
    const EFFORT_LABELS = ${effortLabelsJson};

    let _state = { cloudRegistry: {}, modelsByVendor: {}, keysByVendor: {} };

    function renderVendor(vendor, info) {
      const layer = document.createElement('div');
      layer.className = 'vendor-layer';

      const heading = document.createElement('h2');
      heading.textContent = info.display_name;
      layer.appendChild(heading);

      // 2x2 effort grid
      const grid = document.createElement('div');
      grid.className = 'effort-grid';
      const vendorModels = _state.modelsByVendor[vendor] || {};

      EFFORT_LEVELS.forEach(effort => {
        const panel = document.createElement('div');
        panel.className = 'effort-panel';

        const title = document.createElement('div');
        title.className = 'effort-title';
        title.textContent = EFFORT_LABELS[effort];
        panel.appendChild(title);

        info.models.forEach(model => {
          const label = document.createElement('label');
          label.className = 'effort-option';

          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = vendor + '-' + effort;
          radio.value = model.model_id;
          radio.checked = vendorModels[effort] === model.model_id;
          radio.addEventListener('change', () => {
            if (radio.checked) {
              vsc.postMessage({ type: 'set_cloud_model', vendor, effort, model_id: model.model_id });
            }
          });
          label.appendChild(radio);

          const span = document.createElement('span');
          span.textContent = model.name;
          label.appendChild(span);

          panel.appendChild(label);
        });

        grid.appendChild(panel);
      });
      layer.appendChild(grid);

      // API keys
      const addBtn = document.createElement('button');
      addBtn.id = 'add-key-btn';
      addBtn.textContent = 'Add new API access key';
      addBtn.addEventListener('click', () => vsc.postMessage({ type: 'add_key', vendor }));
      layer.appendChild(addBtn);

      const keys = _state.keysByVendor[vendor] || [];
      if (keys.length === 0) {
        const msg = document.createElement('div');
        msg.id = 'no-keys-msg';
        msg.textContent = 'No API keys configured for ' + info.display_name + ' yet.';
        layer.appendChild(msg);
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

          layer.appendChild(row);
        });
      }

      return layer;
    }

    function render() {
      const container = document.getElementById('vendors');
      container.innerHTML = '';
      Object.entries(_state.cloudRegistry).forEach(([vendor, info]) => {
        container.appendChild(renderVendor(vendor, info));
      });
    }

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
