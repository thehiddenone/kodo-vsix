/**
 * Kōdo VS Code extension — multi-session entry point.
 *
 * One VS Code window hosts MANY Kōdo sessions, each shown as a native editor
 * tab (a WebView panel) backed by its own WebSocket connection — see
 * {@link SessionController}. Lifecycle:
 *   1. Activation: discover/launch the singleton server, then open a session-
 *      less *control* WebSocket for window-global concerns (llama/model
 *      management, the cloud/local radio, the session picker). The sidebar is a
 *      view onto this control state.
 *   2. "Start new Kōdo session" / "Open Kōdo Panel": create a session tab. Each
 *      tab connects independently and is routed by its own session_id.
 *   3. Sticky tabs: a registerWebviewPanelSerializer restores open tabs on
 *      window reload / workspace reopen and resumes each from disk. Closed tabs
 *      are not restored (they are released and free for any window).
 *   4. Deactivation: disconnect every connection (the shared singleton server
 *      self-reaps once the last window leaves; we never kill it).
 *
 * The window-global logic this file used to hold directly now lives under
 * `src/extension/*.ts`, grouped by concern (server lifecycle, session tab
 * bookkeeping, control-channel send/receive, settings I/O, llama.cpp,
 * local/cloud model registries, the Kōdo Settings panel bridge, …) — this
 * file is left with activation wiring only. See `src/extension/state.ts` for
 * the shared window-global mutable state every one of those modules reads
 * and writes through.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest } from './envelope';
import type { Envelope } from './envelope';
import { FileReviewContentProvider, KODO_REVIEW_SCHEME } from './file-review-provider';
import { startLocalDownloadPolling } from './local-model-downloads';
import { SidebarProvider } from './sidebar-provider';
import { DEFAULT_PORT, ServerLauncher, readServerDiscovery } from './server-launcher';
import { WsClient } from './ws-client';

import { setActiveCloudVendor } from './extension/cloud-ai-settings';
import { handleControlEnvelope } from './extension/control-channel';
import { sendControl, sendControlHello } from './extension/control-send';
import { createProject } from './extension/create-project';
import { openCloudAiSettings, openKodoSettings, openLocalInferenceSettings } from './extension/kodo-settings-bridge';
import { installLlamaCpp, startLlamaCpp } from './extension/llamacpp';
import { pushLocalInferenceState, setActiveFlavor, setActiveLocalModel } from './extension/local-llm-registry';
import { beginServerStartupProgress, endServerStartupProgress, handleServerStartFailure, launchKodoServer, showTransientNotification } from './extension/server-lifecycle';
import {
  readActiveCloudVendor,
  readActiveLocalModel,
  readMode,
  readUiSettings,
  setMode,
  togglePinnedCloudVendor,
  togglePinnedLocalModel,
} from './extension/settings-io';
import { pickSession } from './extension/session-resume';
import { state } from './extension/state';
import { adoptPanel, consumeSerializerDead, newSession, openPanel } from './extension/window-sessions';
import { stableWindowId } from './extension/window-id';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  state.extensionContext = context;
  state.projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  state.physicalRoot = state.projectRoot ? path.dirname(state.projectRoot) : '';
  state.hasWorkspace = state.projectRoot.length > 0;

  state.windowId = stableWindowId(context);
  consumeSerializerDead();

  // Window-global, independent of the WS connection/session model — polls
  // manager-state.json directly off disk (see local-model-downloads.ts) so a
  // download started before this window opened, or left running after a
  // previous window closed, shows up correctly as soon as this one starts.
  //
  // Every open window runs this same poller independently, which is also
  // what makes it the right place to notice a download *finishing*: the
  // server's local_llm.registry_state push on completion (_run_background_
  // download in kodo/server/_app.py) is fire-and-forget to the one
  // connection that kicked the download off, and silently no-ops forever if
  // that connection reconnects at any point during a multi-minute transfer
  // (sleep, idle timeout, network blip) — and it never reaches any *other*
  // window's connection at all. Re-sending `hello` here re-syncs
  // localRegistryState (installed/installed_path) — and both the sidebar and
  // the settings panel with it — from every window, the moment each one's
  // own poll notices the model file disappear from the "in progress" set.
  const downloadPolling = startLocalDownloadPolling((states) => {
    const previouslyTracked = new Set(state.localDownloadsState.map((d) => d.name));
    state.localDownloadsState = Array.from(states.values());
    const stillTracked = new Set(state.localDownloadsState.map((d) => d.name));
    const noLongerTracked = [...previouslyTracked].some((name) => !stillTracked.has(name));
    if (noLongerTracked) {
      sendControlHello();
    }
    pushLocalInferenceState();
  });
  context.subscriptions.push({ dispose: () => downloadPolling.dispose() });

  {
    const port = readServerDiscovery()?.port ?? DEFAULT_PORT;
    state.wsUrl = `ws://127.0.0.1:${port}/ws`;

    state.launcher = new ServerLauncher();
    state.controlClient = new WsClient(
      state.wsUrl,
      (env: Envelope) => handleControlEnvelope(env),
      (connected: boolean) => {
        state.controlConnected = connected;
        state.sidebarProvider?.update({ connected });
        if (connected) {
          sendControlHello();
          if (!state.serverStartupConnected) {
            state.serverStartupConnected = true;
            endServerStartupProgress();
            showTransientNotification('Kōdo: server is connected.');
          }
        }
      },
      () => handleServerStartFailure(port, 'the server did not respond'),
    );

    beginServerStartupProgress();
    launchKodoServer(port);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      state.hasWorkspace = newRoot.length > 0;
      if (newRoot) {
        state.projectRoot = newRoot;
        state.physicalRoot = path.dirname(newRoot);
      }
      state.sidebarProvider?.update({ hasWorkspace: state.hasWorkspace });
      for (const s of state.sessions.values()) {
        s.postWorkspaceStatus(state.hasWorkspace);
        s.pushWorkspaceFolders();
      }
    }),
  );

  state.modeState = readMode();
  state.activeCloudVendorState = readActiveCloudVendor();
  state.activeLocalModelState = readActiveLocalModel();
  const initialUiSettings = readUiSettings();

  state.sidebarProvider = new SidebarProvider(
    {
      connected: state.controlConnected,
      hasWorkspace: state.hasWorkspace,
      stage: 'IDLE',
      mode: state.modeState,
      cloudRegistry: state.cloudRegistryState,
      activeCloudVendor: state.activeCloudVendorState,
      localRegistry: state.localRegistryState,
      activeLocalModel: state.activeLocalModelState,
      effectiveLocalModel: state.effectiveLocalModelState,
      llamaInstalled: state.llamaInstalledState,
      llamaVersion: state.llamaVersionState,
      llamaInstalling: state.llamaInstallingState,
      llamaRunning: state.llamaRunningState,
      llamaRunningModel: state.llamaRunningModelState,
      llamaStarting: state.llamaStartingState,
      llamaStopping: state.llamaStoppingState,
      detectedVramGb: state.detectedVramGbState,
      detectedRamGb: state.detectedRamGbState,
      pinnedLocalModels: initialUiSettings.pinnedLocalModels,
      pinnedCloudVendors: initialUiSettings.pinnedCloudVendors,
    },
    (msg) => {
      if (msg.type === 'list_sessions') {
        void pickSession();
      } else if (msg.type === 'new_session') {
        newSession();
      } else if (msg.type === 'set_mode') {
        setMode(msg.mode);
      } else if (msg.type === 'set_active_model') {
        setActiveLocalModel(msg.name);
      } else if (msg.type === 'set_active_flavor') {
        void setActiveFlavor(msg.name, msg.flavor_id);
      } else if (msg.type === 'set_cloud_vendor') {
        setActiveCloudVendor(msg.vendor);
      } else if (msg.type === 'toggle_pin_local_model') {
        const { pinnedLocalModels } = togglePinnedLocalModel(msg.name);
        state.sidebarProvider?.update({ pinnedLocalModels });
      } else if (msg.type === 'toggle_pin_cloud_vendor') {
        const { pinnedCloudVendors } = togglePinnedCloudVendor(msg.vendor);
        state.sidebarProvider?.update({ pinnedCloudVendors });
      } else if (msg.type === 'open_local_inference_settings') {
        openLocalInferenceSettings();
      } else if (msg.type === 'open_cloud_ai_settings') {
        openCloudAiSettings();
      } else if (msg.type === 'open_kodo_settings') {
        void openKodoSettings();
      } else if (msg.type === 'start_llamacpp') {
        void startLlamaCpp(() => void openKodoSettings('local-inference'));
      } else if (msg.type === 'stop_llamacpp') {
        state.llamaStoppingState = true;
        state.sidebarProvider?.update({ llamaStopping: true });
        sendControl(makeRequest('llama.stop'));
      } else if (msg.type === 'install_llamacpp') {
        installLlamaCpp();
      }
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('kodo.view', state.sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewPanelSerializer('kodoPanel', {
      // Sticky tabs: VS Code persists every open panel and restores it on
      // reload / workspace reopen. The webview stashed its session_id via
      // setState; we adopt the restored panel and resume that exact session.
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, panelState: unknown): Promise<void> {
        const sid = panelState && typeof panelState === 'object' ? String((panelState as Record<string, unknown>).sessionId ?? '') : '';
        adoptPanel(panel, sid);
      },
    }),
    vscode.commands.registerCommand('kodo.openPanel', () => openPanel()),
    // Optional `selectSection` arg lets programmatic callers (e.g. the
    // prompt-send local-launch gate in window-sessions.ts, which can't import
    // kodo-settings-bridge.ts directly without a circular import) jump
    // straight to a tab; the Command Palette invocation passes none.
    vscode.commands.registerCommand('kodo.openSettings', (selectSection?: string) => void openKodoSettings(selectSection)),
    vscode.commands.registerCommand('kodo.newSession', () => newSession()),
    vscode.commands.registerCommand('kodo.createProject', () => createProject()),
    vscode.commands.registerCommand('kodo.useCloudLLMs', () => setMode('cloud')),
    vscode.commands.registerCommand('kodo.useLocalLLM', () => setMode('local')),
    vscode.commands.registerCommand('kodo.pickSession', () => pickSession()),
  );

  // Edit Control review gate (WS_PROTOCOL.md §6.5b) — the read-only content
  // provider backing every session's companion tab, plus the window-wide
  // listeners fanned out to every open session (each SessionController only
  // reacts when the event matches its own pending review). Mirrors the
  // linear-scan idiom `findBySessionId`/`findActiveSession` already use —
  // session counts per window are small, so no dedicated registry is needed.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      KODO_REVIEW_SCHEME,
      new FileReviewContentProvider(),
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      for (const s of state.sessions.values()) {
        s.handleActiveSelectionChanged(editor);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      for (const s of state.sessions.values()) {
        s.handleActiveSelectionChanged(e.textEditor);
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const s of state.sessions.values()) {
        s.handleTabsChanged(e.closed);
      }
    }),
    vscode.commands.registerCommand('kodo.addFeedback', () => {
      for (const s of state.sessions.values()) {
        if (s.tryAddFeedbackFromActiveSelection()) {
          break;
        }
      }
    }),
  );
}

export function deactivate(): void {
  // Window reload / close: disconnect everything WITHOUT releasing sessions —
  // the serializer restores open tabs and the disconnect grace lets this window
  // reclaim+resume them. The shared singleton self-reaps once all windows leave.
  state.deactivating = true;
  for (const s of state.sessions.values()) {
    s.dispose();
  }
  state.sessions.clear();
  state.controlClient?.dispose();
  state.controlClient = null;
  state.launcher = null;
  state.sidebarProvider = null;
}
