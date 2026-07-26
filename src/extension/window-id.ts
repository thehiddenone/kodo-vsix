/**
 * Stable per-window id derivation + reload-continuity (doc/WS_PROTOCOL.md).
 *
 * The server uses this id to let a briefly-disconnected window reclaim its
 * sessions within the 5s grace (SessionManager.open refuses a *different*
 * window), and per-window session bookkeeping (globalState reopen list) is
 * keyed by it. A reload must therefore present the same id the window held
 * before — see `_stableWindowId`'s doc comment (moved here verbatim) for the
 * full derivation story and the one gap `_recoverWindowIdContinuity` closes.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { state } from './state';

function _newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * A window id that is STABLE across reloads of the same window — including the
 * reload caused by the workspace itself changing shape.
 *
 * The id must be DERIVED, never stored per-workspace: `workspaceState` is
 * per-workspace storage, and the `create_new_project` flow converts a
 * single-folder window into an *untitled multi-root workspace* — a brand-new
 * workspace identity with empty storage. Deriving from the FIRST workspace
 * folder (not `workspaceFile`, not the folder *set*) is what makes the id
 * survive that specific transition on its own: it mints an `untitled:`
 * workspaceFile and appends the new folder, but folders[0] — the folder the
 * window was opened on — is unaffected (both `addWorkspaceFolder` and
 * VS Code's own "Add Folder to Workspace" append at the end).
 *
 * That derivation formula is naturally stable for every reload EXCEPT one:
 * the very first folder ever added to a previously folder-less window, where
 * the id transitions from a `workspaceState`-persisted random value (no
 * folder to derive from yet) to `hash(thatFolder)` — two unrelated strings,
 * no formula bridges them. `_recoverWindowIdContinuity` closes that one gap;
 * see its doc comment for how.
 *
 * Trade-off: two windows whose workspaces share the same first folder would
 * collide (VS Code refuses to open the *same* workspace twice, but a folder
 * can also appear first in a .code-workspace opened elsewhere). That is far
 * rarer than the workspace-shape transition this must survive. Only a truly
 * folder-less window (which cannot host sessions anyway) falls back to a
 * persisted random id.
 */
export function stableWindowId(context: vscode.ExtensionContext): string {
  const firstFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const key = firstFolder ?? vscode.workspace.workspaceFile?.fsPath;
  if (key) {
    const candidate = deriveWindowIdFromKey(key);
    return recoverWindowIdContinuity(context, candidate) ?? candidate;
  }
  const existing = context.workspaceState.get<string>('kodo.windowId');
  if (existing) {
    return existing;
  }
  const id = _newId();
  void context.workspaceState.update('kodo.windowId', id);
  return id;
}

/** Shared derivation formula: must match exactly everywhere a window id is
 * computed from a folder/workspace-file path (`stableWindowId` and
 * `armWindowIdContinuity`'s preview of the post-reload id) — a mismatch
 * here would silently reintroduce the id-instability bug this file exists
 * to close. */
export function deriveWindowIdFromKey(key: string): string {
  return 'w-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function windowIdContinuityStateKey(candidateId: string): string {
  return `kodo.windowIdContinuity.${candidateId}`;
}

/**
 * The local, message-free replacement for the old `window.rebind` WS
 * handshake. Call this BEFORE triggering a reload that will make
 * `stableWindowId` derive a *different* id than the one this window holds
 * right now (today, only the "folder-less window gains its first folder"
 * transition — see `addWorkspaceFolder` and `promptOpenWorkspaceForNewProject`).
 *
 * Previously this problem was closed by telling the SERVER to re-key
 * ownership onto a freshly-computed id, awaited over the WS control
 * connection before the reload. That required the round trip to complete
 * before VS Code tore down the extension host — a race with no hard
 * guarantee, and it needed a dedicated `window.rebind` message + server-side
 * handler + `SessionManager.rebind_window` just to move a value that never
 * needed to change in the first place.
 *
 * This version never changes the id's VALUE at all: it stashes the CURRENT
 * (still-valid) window id in `globalState` — extension-scoped, so unlike
 * `workspaceState` it survives the workspace-identity flip — under a key
 * derived from the id `stableWindowId` will independently (re)compute
 * post-reload. `recoverWindowIdContinuity` looks that key up and, if
 * present, hands back the OLD id verbatim instead of the freshly-derived
 * one. Since the id string itself never changes, the server's ownership map
 * never goes stale and needs no message telling it otherwise — there is
 * nothing to rebind.
 *
 * A plain `globalState.update` is a local, in-process write (no network),
 * so unlike the WS round trip it cannot race the extension-host teardown in
 * any way that matters: by the time this promise resolves, the marker is
 * durable, and the very next line of code is free to trigger the reload.
 */
export async function armWindowIdContinuity(context: vscode.ExtensionContext, futureKey: string): Promise<void> {
  const futureId = deriveWindowIdFromKey(futureKey);
  if (futureId === state.windowId) {
    return; // already the id we'd derive post-reload — nothing to preserve
  }
  await context.globalState.update(windowIdContinuityStateKey(futureId), state.windowId);
}

/**
 * One-shot consumption of a marker `armWindowIdContinuity` left behind.
 * Returns the preserved id if found (and clears the marker), else `undefined`
 * so the caller falls back to `candidate` — the ordinary, no-continuity-
 * needed case (e.g. a folder opened by means other than Kōdo's own
 * bootstrap, where there was never a prior id worth preserving).
 */
function recoverWindowIdContinuity(
  context: vscode.ExtensionContext,
  candidate: string,
): string | undefined {
  const stateKey = windowIdContinuityStateKey(candidate);
  const recovered = context.globalState.get<string>(stateKey);
  if (recovered) {
    void context.globalState.update(stateKey, undefined);
  }
  return recovered;
}
