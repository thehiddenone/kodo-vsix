/**
 * Pure decision logic for the post-reload session-reconcile pass
 * (`_reconcileOpenSessions` in extension.ts) — extracted so it can be unit
 * tested without a live VS Code window, WebSocket, or server.
 *
 * These functions carry the correctness of the "create_new_project reload
 * leaves the session stuck" fix (see the `project_kodo_no_workspace_bugs`
 * memory §8): the tab-count guard must NOT defer forever on a dead ghost tab
 * left behind by a workspace-identity-changing reload, but must STILL defer on
 * a genuine background sticky placeholder that will revive on click.
 */

/** What the reconcile pass should do about leftover native `kodoPanel` tabs. */
export type ReconcileTabAction =
  /** Counts are balanced — no un-accounted tab; reconcile normally. */
  | 'proceed'
  /** More native tabs than adopted sessions, but serializer state is live:
   *  those are pending sticky placeholders that revive on click — don't race
   *  them (the serializer will adopt them with the correct session id). */
  | 'defer'
  /** More native tabs than adopted sessions AND serializer state died with the
   *  workspace identity: those tabs are dead ghosts that will never revive —
   *  close them and reconcile from globalState (the only recovery path). */
  | 'close-ghosts';

/**
 * Decide how the reconcile pass should treat leftover native `kodoPanel` tabs,
 * given whether this reload wiped the (workspace-scoped) serializer state and
 * the tab-vs-adopted-session counts.
 *
 * The guard only engages when there are MORE native tabs than adopted
 * sessions; the `serializerStateIsDead` flag is what distinguishes a dead
 * ghost (this reload changed the workspace identity → serializer can't revive
 * it → close and reconcile) from a pending sticky placeholder (ordinary reload
 * → the serializer will adopt it lazily → defer, don't duplicate it).
 */
export function reconcileTabAction(
  serializerStateIsDead: boolean,
  tabCount: number,
  sessionCount: number,
): ReconcileTabAction {
  if (tabCount <= sessionCount) {
    return 'proceed';
  }
  return serializerStateIsDead ? 'close-ghosts' : 'defer';
}

/**
 * Whether adding a workspace folder at index `insertAt` triggers a
 * workspace-identity-changing reload that wipes the webview-panel serializer's
 * (workspace-scoped) state — the condition under which the dead-serializer
 * marker must be armed (see `addWorkspaceFolder`/`_armSerializerDead`).
 *
 * True for the two transitions `updateWorkspaceFolders` reloads the window for:
 * empty→first-folder (`insertAt === 0`) and single-folder→multi-root
 * (`insertAt === 1`). Appending to an already-multi-root workspace
 * (`insertAt >= 2`) does not reload and keeps its serializer state.
 */
export function reloadWipesSerializerState(insertAt: number): boolean {
  return insertAt <= 1;
}

/** What the reconcile pass should do with a single remembered session id, once
 *  the server's `session.list` has been consulted. */
export type ReconcileSessionAction =
  /** The session no longer exists on the server, or is now held by another
   *  live window — drop it from this window's remembered set. */
  | 'forget'
  /** The session exists and is free — reopen it in a fresh tab. */
  | 'reopen';

/**
 * Decide what to do with a remembered session id given the server's view of
 * it: `onServer` is whether `session.list` still reports the id, `taken` is
 * whether a live window currently holds it. A missing OR taken session is
 * forgotten; only a present, free session is reopened.
 */
export function reconcileSessionAction(onServer: boolean, taken: boolean): ReconcileSessionAction {
  return !onServer || taken ? 'forget' : 'reopen';
}
