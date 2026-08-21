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
import type { KodoSettingsMessage, SessionListEntry, SkillsState } from '../settings-panel/types';
import {
  cloudAiStateForPanel,
  pushCloudAiSettingsState,
  refreshBedrockCatalog,
  refreshOpenRouterCatalog,
  setBedrockRegion,
  setCloudModel,
  setCloudUniformEnabled,
  setCloudUniformModel,
  setMetaContributorTier,
  setOpenRouterAutoMode,
} from './cloud-ai-settings';
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

/** Fetch the installed Agent Skills backing the Kōdo Settings panel's "Skills"
 * section (`skills.list`, kodo/doc/WS_PROTOCOL.md §7.6j). `root` comes from the
 * server rather than being rebuilt here, so the path the section tells the user
 * to drop skills into is always the one the server actually scans. Entries with
 * a non-empty `error` are kept — the section renders them as error rows so a
 * broken skill can be seen and deleted (kodo/doc/SKILLS.md §5). Returns an empty
 * listing (and shows a toast) if the server is unreachable. */
async function fetchSkillsForPanel(): Promise<SkillsState> {
  try {
    const resp = await sendControlAwait('skills.list', {});
    return parseSkillsResponse(resp);
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to list skills.');
    return { root: '', skills: [] };
  }
}

/** Shape a `skills.list.ack`/`skills.delete.ack` payload into `SkillsState`.
 * Both acks carry the same listing, which is what lets a delete refresh the
 * table from its own response with no follow-up round-trip. */
function parseSkillsResponse(resp: Record<string, unknown>): SkillsState {
  const list = Array.isArray(resp.skills) ? (resp.skills as Record<string, unknown>[]) : [];
  return {
    root: typeof resp.root === 'string' ? resp.root : '',
    skills: list.map((s) => ({
      name: String(s.name ?? ''),
      description: String(s.description ?? ''),
      path: String(s.path ?? ''),
      error: String(s.error ?? ''),
    })),
  };
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
  const [rules, stuckDetection, housekeeperLlm, llamaCpp, sessions, skills] = await Promise.all([
    fetchGlobalRules(),
    fetchStuckDetection(),
    fetchHousekeeperLlm(),
    fetchLlamaCppVersionInfo(),
    fetchSessionsForPanel(),
    fetchSkillsForPanel(),
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
      rules, stuckDetection, housekeeperLlm, llamaCpp, sessions, sessionRules: null, skills,
      skillScan: null, skillInstall: null,
      uiSettings, hfTokens: hfTokens.listTokens(), ...localInference, ...cloudAi,
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
    rules, stuckDetection, housekeeperLlm, llamaCpp, sessions, skills, uiSettings,
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

/** Scan a git repo for installable Agent Skills (`skills.install_scan`,
 * kodo/doc/WS_PROTOCOL.md §7.6j) — the install-from-repository modal's first
 * step. The result always lands in `skillScan`, success or failure, so the
 * modal's "Scanning…" state always clears; a missing `git` CLI or a clone
 * failure additionally shows an error toast, matching every other
 * server-round-trip failure in this file. A clone can take a while over the
 * network, hence the longer-than-default timeout. */
async function scanSkillRepoForPanel(repoUrl: string): Promise<void> {
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('skills.install_scan', { repo_url: repoUrl }, 70_000);
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to scan this repository.');
    KodoSettingsPanel.instance?.update({
      skillScan: { repoUrl, ok: false, skills: [], error: 'Could not reach the server.' },
    });
    return;
  }
  const ok = resp.ok === true;
  const list = Array.isArray(resp.skills) ? (resp.skills as Record<string, unknown>[]) : [];
  KodoSettingsPanel.instance?.update({
    skillScan: {
      repoUrl,
      ok,
      skills: list.map((s) => ({
        name: String(s.name ?? ''),
        description: String(s.description ?? ''),
      })),
      error: typeof resp.error === 'string' ? resp.error : '',
    },
  });
  if (!ok) {
    const message = typeof resp.error === 'string' ? resp.error : 'Unknown error.';
    vscode.window.showErrorMessage(`Kōdo: could not scan this repository — ${message}`);
  }
}

/** Install the user's selected skills from a git repo (`skills.install`,
 * kodo/doc/WS_PROTOCOL.md §7.6j) — the install modal's final step. Same
 * result-lands-either-way contract as `scanSkillRepoForPanel` above, and also
 * refreshes the main Skills table from the same reply — it carries the
 * post-install listing, the same refresh-from-response convention
 * `deleteSkillFromSettingsPanel` uses. */
async function installSkillsFromPanel(
  repoUrl: string,
  install: { name: string; overwrite: boolean }[],
): Promise<void> {
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('skills.install', { repo_url: repoUrl, install }, 70_000);
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to install these skills.');
    KodoSettingsPanel.instance?.update({
      skillInstall: {
        repoUrl, ok: false, installed: [], conflicts: [], missing: [],
        error: 'Could not reach the server.',
      },
    });
    return;
  }
  const ok = resp.ok === true;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  KodoSettingsPanel.instance?.update({
    skills: parseSkillsResponse(resp),
    skillInstall: {
      repoUrl,
      ok,
      installed: strings(resp.installed),
      conflicts: strings(resp.conflicts),
      missing: strings(resp.missing),
      error: typeof resp.error === 'string' ? resp.error : '',
    },
  });
  if (!ok) {
    const message = typeof resp.error === 'string' ? resp.error : 'Unknown error.';
    vscode.window.showErrorMessage(`Kōdo: could not install these skills — ${message}`);
  }
}

/** "Install from a local file…" (Kōdo Settings → Skills) — a native
 * `showOpenDialog` file picker, filtered to `.md`, then straight to
 * `skills.install_local` (kodo/doc/WS_PROTOCOL.md §7.6j). Unlike "Install
 * from a repository…" this needs no custom modal: the picked file already
 * names the one skill to install (kodo/doc/SKILLS.md §2), so a filename
 * check plus a native confirm-on-conflict dialog is the whole UI. The
 * filename check happens here, client-side, before any round trip — the
 * server would reject it too, but there is no reason to pay a network hop
 * for a mistake this cheap to catch locally. */
async function installLocalSkillPicked(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Kōdo: Select a SKILL.md file',
    canSelectMany: false,
    filters: { 'Skill files': ['md'] },
  });
  const fsPath = picked?.[0]?.fsPath;
  if (!fsPath) {
    return;
  }
  const filename = fsPath.split(/[\\/]/).pop() ?? '';
  if (filename !== 'SKILL.md') {
    vscode.window.showErrorMessage('Kōdo: please select a SKILL.md file.');
    return;
  }
  await installLocalSkillOverWs(fsPath, false);
}

/** Send `skills.install_local` for *path*, and — on a conflict with an
 * already-installed skill — confirm with a native modal and resend with
 * `overwrite: true`. Recurses at most once: the second call always passes
 * `overwrite: true`, which the server accepts unconditionally (no further
 * conflict to report). Reuses `parseSkillsResponse`, since the ack carries
 * the same `root`/`skills` listing shape as every other skills ack. */
async function installLocalSkillOverWs(path: string, overwrite: boolean): Promise<void> {
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('skills.install_local', { path, overwrite });
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to install this skill.');
    return;
  }
  if (resp.ok !== true) {
    const message = typeof resp.error === 'string' ? resp.error : 'Unknown error.';
    vscode.window.showErrorMessage(`Kōdo: could not install this skill — ${message}`);
    KodoSettingsPanel.instance?.update({ skills: parseSkillsResponse(resp) });
    return;
  }

  KodoSettingsPanel.instance?.update({ skills: parseSkillsResponse(resp) });

  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const conflicts = strings(resp.conflicts);
  if (conflicts.length > 0) {
    const name = conflicts[0];
    const choice = await vscode.window.showWarningMessage(
      `A skill named "${name}" is already installed.`,
      { modal: true, detail: 'Overwrite it with the one at the file you selected?' },
      'Overwrite',
    );
    if (choice === 'Overwrite') {
      await installLocalSkillOverWs(path, true);
    }
    return;
  }

  const installed = strings(resp.installed);
  if (installed.length > 0) {
    vscode.window.showInformationMessage(`Kōdo: installed skill "${installed[0]}".`);
  }
}

/** Open one skill's folder in a **new** VS Code window (Kōdo Settings →
 * Skills, folder icon). A skill lives outside every workspace root, so the
 * useful thing to do with it is edit it on its own: `vscode.openFolder` with
 * `forceNewWindow` leaves whatever the user was working on untouched, unlike
 * the reuse-this-window behaviour that would discard their current workspace.
 * The path comes from `skills.list`, so it is the server's own resolved path
 * rather than one rebuilt here. */
async function openSkillFolder(skillPath: string): Promise<void> {
  if (!skillPath) {
    return;
  }
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(skillPath), {
    forceNewWindow: true,
  });
}

/** Delete a skill from the Kōdo Settings panel's "Skills" list (trash icon).
 * Confirms with the same native modal shape as `deleteSessionFromSettingsPanel`
 * above, then sends `skills.delete` (kodo/doc/WS_PROTOCOL.md §7.6j). Both the
 * success and failure acks carry the refreshed listing, so the table updates
 * from the response either way — a failure is most often a skill someone
 * already removed from disk, and the refreshed table is what shows that. */
async function deleteSkillFromSettingsPanel(name: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `Delete the skill "${name}"?`,
    {
      modal: true,
      detail: 'This is a destructive action that cannot be undone. The skill\'s entire '
        + 'folder — its SKILL.md and every file alongside it — will be permanently '
        + 'deleted from disk.\n\n'
        + 'Agents will stop being offered this skill immediately.',
    },
    'Yes',
  );
  if (choice !== 'Yes') {
    return;
  }
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('skills.delete', { name });
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to delete this skill.');
    return;
  }
  KodoSettingsPanel.instance?.update({ skills: parseSkillsResponse(resp) });
  if (resp.ok !== true) {
    const message = typeof resp.error === 'string' ? resp.error : 'Unknown error.';
    vscode.window.showErrorMessage(`Kōdo: failed to delete this skill — ${message}`);
  }
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
  if (msg.type === 'open_skill') {
    await openSkillFolder(msg.path);
    return;
  }
  if (msg.type === 'delete_skill') {
    await deleteSkillFromSettingsPanel(msg.name);
    return;
  }
  if (msg.type === 'scan_skill_repo') {
    await scanSkillRepoForPanel(msg.repoUrl);
    return;
  }
  if (msg.type === 'install_skills') {
    await installSkillsFromPanel(msg.repoUrl, msg.install);
    return;
  }
  if (msg.type === 'install_local_skill_pick') {
    await installLocalSkillPicked();
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
  if (msg.type === 'set_meta_contributor_tier') {
    setMetaContributorTier(msg.enabled);
    return;
  }
  if (msg.type === 'set_openrouter_auto_mode') {
    setOpenRouterAutoMode(msg.enabled);
    return;
  }
  if (msg.type === 'refresh_openrouter_catalog') {
    try {
      await refreshOpenRouterCatalog();
    } catch {
      vscode.window.showErrorMessage('Kōdo: could not reach the server to refresh the OpenRouter model list.');
    }
    return;
  }
  if (msg.type === 'set_bedrock_region') {
    setBedrockRegion(msg.region);
    return;
  }
  if (msg.type === 'set_cloud_uniform_enabled') {
    setCloudUniformEnabled(msg.vendor, msg.enabled);
    return;
  }
  if (msg.type === 'set_cloud_uniform_model') {
    setCloudUniformModel(msg.vendor, msg.model_id);
    return;
  }
  if (msg.type === 'refresh_bedrock_catalog') {
    try {
      // Unlike OpenRouter's, this refresh needs credentials -- `false` means
      // there are none stored yet, which is a configuration state to point at
      // rather than a failure to report.
      const sent = await refreshBedrockCatalog();
      if (!sent) {
        vscode.window.showWarningMessage(
          'Kōdo: add an AWS access key for Bedrock first — the model list is fetched with it.',
        );
      }
    } catch {
      vscode.window.showErrorMessage('Kōdo: could not reach the server to refresh the AWS Bedrock model list.');
    }
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
