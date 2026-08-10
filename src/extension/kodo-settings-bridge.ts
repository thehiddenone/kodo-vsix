/**
 * Everything that opens the Kōdo Settings panel and answers the messages it
 * sends back — the fetch-then-createOrShow sequence, the sidebar's two
 * "jump to a specific tab" entry points, and the full `KodoSettingsMessage`
 * dispatch (rules, stuck-detection, llama.cpp, sessions, HF tokens, cloud
 * keys/models, and the former "Local Inference" panel's message set).
 */

import * as vscode from 'vscode';
import * as cloudCredentials from '../cloud-credentials';
import { makeRequest } from '../envelope';
import * as hfTokens from '../hf-tokens';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { KodoSettingsMessage, SessionListEntry } from '../settings-panel/types';
import { cloudAiStateForPanel, pushCloudAiSettingsState, setCloudModel } from './cloud-ai-settings';
import { sendControl, sendControlAwait } from './control-send';
import {
  fetchLlamaCppVersionInfo,
  installLlamaCpp,
  promptInstallLlamaCppVersion,
  uninstallLlamaCpp,
  updateLlamaCppToLatest,
} from './llamacpp';
import {
  pickGgufFile,
  pushLocalInferenceState,
  revealLocalLlmFiles,
  sendCheckLocalLlmUpdates,
  setActiveProfile,
  setKnobs,
  setLlamaServerOverride,
} from './local-llm-registry';
import { currentWorkspaceShapeForList, parseRememberedWorkspace, resumeSessionIntoWorkspace } from './session-resume';
import { fetchGlobalRules, parseRuleEntries } from './security-rules';
import { broadcastUiSettings, readUiSettings, writeUiSettings } from './settings-io';
import { state } from './state';
import { fetchStuckDetection, parseStuckDetection } from './stuck-detection';
import { fetchHousekeeperLlm } from './housekeeper-llm';
import { findBySessionId, openExistingSession } from './window-sessions';

/** The sidebar's "Local inference settings" button — opens (or reveals) the
 * Kōdo Settings panel with its "Local Inference" tab forced selected (the
 * standalone "Local Inference Settings" panel this used to open directly was
 * folded into that panel as a tab). */
export function openLocalInferenceSettings(): void {
  void openKodoSettings('local-inference');
  // Fire-and-forget — the reply (local_llm.updates_available) lands later
  // and re-pushes state on its own (onLocalLlmUpdatesAvailable).
  sendCheckLocalLlmUpdates();
}

/** The sidebar's "Cloud AI settings" button — opens (or reveals) the Kōdo
 * Settings panel with the currently active cloud vendor's tab forced
 * selected (the standalone "Cloud AI Settings" panel this used to open
 * directly was folded into that panel, one tab per vendor). */
export function openCloudAiSettings(): void {
  void openKodoSettings(state.activeCloudVendorState);
}

/** Fetch `session.list` and shape it for the Kōdo Settings panel's
 * "Sessions" list — the same data `pickSession()` parses (reusing
 * `parseRememberedWorkspace`), so opening the panel needs only this one
 * `session.list` round-trip. Returns `[]` (and shows a toast) if the server
 * is unreachable. */
async function fetchSessionsForPanel(): Promise<SessionListEntry[]> {
  try {
    const resp = await sendControlAwait('session.list', currentWorkspaceShapeForList());
    const list = Array.isArray(resp.sessions) ? (resp.sessions as Record<string, unknown>[]) : [];
    return list.map((s) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? s.id ?? ''),
      workflowMode: typeof s.workflow_mode === 'string' ? s.workflow_mode : null,
      taken: Boolean(s.taken),
      workspace: parseRememberedWorkspace(s.workspace),
    }));
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to list sessions.');
    return [];
  }
}

/** Open (or reveal) the Kōdo Settings panel, seeded with the current global
 * rules, stuck-detection settings, and llama.cpp version info fetched
 * up-front. Pass `selectSection` (e.g. `'local-inference'`, or a cloud vendor
 * key like `'anthropic'`) to force the left nav to a specific tab — used by
 * `openLocalInferenceSettings`/`openCloudAiSettings` above; omitted, the
 * panel opens on whatever tab it last showed (or "General" for a brand-new
 * panel).
 *
 * State is fetched BEFORE the panel is created so its webview is constructed
 * with fully-populated state. The previous approach opened the panel with an
 * empty list and relied on a later `security.rules.list` response arriving
 * as an async `update` postMessage;
 * that message could race the freshly-created webview's load and be dropped,
 * leaving the panel showing nothing (the panel has no static shell — every
 * row is produced by the webview's `render()`, which only ran on receipt of
 * an `update`). Fetching first makes the initial data ride the reliable
 * `ready`→`update` handshake instead — `selectSection` rides that same
 * handshake (see `KodoSettingsPanel.createOrShow`/`selectSection`). */
export async function openKodoSettings(
  selectSection?: string,
  configureEntry?: string,
): Promise<void> {
  const [rules, stuckDetection, housekeeperLlm, llamaCpp, sessions] = await Promise.all([
    fetchGlobalRules(),
    fetchStuckDetection(),
    fetchHousekeeperLlm(),
    fetchLlamaCppVersionInfo(),
    fetchSessionsForPanel(),
  ]);
  // Unlike the four above, ui-settings.json is a local file kodo-vsix alone
  // owns — no server round trip — and the "Local Inference" tab's fields are
  // already continuously maintained in module state (see
  // `pushLocalInferenceState`), so both read synchronously rather than
  // joining the Promise.all.
  const uiSettings = readUiSettings();
  const localInference = {
    localRegistry: state.localRegistryState,
    llamaServerOverridePath: state.llamaServerOverridePathState,
    detectedVramGb: state.detectedVramGbState,
    detectedRamGb: state.detectedRamGbState,
    downloads: state.localDownloadsState,
    isMac: process.platform === 'darwin',
    updatableNames: state.localUpdatableNamesState,
    samplingSpecs: state.samplingSpecsState,
    knobDefs: state.knobDefsState,
    llamaArgCatalog: state.llamaArgCatalogState,
  };
  const cloudAi = cloudAiStateForPanel();
  const panel = KodoSettingsPanel.createOrShow(
    state.extensionContext!.extensionUri,
    {
      rules, stuckDetection, housekeeperLlm, llamaCpp, sessions, sessionRules: null, uiSettings,
      hfTokens: hfTokens.listTokens(), ...localInference, ...cloudAi,
    },
    (msg) => void onKodoSettingsMessage(msg),
    selectSection,
    configureEntry,
  );
  // For an already-open panel, createOrShow only revealed it (initialState is
  // ignored) — push the freshly-fetched state in explicitly so re-opening the
  // panel always reflects current state. `sessionRules` is deliberately left
  // untouched here (omitted from the patch) — closing and reopening the panel
  // while the "Session Settings" modal state is stale just means its next
  // gear-icon click re-fetches, no need to blow away a matching one.
  panel.update({
    rules, stuckDetection, housekeeperLlm, llamaCpp, sessions, uiSettings,
    hfTokens: hfTokens.listTokens(), ...localInference, ...cloudAi,
  });
}

/** Delete a session by id from the Kōdo Settings panel's "Sessions" list —
 * same confirmation copy as `session-controller.ts`'s `_confirmAndDelete`,
 * but travels over the control connection via `session.delete_by_id`
 * (kodo/doc/WS_PROTOCOL.md §7.6e) rather than `session.delete`, since the
 * panel isn't that session's own tab connection (and the session may not
 * even be live). The panel's trash icon already disables itself for a
 * `taken` session, so this only ever fires for one this window doesn't own. */
async function deleteSessionFromSettingsPanel(sessionId: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    'Delete this Kōdo session?',
    {
      modal: true,
      detail: 'This is a destructive action that cannot be undone. All agent history '
        + 'associated with this session will be permanently deleted.\n\n'
        + 'The project this session was working on will not be affected.',
    },
    'Yes',
  );
  if (choice !== 'Yes') {
    return;
  }
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('session.delete_by_id', { session_id: sessionId });
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to delete this session.');
    return;
  }
  if (resp.type === 'session.delete_by_id.error') {
    const message = typeof resp.message === 'string' ? resp.message : 'Unknown error.';
    vscode.window.showErrorMessage(`Kōdo: failed to delete this session — ${message}`);
    return;
  }
  KodoSettingsPanel.instance?.update({ sessions: await fetchSessionsForPanel() });
}

/** Open a session from the Kōdo Settings panel's "Sessions" list — the same
 * decision tree as `pickSession()`'s "existing session" branch (reveal if
 * already open in this window, `resumeSessionIntoWorkspace` otherwise, an
 * error toast if it's `taken` by another window), just triggered from the
 * new open-folder icon instead of the command-palette picker. Re-fetches
 * `session.list` rather than trusting the panel's cached row, since
 * `taken`/`workspace` can go stale while the panel sits open. */
async function openSessionFromSettingsPanel(sessionId: string): Promise<void> {
  if (findBySessionId(sessionId)) {
    openExistingSession(sessionId);
    return;
  }
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('session.list', currentWorkspaceShapeForList());
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to open this session.');
    return;
  }
  const list = Array.isArray(resp.sessions) ? (resp.sessions as Record<string, unknown>[]) : [];
  const entry = list.find((s) => String(s.id ?? '') === sessionId);
  if (!entry) {
    vscode.window.showErrorMessage('Kōdo: this session no longer exists.');
    KodoSettingsPanel.instance?.update({ sessions: await fetchSessionsForPanel() });
    return;
  }
  if (Boolean(entry.taken)) {
    vscode.window.showInformationMessage('Cannot open this session: opened in another window.');
    return;
  }
  await resumeSessionIntoWorkspace(sessionId, parseRememberedWorkspace(entry.workspace));
}

async function onKodoSettingsMessage(msg: KodoSettingsMessage): Promise<void> {
  if (msg.type === 'delete_rules') {
    try {
      const resp = await sendControlAwait('security.rules.delete', { rules: msg.rules });
      KodoSettingsPanel.instance?.update({ rules: parseRuleEntries(resp.rules) });
    } catch {
      vscode.window.showErrorMessage('Kōdo: could not reach the server to delete the selected rule(s).');
    }
    return;
  }
  if (msg.type === 'set_stuck_detection') {
    try {
      const resp = await sendControlAwait('stuck_detection.set', {
        active: msg.active,
        scope: msg.scope,
        auto_unstuck_interactive: msg.auto_unstuck_interactive,
      });
      KodoSettingsPanel.instance?.update({ stuckDetection: parseStuckDetection(resp) });
    } catch {
      vscode.window.showErrorMessage('Kōdo: could not reach the server to update stuck-detection settings.');
    }
    return;
  }
  if (msg.type === 'set_housekeeper_llm') {
    try {
      const resp = await sendControlAwait('housekeeper_llm.set', { id: msg.id });
      if (resp.ok === false) {
        const message = typeof resp.error === 'string' ? resp.error : 'Unknown error.';
        vscode.window.showErrorMessage(`Kōdo: could not select this housekeeper LLM — ${message}`);
        return;
      }
      // `.set.ack` only carries `{ok, selected}` (the catalog itself never
      // changes at runtime) — re-fetching the full `.get` shape is simpler
      // than threading the unchanged `options` array through here.
      KodoSettingsPanel.instance?.update({ housekeeperLlm: await fetchHousekeeperLlm() });
    } catch {
      vscode.window.showErrorMessage('Kōdo: could not reach the server to update the housekeeper LLM.');
    }
    return;
  }
  if (msg.type === 'set_ui_settings') {
    // Local file, no server round trip — write, reflect in the panel, and
    // push to every open session tab immediately (mirrors
    // broadcastThinkingContext; unlike that one, this fires from a user
    // action rather than a state change elsewhere). Merged onto the current
    // settings (not a bare object) since writeUiSettings overwrites the whole
    // file and this message only carries the "General" section's own fields —
    // a bare overwrite here would silently drop the sidebar's pinned-card
    // lists (`pinnedLocalModels`/`pinnedCloudVendors`) on every toggle.
    const uiSettings = writeUiSettings({
      ...readUiSettings(),
      showTimestamps: msg.showTimestamps,
      timezone: msg.timezone,
      clockFormat: msg.clockFormat,
      enterSubmits: msg.enterSubmits,
      showAllLocalLlmQuants: msg.showAllLocalLlmQuants,
    });
    KodoSettingsPanel.instance?.update({ uiSettings });
    broadcastUiSettings(uiSettings);
    return;
  }
  if (msg.type === 'install_llamacpp') {
    installLlamaCpp();
    return;
  }
  if (msg.type === 'update_llamacpp') {
    updateLlamaCppToLatest();
    return;
  }
  if (msg.type === 'uninstall_llamacpp') {
    await uninstallLlamaCpp();
    return;
  }
  if (msg.type === 'install_llamacpp_version_prompt') {
    await promptInstallLlamaCppVersion();
    return;
  }
  if (msg.type === 'delete_session') {
    await deleteSessionFromSettingsPanel(msg.sessionId);
    return;
  }
  if (msg.type === 'open_session') {
    await openSessionFromSettingsPanel(msg.sessionId);
    return;
  }
  if (msg.type === 'fetch_session_rules') {
    try {
      const resp = await sendControlAwait('session.security_rules.list', { session_id: msg.sessionId });
      KodoSettingsPanel.instance?.update({
        sessionRules: { sessionId: msg.sessionId, rules: parseRuleEntries(resp.rules) },
      });
    } catch {
      vscode.window.showErrorMessage("Kōdo: could not reach the server to load this session's allow-rules.");
    }
    return;
  }
  if (msg.type === 'delete_session_rules') {
    try {
      const resp = await sendControlAwait('session.security_rules.delete', {
        session_id: msg.sessionId,
        rules: msg.rules,
      });
      KodoSettingsPanel.instance?.update({
        sessionRules: { sessionId: msg.sessionId, rules: parseRuleEntries(resp.rules) },
      });
    } catch {
      vscode.window.showErrorMessage('Kōdo: could not reach the server to delete the selected rule(s).');
    }
    return;
  }
  if (msg.type === 'add_hf_token') {
    try {
      await hfTokens.addToken(state.extensionContext!, msg.name, msg.secret);
      KodoSettingsPanel.instance?.update({ hfTokens: hfTokens.listTokens() });
    } catch {
      vscode.window.showErrorMessage('Kōdo: failed to save HuggingFace token.');
    }
    return;
  }
  if (msg.type === 'remove_hf_token') {
    try {
      await hfTokens.removeToken(state.extensionContext!, msg.uuid);
      KodoSettingsPanel.instance?.update({ hfTokens: hfTokens.listTokens() });
    } catch {
      vscode.window.showErrorMessage('Kōdo: failed to remove HuggingFace token.');
    }
    return;
  }
  if (msg.type === 'activate_hf_token') {
    hfTokens.setActiveToken(msg.uuid);
    KodoSettingsPanel.instance?.update({ hfTokens: hfTokens.listTokens() });
    return;
  }
  if (msg.type === 'set_cloud_model') {
    setCloudModel(msg.vendor, msg.effort, msg.model_id);
    return;
  }
  if (msg.type === 'add_key') {
    if (state.extensionContext) {
      await cloudCredentials.addKey(state.extensionContext, msg.vendor, msg.name, msg.secret);
      pushCloudAiSettingsState();
    }
    return;
  }
  if (msg.type === 'forget_key') {
    const confirm = await vscode.window.showWarningMessage(
      'Forget this API key? This cannot be undone.',
      { modal: true },
      'Forget key',
    );
    if (confirm === 'Forget key' && state.extensionContext) {
      await cloudCredentials.forgetKey(state.extensionContext, msg.vendor, msg.uuid);
      pushCloudAiSettingsState();
    }
    return;
  }
  if (msg.type === 'make_active') {
    cloudCredentials.makeActive(msg.vendor, msg.uuid);
    pushCloudAiSettingsState();
    return;
  }
  // Everything else belongs to the "Local Inference" tab (former standalone
  // Local Inference Settings panel's message set) — handled separately below
  // to keep that cluster of branches together.
  await onLocalInferenceSettingsMessage(msg);
}

async function onLocalInferenceSettingsMessage(msg: KodoSettingsMessage): Promise<void> {
  if (msg.type === 'add_huggingface') {
    sendControl(
      makeRequest('local_llm.add_huggingface', {
        name: msg.name,
        description: msg.description,
        repo_id: msg.repo_id,
        filename: msg.filename,
        llama_args: msg.llama_args,
        context_window: msg.context_window,
      }),
    );
  } else if (msg.type === 'add_file') {
    // A file the user just picked from disk exists by construction — mark it
    // installed immediately rather than waiting for the next extension
    // restart's startup-time check (see doc/LLM_REGISTRY.md §4).
    state.customFileInstalledCache.set(msg.name, true);
    sendControl(
      makeRequest('local_llm.add_file', {
        name: msg.name,
        description: msg.description,
        path: msg.path,
        llama_args: msg.llama_args,
        context_window: msg.context_window,
      }),
    );
  } else if (msg.type === 'add_server_url') {
    sendControl(
      makeRequest('local_llm.add_server_url', {
        name: msg.name,
        description: msg.description,
        url: msg.url,
      }),
    );
  } else if (msg.type === 'pick_gguf_file') {
    await pickGgufFile();
  } else if (msg.type === 'install') {
    sendControl(makeRequest('local_llm.install', { name: msg.name }));
  } else if (msg.type === 'resume') {
    sendControl(makeRequest('local_llm.resume', { name: msg.name }));
  } else if (msg.type === 'pause') {
    sendControl(makeRequest('local_llm.pause', { name: msg.name }));
  } else if (msg.type === 'cancel') {
    // A download-in-progress has no registry-removal step — cancelling it is
    // exactly "free the partial GGUF", same as uninstalling a finished one.
    sendControl(makeRequest('local_llm.uninstall', { name: msg.name }));
  } else if (msg.type === 'uninstall') {
    sendControl(makeRequest('local_llm.uninstall', { name: msg.name }));
  } else if (msg.type === 'update') {
    // The server's local_llm.update handler uninstalls then re-downloads
    // (doc/LOCAL_MODEL_MANAGER.md §12) and will push fresh local_llm.
    // registry_state events reflecting each stage on its own — dropping
    // msg.name here immediately is correct, not just optimistic: the update
    // this triggers is what actually brings the file back in sync.
    state.localUpdatableNamesState = state.localUpdatableNamesState.filter((n) => n !== msg.name);
    pushLocalInferenceState();
    sendControl(makeRequest('local_llm.update', { name: msg.name }));
  } else if (msg.type === 'remove') {
    sendControl(makeRequest('local_llm.remove', { name: msg.name }));
  } else if (msg.type === 'reveal') {
    revealLocalLlmFiles(msg.name);
  } else if (msg.type === 'set_override') {
    await setLlamaServerOverride();
  } else if (msg.type === 'remove_override') {
    sendControl(makeRequest('llama_server_override.remove'));
  } else if (msg.type === 'add_profile') {
    sendControl(
      makeRequest('local_llm.add_profile', {
        name: msg.name,
        profile_name: msg.profile_name,
        description: msg.description,
        llama_args_text: msg.llama_args_text,
      }),
    );
  } else if (msg.type === 'update_profile') {
    sendControl(
      makeRequest('local_llm.update_profile', {
        name: msg.name,
        profile_id: msg.profile_id,
        profile_name: msg.profile_name,
        description: msg.description,
        llama_args_text: msg.llama_args_text,
      }),
    );
  } else if (msg.type === 'remove_profile') {
    sendControl(makeRequest('local_llm.remove_profile', { name: msg.name, profile_id: msg.profile_id }));
  } else if (msg.type === 'set_active_profile') {
    setActiveProfile(msg.name, msg.profile_id);
  } else if (msg.type === 'set_knobs') {
    setKnobs(msg.name, msg.knobs);
  }
}
