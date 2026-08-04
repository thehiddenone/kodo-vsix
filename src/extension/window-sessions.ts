/**
 * Session tab lifecycle for this window: building each `SessionController`'s
 * `SessionDeps`, creating/opening/adopting tabs, and remembering which
 * sessions this window has open (globalState, survives the workspace-identity
 * flips that wipe the webview-panel serializer's own restore state) so they
 * can be reconciled — reopened — once the control connection is confirmed up.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import * as cloudCredentials from '../cloud-credentials';
import { reconcileSessionAction, reconcileTabAction, reloadWipesSerializerState } from '../reconcile-policy';
import type { SessionDeps } from '../session/types';
import { SessionController } from '../session/controller';
import { applyLlamaState } from './llamacpp';
import { handleApiKeyRequest, pushCloudAiSettingsState } from './cloud-ai-settings';
import { handleChooseProjectFolder } from './create-project';
import { confirmLocalLlamaLaunch } from './local-llm-registry';
import { currentSamplingContext } from './sampling-context';
import { reconnectSessionWorkspace } from './session-resume';
import { sendControlAwait } from './control-send';
import { buildFolderMap, codeWorkspaceFile, readUiSettings } from './settings-io';
import { state } from './state';
import { currentThinkingContext } from './thinking-context';
import { armWindowIdContinuity } from './window-id';

function sessionDeps(): SessionDeps {
  return {
    context: state.extensionContext!,
    windowId: state.windowId,
    wsUrl: state.wsUrl,
    getPhysicalRoot: () => state.physicalRoot,
    getProjectRoot: () => state.projectRoot,
    hasWorkspace: () => state.hasWorkspace,
    buildFolderMap,
    getCodeWorkspaceFile: codeWorkspaceFile,
    addWorkspaceFolder,
    reconnectWorkspace: reconnectSessionWorkspace,
    getThinkingContext: currentThinkingContext,
    getSamplingContext: currentSamplingContext,
    getUiSettings: readUiSettings,
    handleApiKeyRequest: (vendor, requestId, send) => {
      state.apiKeyQueue = state.apiKeyQueue.then(() => handleApiKeyRequest(vendor, requestId, send));
    },
    chooseProjectFolder: (requestId, send) => {
      state.chooseProjectFolderQueue = state.chooseProjectFolderQueue.then(() =>
        handleChooseProjectFolder(requestId, send),
      );
    },
    revokeApiKey: (vendor) => {
      void cloudCredentials.revokeActiveKey(state.extensionContext!, vendor).then(() => pushCloudAiSettingsState());
    },
    onSessionAssigned: (_c, sessionId) => rememberOpenSession(sessionId),
    onLlamaState: applyLlamaState,
    confirmLocalLaunch: () => {
      // A launch only actually occurs if we're in local mode and the running
      // server (if any) isn't already serving the active model — mirrors the
      // condition an engine run's own auto-start check would find true.
      const wouldLaunch =
        state.modeState === 'local' &&
        (!state.llamaRunningState || state.llamaRunningModelState !== state.activeLocalModelState);
      if (!wouldLaunch) {
        return Promise.resolve(true);
      }
      // `kodo.openSettings` (not a direct kodo-settings-bridge.ts import) to
      // avoid a circular import — see confirmLocalLlamaLaunch's doc comment.
      return confirmLocalLlamaLaunch(() =>
        void vscode.commands.executeCommand('kodo.openSettings', 'local-inference'),
      );
    },
    onClosed: (c) => {
      state.sessions.delete(c.key);
      // A real user close (or delete, or a session_in_use bounce) means this
      // window should NOT auto-reopen the session next activation. On window
      // reload/teardown `deactivating` is set and the list must survive intact.
      if (!state.deactivating && c.sessionId) {
        forgetOpenSession(c.sessionId);
      }
    },
    isDeactivating: () => state.deactivating,
  };
}

/** Find an open tab already driving this session id, if any. */
export function findBySessionId(sessionId: string): SessionController | undefined {
  for (const s of state.sessions.values()) {
    if (s.sessionId === sessionId) {
      return s;
    }
  }
  return undefined;
}

/** Find the foreground session tab with a ready connection, if any. */
export function findActiveSession(): SessionController | undefined {
  for (const s of state.sessions.values()) {
    if (s.isActiveAndReady) {
      return s;
    }
  }
  return undefined;
}

function createPanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel('kodoPanel', 'Kōdo', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(state.extensionContext!.extensionPath, 'dist'))],
  });
}

/** Open a blank session (interactive + problem-solving) in a new tab. */
export function newSession(): SessionController {
  const controller = new SessionController(sessionDeps(), createPanel(), '');
  state.sessions.set(controller.key, controller);
  return controller;
}

/** Reveal the most recent open session, or start a new one if none are open. */
export function openPanel(): void {
  const last = [...state.sessions.values()].pop();
  if (last) {
    last.reveal();
  } else {
    newSession();
  }
}

/** Open an existing session id in a tab (revealing it if already open). */
export function openExistingSession(sessionId: string): void {
  const existing = findBySessionId(sessionId);
  if (existing) {
    existing.reveal();
    return;
  }
  const controller = new SessionController(sessionDeps(), createPanel(), sessionId);
  state.sessions.set(controller.key, controller);
}

/** Adopt a panel restored by the webview serializer (reload / reopen). */
export function adoptPanel(panel: vscode.WebviewPanel, sessionId: string): void {
  if (sessionId && findBySessionId(sessionId)) {
    // Already restored elsewhere — drop the duplicate.
    panel.dispose();
    return;
  }
  const controller = new SessionController(sessionDeps(), panel, sessionId);
  state.sessions.set(controller.key, controller);
}

/**
 * Add an already-existing directory to the open workspace — either one the
 * server has just scaffolded (via the `create_new_project` tool or the
 * "Create Project" command's `project.create` message, so the agent's
 * subsequent file edits are visible) or, for a currently folder-less window,
 * a raw folder the user picked to become the new workspace home
 * (`promptOpenWorkspaceForNewProject`) before any project exists in it yet.
 * Either way this only registers it as a VS Code workspace folder and
 * re-pushes `workspace.folders` to the server. No-op when the folder is
 * already part of the workspace.
 *
 * When this is about to become the window's first folder, VS Code restarts
 * the extension host for it — `armWindowIdContinuity` (awaited, before
 * `updateWorkspaceFolders`) preserves this window's id across that restart;
 * see its doc comment.
 */
export async function addWorkspaceFolder(folderPath: string, name: string): Promise<void> {
  const folderUri = vscode.Uri.file(folderPath);
  const alreadyInWorkspace =
    vscode.workspace.workspaceFolders?.some((f) => f.uri.fsPath === folderUri.fsPath) ?? false;
  if (alreadyInWorkspace) {
    return;
  }
  const insertAt = vscode.workspace.workspaceFolders?.length ?? 0;
  if (insertAt === 0 && state.extensionContext) {
    await armWindowIdContinuity(state.extensionContext, folderPath);
  }
  // Both reload-inducing transitions land in a fresh workspace-storage identity
  // that kills the webview-panel serializer's state — arm the dead-serializer
  // marker so the post-reload reconcile treats leftover kodoPanel tabs as dead
  // ghosts instead of deferring on them forever (see `serializerStateIsDead`).
  if (reloadWipesSerializerState(insertAt)) {
    await armSerializerDead();
  }
  vscode.workspace.updateWorkspaceFolders(
    insertAt,
    0,
    name ? { uri: folderUri, name } : { uri: folderUri },
  );
}

// ---------------------------------------------------------------------------
// Per-window open-session memory (globalState) + reopen reconciliation
//
// The webview-panel serializer is the primary restore path, but its state
// lives in *workspace* storage — and the `create_new_project` flow reloads the
// window into a brand-new untitled multi-root workspace whose storage is
// empty, so the serializer restores nothing and a mid-turn session is
// stranded on the server (evidenced: after such a reload only the control
// socket reconnects; no session hello ever arrives). globalState is
// per-extension (workspace-independent), so a list of this window's open
// sessions keyed by the stable windowId survives that transition. After the
// control connection's hello.ack we reconcile: any remembered session that is
// still on the server, not open here, and not live in another window gets its
// tab reopened (and reconnects mid-turn via the server's channel replay).
// ---------------------------------------------------------------------------

function openSessionsKey(id: string = state.windowId): string {
  return `kodo.openSessions.${id}`;
}

function rememberedOpenSessions(): string[] {
  const raw = state.extensionContext?.globalState.get<string[]>(openSessionsKey());
  return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string' && v !== '') : [];
}

export function rememberOpenSession(sessionId: string): void {
  const list = rememberedOpenSessions();
  if (!list.includes(sessionId)) {
    list.push(sessionId);
    void state.extensionContext?.globalState.update(openSessionsKey(), list);
  }
}

export function forgetOpenSession(sessionId: string): void {
  const list = rememberedOpenSessions();
  if (list.includes(sessionId)) {
    void state.extensionContext?.globalState.update(
      openSessionsKey(),
      list.filter((id) => id !== sessionId),
    );
  }
}

function serializerDeadKey(id: string = state.windowId): string {
  return `kodo.serializerDeadOnReload.${id}`;
}

/** Arm the "serializer state dies on the next reload" marker under the id this
 * window will still hold post-reload (windowId is preserved across both
 * reload-inducing transitions — via continuity for empty→first-folder, and
 * unchanged folders[0] for single→multi-root). Local globalState write, durable
 * before the caller triggers the reload. */
export async function armSerializerDead(): Promise<void> {
  await state.extensionContext?.globalState.update(serializerDeadKey(), true);
}

/** One-shot consume of the marker on activation → `state.serializerStateIsDead`. */
export function consumeSerializerDead(): void {
  const armed = state.extensionContext?.globalState.get<boolean>(serializerDeadKey()) === true;
  state.serializerStateIsDead = armed;
  if (armed) {
    void state.extensionContext?.globalState.update(serializerDeadKey(), undefined);
  }
}

/** Close every native `kodoPanel` tab currently in the window. Called only in
 * the `serializerStateIsDead` branch, where all such tabs are dead ghosts
 * (serializer state died with the workspace-identity change), so closing them
 * before reconcile reopens the real sessions is always correct and removes the
 * confusing dead tab the user would otherwise be left staring at. */
async function closeGhostKodoTabs(): Promise<void> {
  const ghosts: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('kodoPanel')) {
        ghosts.push(tab);
      }
    }
  }
  if (ghosts.length === 0) {
    return;
  }
  try {
    await vscode.window.tabGroups.close(ghosts);
  } catch {
    /* best-effort — a ghost may already be gone */
  }
}

/**
 * Count native `kodoPanel` tabs in this window, including ones VS Code has not
 * deserialized yet. Per the `WebviewPanelSerializer` docs, `deserializeWebviewPanel`
 * fires only when "a serialized webview first becomes visible" — at startup that
 * means the foreground tab is revived immediately but background sticky tabs sit
 * as inert placeholders (already showing their cached title/icon) until clicked.
 * `tabGroups.all` reflects those placeholders too, since the tab strip is
 * layout state independent of the extension host's webview objects — so this
 * count can exceed `sessions.size` even though no duplicate exists yet.
 */
function kodoPanelTabCount(): number {
  let count = 0;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('kodoPanel')) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Reopen this window's remembered sessions that did not come back through the
 * panel serializer. Runs once, after the control connection is up (so
 * `session.list` is answerable). Serializer-restored tabs are skipped via
 * `findBySessionId`; the reverse race is covered by `adoptPanel`'s duplicate
 * check. Remembered ids that no longer exist on the server, or that are now
 * live in another window, are pruned instead of reopened.
 *
 * Guard: a background sticky tab that VS Code hasn't revived yet (see
 * `kodoPanelTabCount`) looks identical to a genuinely lost tab — `sessions`
 * has no controller for it either way. Racing ahead and opening a new tab for
 * it creates a real duplicate: the reconcile-made tab wins the connection, and
 * the original tab, once the user finally clicks it, deserializes, loses the
 * `findBySessionId` duplicate check in `adoptPanel`, and disposes itself —
 * which reads to the user as "a duplicate tab that vanishes when clicked."
 * So when there are more native `kodoPanel` tabs than adopted sessions, some
 * remembered ids are presumably still-pending placeholders; skip reconciling
 * this round rather than guess which ones are real vs. actually lost (the
 * `create_new_project` reload this exists for leaves zero native tabs behind,
 * so it is unaffected by this guard).
 *
 * `state.reconciledOpenSessions` only latches `true` on a branch that is
 * genuinely done (nothing remembered, everything already adopted, or the
 * reopen loop ran) — the tab-count guard and a `session.list` failure both
 * leave it `false` so a *later* `hello.ack` (the control connection
 * reconnecting within the same activation is routine, not just a fresh
 * activation) gets another chance instead of this window silently never
 * reconciling again.
 */
export async function reconcileOpenSessions(): Promise<void> {
  if (state.reconciledOpenSessions) {
    return;
  }
  const remembered = rememberedOpenSessions();
  if (remembered.length === 0) {
    state.reconciledOpenSessions = true;
    return;
  }
  const notYetAdopted = remembered.filter((id) => !findBySessionId(id));
  if (notYetAdopted.length === 0) {
    state.reconciledOpenSessions = true;
    return;
  }
  const tabAction = reconcileTabAction(state.serializerStateIsDead, kodoPanelTabCount(), state.sessions.size);
  if (tabAction === 'defer') {
    return; // un-revived sticky placeholders — the serializer will adopt them
  }
  if (tabAction === 'close-ghosts') {
    // This reload changed the workspace identity, so the serializer's state is
    // gone: the extra native kodoPanel tab(s) are dead ghosts that will NEVER
    // be adopted (VS Code won't re-fire the serializer for them). The ordinary
    // guard would defer on them forever — instead, drop them and reconcile
    // from globalState, the only working recovery path here.
    await closeGhostKodoTabs();
  }
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('session.list');
  } catch {
    return; // server unreachable — retry on the next hello.ack
  }
  state.reconciledOpenSessions = true;
  const list = Array.isArray(resp.sessions) ? (resp.sessions as Record<string, unknown>[]) : [];
  const byId = new Map(list.map((s) => [String(s.id ?? ''), s]));
  for (const id of notYetAdopted) {
    if (findBySessionId(id)) {
      continue; // serializer restored this tab while session.list was in flight
    }
    const info = byId.get(id);
    if (reconcileSessionAction(Boolean(info), Boolean(info?.taken)) === 'forget') {
      forgetOpenSession(id); // deleted, or now owned by a live window
      continue;
    }
    openExistingSession(id);
  }
}
