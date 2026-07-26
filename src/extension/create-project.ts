/**
 * "Kōdo: Create Project" command, both the has-workspace and no-workspace
 * halves (the latter spans a window reload, resumed via a globalState
 * marker), plus the disconnected-session reconnect-first variant and the
 * `create_new_project` tool's interactive folder-picker round trip.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeResponse } from '../envelope';
import type { Envelope } from '../envelope';
import type { SessionController } from '../session/controller';
import { fetchRememberedWorkspaceFor, reloadWindowIntoTarget } from './session-resume';
import { state } from './state';
import { armWindowIdContinuity } from './window-id';
import { addWorkspaceFolder, findActiveSession, newSession } from './window-sessions';
import { resumeTarget } from '../workspace-resume-policy';

/**
 * Show a native "open directory" dialog to pick a workspace-home *parent*
 * folder — used both by `handleChooseProjectFolder` (the `create_new_project`
 * tool's interactive bootstrap round trip) and by the manual "Create Project"
 * command's no-workspace path (`promptOpenWorkspaceForNewProject`). No
 * overwrite check is needed: the server always reserves a fresh, not-yet-
 * existing, slug-named subdirectory under the picked folder for the actual
 * project — it never writes into the picked folder itself, so there is
 * nothing to overwrite.
 */
export async function pickWorkspaceHomeFolder(): Promise<string | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select workspace folder',
    title: 'Kōdo: Select a folder to create the new project in',
  });
  return picked && picked.length > 0 ? picked[0].fsPath : null;
}

/** Show an "open file" dialog restricted to `.code-workspace` files. */
async function pickCodeWorkspaceFile(): Promise<string | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Code Workspace': ['code-workspace'] },
    openLabel: 'Open workspace',
    title: 'Kōdo: Select a .code-workspace file',
  });
  return picked && picked.length > 0 ? picked[0].fsPath : null;
}

/**
 * Poll `controller.isActiveAndReady` until it's true (WS connected + the
 * server's `hello.ack` assigned a session id) or `timeoutMs` elapses. Used
 * right after `newSession()` to know when a freshly opened tab is actually
 * usable for `project.create`, since both connecting and the id assignment
 * are async.
 */
async function waitForSessionReady(controller: SessionController, timeoutMs = 15_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (controller.isActiveAndReady) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return controller.isActiveAndReady;
}

/**
 * Ask for a new project's name and create it inside the current workspace —
 * the has-workspace half of the "Create Project" command, and also what the
 * no-workspace half resumes into post-reload (`resumePendingCreateProjectPrompt`).
 * Sends `project.create` with `{ name }` alone (no `path`): the server
 * reserves a fresh sibling directory under the session's `physical_root` —
 * the identical placement `CreateNewProjectTool`'s has-workspace branch uses
 * (`EngineCore._create_project`, doc/WS_PROTOCOL.md).
 *
 * `project.create` needs an open, foreground, ready session tab to route the
 * request through. If none is open, one is opened here (rather than failing)
 * so "Create Project" works from a bare window with no session tab yet.
 */
async function promptCreateProjectName(): Promise<string | null> {
  let active = findActiveSession();
  if (!active) {
    active = newSession();
    if (!(await waitForSessionReady(active))) {
      vscode.window.showErrorMessage(
        'Kōdo: could not start a new session to create the project in — try again.',
      );
      return null;
    }
  }

  const name = await vscode.window.showInputBox({
    title: 'Kōdo: New project name',
    prompt: 'Creates a new project folder inside the current workspace.',
    placeHolder: 'my-project',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? null : 'Enter a project name.'),
  });
  if (!name || !name.trim()) {
    return null;
  }

  try {
    const resp = await active.createProject({ name: name.trim() });
    if (resp.type === 'project.create.error' || resp.type === 'error') {
      const message = String(resp.message ?? 'unknown error');
      vscode.window.showErrorMessage(`Kōdo: Create Project failed — ${message}`);
      return null;
    }

    const root = String(resp.path ?? '');
    const kodoMd = path.join(root, '.kodo', 'kodo.md');
    if (root && fs.existsSync(kodoMd)) {
      const doc = await vscode.workspace.openTextDocument(kodoMd);
      await vscode.window.showTextDocument(doc);
    }
    vscode.window.showInformationMessage(`Kōdo project initialised at ${root}`);
    return root || null;
  } catch (err) {
    vscode.window.showErrorMessage(`Kōdo: Create Project failed — ${String(err)}`);
    return null;
  }
}

// `globalState` (not `workspaceState`): opening a new workspace folder or
// `.code-workspace` file always reloads the window, and for a currently
// folder-less window that reload abandons `workspaceState` entirely (a new
// workspace identity). This flag is deliberately a plain timestamp rather
// than window-id-scoped: it resumes a UI prompt (ask for a project name),
// not session ownership, so a coarse recency bound is enough and it's kept
// simple on purpose — a resuming window only honors it within
// `PENDING_CREATE_PROJECT_TTL_MS`, long enough to cover this window's own
// reload, short enough that an unrelated window's *own* first `hello.ack`
// (e.g. every open window's control connection reconnecting together after a
// server restart) essentially never lands inside someone else's window.
// (Session continuity itself — a *different* concern — is handled precisely,
// not by recency bound, via `armWindowIdContinuity`.)
const PENDING_CREATE_PROJECT_KEY = 'kodo.pendingCreateProjectArmedAt';
const PENDING_CREATE_PROJECT_TTL_MS = 30_000;

async function armPendingCreateProjectPrompt(): Promise<void> {
  await state.extensionContext?.globalState.update(PENDING_CREATE_PROJECT_KEY, Date.now());
}

/**
 * Called once per activation, after the control connection's `hello.ack`
 * (so `hasWorkspace` and any sticky-tab-restored session are both settled).
 * Consumes the flag `armPendingCreateProjectPrompt` set right before a
 * no-workspace "Create Project" reload, and resumes exactly where the
 * has-workspace path picks up: ask for a name, create it.
 */
export async function resumePendingCreateProjectPrompt(): Promise<void> {
  const armedAt = state.extensionContext?.globalState.get<number>(PENDING_CREATE_PROJECT_KEY);
  if (armedAt === undefined) {
    return;
  }
  await state.extensionContext?.globalState.update(PENDING_CREATE_PROJECT_KEY, undefined);
  if (Date.now() - armedAt > PENDING_CREATE_PROJECT_TTL_MS) {
    return;
  }
  if (state.hasWorkspace) {
    await promptCreateProjectName();
  }
  // No workspace even now (e.g. the user cancelled VS Code's own folder/
  // workspace-open flow after the reload) — nothing to resume into; the
  // flag is already consumed, so re-running the command starts fresh.
}

/**
 * Resolve the key `stableWindowId` will derive its id from once *fileUri* (a
 * `.code-workspace` file) is open: its first declared folder's path if any,
 * resolved relative to the workspace file's own directory (per the
 * `.code-workspace` schema — a bare `path` is relative to the file), else the
 * workspace file's own path (mirroring `stableWindowId`'s `workspaceFile`
 * fallback for a folder-less-but-has-a-workspace-file window). Lets
 * `armWindowIdContinuity` cover this reload too — previously an accepted
 * gap (doc/WS_PROTOCOL.md's old §7.1a), since predicting the post-reload id
 * needed parsing the file and nothing did.
 *
 * Returns `undefined` if the file can't be read or isn't valid JSON — the
 * caller just skips arming continuity for it, same as the old gap.
 */
export function resolveFutureWindowKeyForCodeWorkspace(fileUri: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(fileUri, 'utf8'));
  } catch {
    return undefined;
  }
  const folders = (parsed as { folders?: unknown } | null)?.folders;
  if (Array.isArray(folders) && folders.length > 0) {
    const first = folders[0] as { path?: unknown } | null;
    if (first && typeof first.path === 'string' && first.path) {
      return path.resolve(path.dirname(fileUri), first.path);
    }
  }
  return fileUri;
}

/**
 * No-workspace half of "Create Project": explains why a workspace is needed
 * and offers to open one — a plain folder (added as this window's first
 * workspace folder, reusing the same `addWorkspaceFolder` path
 * `create_new_project`'s bootstrap already uses) or an existing multi-root
 * `.code-workspace` file (a genuine VS Code workspace switch, via the
 * `vscode.openFolder` command — it accepts a workspace-file URI directly).
 * Either way VS Code reloads the window; `resumePendingCreateProjectPrompt`
 * picks the flow back up on the other side.
 */
async function promptOpenWorkspaceForNewProject(): Promise<void> {
  const SELECT_FOLDER = 'Select Folder for New Workspace…';
  const OPEN_WORKSPACE_FILE = 'Open .code-workspace File…';
  const choice = await vscode.window.showInformationMessage(
    'Kōdo needs a workspace to create a project in.',
    {
      modal: true,
      detail:
        'Pick a folder to use as a new workspace, or open an existing multi-root ' +
        '.code-workspace file. VS Code reloads this window into it, then Kōdo asks ' +
        "for the new project's name.",
    },
    SELECT_FOLDER,
    OPEN_WORKSPACE_FILE,
  );

  if (choice === SELECT_FOLDER) {
    const picked = await pickWorkspaceHomeFolder();
    if (!picked) {
      return;
    }
    await armPendingCreateProjectPrompt();
    await addWorkspaceFolder(picked, '');
  } else if (choice === OPEN_WORKSPACE_FILE) {
    const picked = await pickCodeWorkspaceFile();
    if (!picked) {
      return;
    }
    await armPendingCreateProjectPrompt();
    if (state.extensionContext) {
      const futureKey = resolveFutureWindowKeyForCodeWorkspace(picked);
      if (futureKey) {
        await armWindowIdContinuity(state.extensionContext, futureKey);
      }
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(picked), {
      forceReuseWindow: true,
    });
  }
  // 'Cancel' or dismissed: nothing to do.
}

/**
 * Disconnected-session half of "Create Project" (added 2026-07-23): the
 * active session tab is locked but isolated from this window's live
 * workspace (`SessionController.workspaceConnected === false`) — creating a
 * project needs a live matching workspace to add the new folder to, so this
 * offers to reconnect first rather than either silently failing or routing
 * into the unrelated no-workspace flow. On confirmation, arms
 * `armPendingCreateProjectPrompt` (the same marker
 * `promptOpenWorkspaceForNewProject` uses) alongside the reconnect reload,
 * so the name prompt resumes automatically once the window comes back —
 * see the `hello.ack` handler's sequencing note for why session-resume must
 * finish first.
 */
async function promptReconnectForCreateProject(active: SessionController): Promise<null> {
  const sessionId = active.sessionId;
  if (!sessionId) {
    return null;
  }
  const choice = await vscode.window.showWarningMessage(
    'Load the workspace associated with the current Kōdo session?',
    {
      modal: true,
      detail: 'This session is disconnected from its workspace. Creating a project requires reconnecting it first.',
    },
    'Load Workspace',
  );
  if (choice !== 'Load Workspace') {
    return null;
  }
  const remembered = await fetchRememberedWorkspaceFor(sessionId);
  if (!remembered) {
    return null;
  }
  const codeWorkspaceFileExists = Boolean(
    remembered.codeWorkspaceFile && fs.existsSync(remembered.codeWorkspaceFile),
  );
  const target = resumeTarget(remembered, codeWorkspaceFileExists);
  await armPendingCreateProjectPrompt();
  await reloadWindowIntoTarget(sessionId, target);
  return null;
}

/**
 * "Kōdo: Create Project" command. The active session (if any) is locked and
 * disconnected → `promptReconnectForCreateProject` first. Otherwise: a
 * workspace already open → ask only for a project name and create it there.
 * No workspace → `promptOpenWorkspaceForNewProject` (a reload-spanning flow
 * resumed by `resumePendingCreateProjectPrompt`). All paths converge on
 * `promptCreateProjectName`, which opens a session tab of its own if none is
 * open yet.
 */
export async function createProject(): Promise<string | null> {
  const active = findActiveSession();
  if (active && active.workspaceConnected === false) {
    return promptReconnectForCreateProject(active);
  }
  if (state.hasWorkspace) {
    return promptCreateProjectName();
  }
  await promptOpenWorkspaceForNewProject();
  return null;
}

// ---------------------------------------------------------------------------
// prompt.choose_project_folder: the `create_new_project` tool's interactive
// bootstrap path (no project/workspace bound yet, session not autonomous).
// Host-native dialog only, no webview UI involved — same shape as
// `handleApiKeyRequest` in cloud-ai-settings.ts.
// ---------------------------------------------------------------------------

export async function handleChooseProjectFolder(
  requestId: string,
  send: (env: Envelope) => void,
): Promise<void> {
  const picked = await pickWorkspaceHomeFolder();
  if (!picked) {
    send(makeResponse(requestId, { error: 'cancelled' }));
    return;
  }
  send(makeResponse(requestId, { path: picked }));
}
