/**
 * The session picker (cross-window open gate, over the control connection)
 * and resuming a picked/reconnected session into its remembered workspace —
 * reloading the current window when the workspace doesn't already match.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ResumeTarget, RememberedWorkspace } from '../workspace-resume-policy';
import { requiresWorkspaceSwitchConfirmation, resumeTarget, resumeTargetMatchesCurrent } from '../workspace-resume-policy';
import { sendControlAwait } from './control-send';
import { resolveFutureWindowKeyForCodeWorkspace } from './create-project';
import { buildFolderMap } from './settings-io';
import { state } from './state';
import { armWindowIdContinuity } from './window-id';
import { armSerializerDead, findBySessionId, newSession, openExistingSession } from './window-sessions';

interface SessionPickItem extends vscode.QuickPickItem {
  sessionId?: string;
  isNew?: boolean;
  disabledReason?: string;
  remembered?: RememberedWorkspace | null;
}

/** Parse `session.list`'s per-entry `workspace` field (`null` or
 * `{physical_root, folders, code_workspace_file, locked, compatible}`) into
 * `RememberedWorkspace`. */
export function parseRememberedWorkspace(raw: unknown): RememberedWorkspace | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const physicalRoot = typeof r.physical_root === 'string' ? r.physical_root : '';
  const folders: Record<string, string> = {};
  if (r.folders && typeof r.folders === 'object') {
    for (const [k, v] of Object.entries(r.folders as Record<string, unknown>)) {
      if (typeof v === 'string') {
        folders[k] = v;
      }
    }
  }
  const codeWorkspaceFile = typeof r.code_workspace_file === 'string' ? r.code_workspace_file : null;
  const locked = r.locked === true;
  const compatible = r.compatible === true;
  return { physicalRoot, folders, codeWorkspaceFile, locked, compatible };
}

/** The current window's own workspace shape, as `session.list`'s optional
 * request payload — lets the server compute each locked session's
 * `compatible` field against it (doc/WS_PROTOCOL.md §7.1b). */
export function currentWorkspaceShapeForList(): { physical_root: string; folders: Record<string, string> } {
  return { physical_root: state.physicalRoot, folders: buildFolderMap() };
}

/** Render an ISO-8601 timestamp as a short local date/time, or "unknown". */
function formatTimestamp(iso: string): string {
  if (!iso) {
    return 'unknown';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function pickSession(): Promise<void> {
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('session.list', currentWorkspaceShapeForList());
  } catch {
    void vscode.window.showErrorMessage('Kōdo: could not reach the server to list sessions.');
    return;
  }
  const list = Array.isArray(resp.sessions) ? (resp.sessions as Record<string, unknown>[]) : [];

  const items: SessionPickItem[] = [
    { label: '$(add) New session', isNew: true, detail: 'Start a fresh session in this window' },
  ];
  for (const s of list) {
    const id = String(s.id ?? '');
    const name = String(s.name ?? id);
    const workflowMode = typeof s.workflow_mode === 'string' ? s.workflow_mode : null;
    const taken = Boolean(s.taken);
    const openHere = findBySessionId(id) !== undefined;
    const remembered = parseRememberedWorkspace(s.workspace);

    // Opened in another window is the only thing that still blocks picking a
    // session outright — a workspace mismatch is no longer disabling: picking
    // it reopens the remembered workspace into this window first (see
    // `resumeSessionIntoWorkspace`). `openHere` always wins (just reveal the
    // live tab) regardless of what's remembered.
    const disabledReason = taken && !openHere ? 'Opened in another window' : undefined;

    const kindLabel = workflowMode === 'guided' ? 'Guided' : 'Problem solving';
    const created = typeof s.created_at === 'string' ? s.created_at : '';
    const lastModified = typeof s.last_modified === 'string' ? s.last_modified : '';
    const timeLabel = `created ${formatTimestamp(created)}, last modified ${formatTimestamp(lastModified)}${remembered ? ', in workspace' : ''}`;
    items.push({
      label: (disabledReason ? '$(circle-slash) ' : '$(comment-discussion) ') + name,
      description: openHere ? `${kindLabel} · (opened here)` : kindLabel,
      detail: disabledReason ? `${disabledReason} · ${timeLabel}` : timeLabel,
      sessionId: id,
      disabledReason,
      remembered,
    });
  }

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Open a Kōdo session',
    matchOnDetail: true,
  });
  if (!choice) {
    return;
  }
  if (choice.disabledReason) {
    void vscode.window.showInformationMessage(`Cannot open this session: ${choice.disabledReason}.`);
    return pickSession();
  }
  if (choice.isNew) {
    newSession();
    return;
  }
  if (choice.sessionId) {
    if (findBySessionId(choice.sessionId)) {
      // Already open here — just reveal the live tab, no workspace dance.
      openExistingSession(choice.sessionId);
    } else {
      await resumeSessionIntoWorkspace(choice.sessionId, choice.remembered ?? null);
    }
  }
}

/** Human-readable description of a `ResumeTarget`, for the workspace-switch
 *  confirmation dialog's detail text. */
function describeResumeTarget(target: ResumeTarget): string {
  if (target.kind === 'file') {
    return `the workspace "${path.basename(target.path)}"`;
  }
  if (target.kind === 'folders') {
    const names = target.entries.map(([name]) => name);
    return names.length === 1 ? `the folder "${names[0]}"` : `the folders ${names.map((n) => `"${n}"`).join(', ')}`;
  }
  return 'a different workspace';
}

/**
 * Reload the current window into `target` and arm the pending-resume marker
 * for `sessionId` — the reload/continuity mechanics shared by
 * `resumeSessionIntoWorkspace`'s mismatch path and the manual
 * reconnect-workspace flows (`reconnectSessionWorkspace`,
 * `promptReconnectForCreateProject` in create-project.ts). Always reloads
 * unconditionally — callers are responsible for deciding a reload is
 * actually needed/wanted first (compatibility/exact-match checks, user
 * confirmation).
 */
export async function reloadWindowIntoTarget(sessionId: string, target: ResumeTarget): Promise<void> {
  // This reload is at least as disruptive as the `insertAt <= 1` cases
  // `reloadWipesSerializerState` guards (the whole folder set or the
  // workspace file changes) — always arm the dead-serializer marker, and
  // stash which session to resume opening on the other side.
  await armPendingResumeSession(sessionId);
  await armSerializerDead();

  if (target.kind === 'file') {
    if (state.extensionContext) {
      const futureKey = resolveFutureWindowKeyForCodeWorkspace(target.path);
      if (futureKey) {
        await armWindowIdContinuity(state.extensionContext, futureKey);
      }
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target.path), {
      forceReuseWindow: true,
    });
    return;
  }
  if (target.kind === 'none') {
    return; // nothing to reload into
  }

  if (state.extensionContext && target.entries.length > 0) {
    await armWindowIdContinuity(state.extensionContext, target.entries[0][1]);
  }
  const currentCount = vscode.workspace.workspaceFolders?.length ?? 0;
  vscode.workspace.updateWorkspaceFolders(
    0,
    currentCount,
    ...target.entries.map(
      ([entryName, entryPath]: [string, string]) => ({ uri: vscode.Uri.file(entryPath), name: entryName }),
    ),
  );
}

/**
 * Resume a session picked via `pickSession()`, opening its remembered
 * workspace into the CURRENT window first if the current one can't host it —
 * exact-match folder replacement or a `.code-workspace` open, reusing the
 * window rather than spawning a new one (product decisions, see the
 * `project_kodo_workspace_session_linkage` memory). If the window's
 * workspace already matches, or is merely *compatible* (hosts every bound
 * directory without being byte-identical — `remembered.compatible`,
 * server-computed, doc/WS_PROTOCOL.md §7.1b), or nothing was ever
 * remembered, the session opens immediately with no reload.
 *
 * Mirrors `promptOpenWorkspaceForNewProject`'s reload-and-resume pattern
 * (create-project.ts): a workspace switch reloads the extension host, so
 * continuing "open this session" on the other side needs
 * `armPendingResumeSession` + `resumePendingResumeSession` (consumed from the
 * control connection's next `hello.ack`), exactly like
 * `armPendingCreateProjectPrompt`/`resumePendingCreateProjectPrompt`.
 *
 * A locked, incompatible session shows a three-way confirmation first
 * (`requiresWorkspaceSwitchConfirmation`): "Open session and workspace"
 * reloads as above, "Open session only" opens the session disconnected/
 * isolated without touching this window's workspace, and Cancel (explicit
 * button, dismiss, or Escape) opens nothing at all.
 */
export async function resumeSessionIntoWorkspace(
  sessionId: string,
  remembered: RememberedWorkspace | null,
): Promise<void> {
  const codeWorkspaceFileExists = Boolean(
    remembered?.codeWorkspaceFile && fs.existsSync(remembered.codeWorkspaceFile),
  );
  const target = resumeTarget(remembered, codeWorkspaceFileExists);

  const current = {
    workspaceFile: vscode.workspace.workspaceFile?.scheme === 'file'
      ? vscode.workspace.workspaceFile.fsPath
      : undefined,
    folderPaths: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
  };

  if ((remembered?.compatible ?? false) || resumeTargetMatchesCurrent(target, current)) {
    openExistingSession(sessionId);
    return;
  }

  // A session with a locked folder has an irreversible link to its
  // workspace — reloading into a different one needs the user's explicit
  // go-ahead first. An unlocked session has nothing legitimate to protect
  // yet, so it keeps the pre-existing silent-reopen behaviour.
  if (requiresWorkspaceSwitchConfirmation(remembered?.locked ?? false, remembered?.compatible ?? false)) {
    // Three explicit outcomes, not a single "Open" action + implicit
    // Cancel — the two-choice version was ambiguous, since dismissing/
    // Escape-ing the dialog silently opened the session anyway (just
    // disconnected), which read as "Cancel" but wasn't. Now Cancel really
    // means "don't open anything."
    const openBoth = 'Open session and workspace';
    const openSessionOnly = 'Open session only';
    const choice = await vscode.window.showWarningMessage(
      'Open VS code workspace associated with this session?',
      {
        modal: true,
        detail:
          `This session is linked to ${describeResumeTarget(target)}.\n` +
          '- If you choose "Open session and workspace", session’s workplace will replace this window’s workspace.\n' +
          '- If you choose "Open session only", the current workspace will remain opened, ' +
          'and Kodo will be working in directories outside the current workspace.\n' +
          '- Choose "Cancel" if you changed your mind and don’t want to re-open that session.',
      },
      openBoth,
      openSessionOnly,
    );
    if (choice === openSessionOnly) {
      // Open the session disconnected/isolated, operating against its
      // bound directories, without touching this window's workspace.
      openExistingSession(sessionId);
      return;
    }
    if (choice !== openBoth) {
      // Cancel (explicit button, dismiss, or Escape): open nothing.
      return;
    }
  }

  await reloadWindowIntoTarget(sessionId, target);
}

/**
 * Fetch `sessionId`'s current remembered workspace shape via a fresh
 * `session.list` call (never a cached row — `taken`/`workspace` can go
 * stale while a panel/dialog sits open). Shared by the manual
 * reconnect-workspace flows. Shows an error toast and returns `null`
 * on an unreachable server.
 */
export async function fetchRememberedWorkspaceFor(sessionId: string): Promise<RememberedWorkspace | null> {
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('session.list', currentWorkspaceShapeForList());
  } catch {
    void vscode.window.showErrorMessage('Kōdo: could not reach the server to reconnect the workspace.');
    return null;
  }
  const list = Array.isArray(resp.sessions) ? (resp.sessions as Record<string, unknown>[]) : [];
  const entry = list.find((s) => String(s.id ?? '') === sessionId);
  return parseRememberedWorkspace(entry?.workspace);
}

/**
 * Reload the current window into `sessionId`'s OWN remembered workspace —
 * the manual reconnect-workspace button's mechanism (`session-controller.ts`'s
 * `reconnect_workspace` webview message, wired via `SessionDeps.reconnectWorkspace`).
 * A no-op if nothing is remembered (shouldn't happen — the button only shows
 * for a locked, disconnected session).
 */
export async function reconnectSessionWorkspace(sessionId: string): Promise<void> {
  const remembered = await fetchRememberedWorkspaceFor(sessionId);
  if (!remembered) {
    return;
  }
  const codeWorkspaceFileExists = Boolean(
    remembered.codeWorkspaceFile && fs.existsSync(remembered.codeWorkspaceFile),
  );
  const target = resumeTarget(remembered, codeWorkspaceFileExists);
  await reloadWindowIntoTarget(sessionId, target);
}

// `globalState`, mirroring create-project.ts's `PENDING_CREATE_PROJECT_KEY`
// exactly: resuming a picked session whose remembered workspace differs from
// the current one reloads the window (`resumeSessionIntoWorkspace`), so "open
// this session" can't continue synchronously — it's picked back up from the
// next activation's `hello.ack`, same recency-bound pattern (not
// window-id-scoped; session continuity itself is handled precisely by
// `armWindowIdContinuity`).
const PENDING_RESUME_SESSION_KEY = 'kodo.pendingResumeSessionId';
const PENDING_RESUME_SESSION_TTL_MS = 30_000;

async function armPendingResumeSession(sessionId: string): Promise<void> {
  await state.extensionContext?.globalState.update(PENDING_RESUME_SESSION_KEY, {
    sessionId,
    armedAt: Date.now(),
  });
}

/**
 * Called once per activation, after the control connection's `hello.ack`
 * (so `hasWorkspace` is settled), alongside create-project.ts's
 * `resumePendingCreateProjectPrompt`. Consumes the flag
 * `armPendingResumeSession` set right before a workspace-switching session
 * resume, and finishes the job: open the session now that its remembered
 * workspace is loaded.
 */
export async function resumePendingResumeSession(): Promise<void> {
  const pending = state.extensionContext?.globalState.get<{ sessionId: string; armedAt: number }>(
    PENDING_RESUME_SESSION_KEY,
  );
  if (!pending) {
    return;
  }
  await state.extensionContext?.globalState.update(PENDING_RESUME_SESSION_KEY, undefined);
  if (Date.now() - pending.armedAt > PENDING_RESUME_SESSION_TTL_MS || !state.hasWorkspace) {
    return;
  }
  openExistingSession(pending.sessionId);
}
