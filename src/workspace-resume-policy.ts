/**
 * Pure decision logic for resuming a session picked via `pickSession()` into
 * its remembered VS Code workspace shape — extracted so it can be unit
 * tested without a live VS Code window, mirroring the `reconcile-policy.ts`
 * precedent. The mechanics (arming continuity/serializer-dead markers,
 * calling `updateWorkspaceFolders`/`vscode.openFolder`) stay in
 * extension.ts; only "what should happen" lives here.
 *
 * Sessions remember their workspace shape server-side (physical root, every
 * open folder, and the `.code-workspace` file if one was used —
 * `kodo.state.TransientStore.workspace_*`, doc/WS_PROTOCOL.md). When the user
 * explicitly resumes a session whose remembered shape doesn't match the
 * current window, that window is reloaded into the remembered workspace
 * (reused, not a new window; folders set exactly, not additively — see the
 * `project_kodo_workspace_session_linkage` memory for the product decisions
 * behind these choices) before the session itself is opened.
 *
 * As of 2026-07-23, "doesn't match" no longer means "isn't byte-identical" —
 * the server computes a looser `compatible` verdict per session
 * (`RememberedWorkspace.compatible`, doc/WS_PROTOCOL.md §7.1b) that's `true`
 * whenever the current workspace can host the session's bound directories at
 * all, even with extra folders open or a different exact folder set on
 * disk. `requiresWorkspaceSwitchConfirmation` gates on that instead of exact
 * match, and declining its confirmation no longer aborts opening the session
 * — it opens disconnected/isolated (`kodo.runtime._engine._core`'s
 * Problem-Solver bound-directory fallback) instead of reloading the window.
 */

/** A session's remembered workspace shape, as returned by `session.list`. */
export interface RememberedWorkspace {
  physicalRoot: string;
  folders: Record<string, string>;
  codeWorkspaceFile: string | null;
  /**
   * True once at least one of this session's folders has earned a checkpoint
   * commit (`kodo`'s `TransientStore.workspace_locked_paths` is non-empty).
   * Server-enforced and irreversible: a locked folder can never again be
   * dropped from `folders`, even if the live VS Code workspace stops
   * reporting it (see `WorkflowEngine.handle_workspace_folders`). Drives two
   * things here: `resumeTarget` ignoring a remembered `.code-workspace` file
   * once locked (see its doc comment) and `requiresWorkspaceSwitchConfirmation`
   * gating the resume confirmation dialog to locked sessions only.
   */
  locked: boolean;
  /**
   * Server-computed (`kodo.state.workspace_shape_compatible`, via
   * `session.list`'s optional `{physical_root, folders}` request payload,
   * doc/WS_PROTOCOL.md §7.1b): whether the *current* window's workspace can
   * host this session's bound directories, even if it isn't byte-identical
   * to the remembered shape (extra folders open, etc.). Only meaningful when
   * `locked` is true — drives `requiresWorkspaceSwitchConfirmation` and the
   * "no reload needed" fast path in `_resumeSessionIntoWorkspace`.
   */
  compatible: boolean;
}

/** What resuming a session should do to the current window's workspace. */
export type ResumeTarget =
  /** Nothing remembered (or an empty shape) — open the session directly, no reload. */
  | { kind: 'none' }
  /** Open this `.code-workspace` file. */
  | { kind: 'file'; path: string }
  /** Replace the workspace's folders with exactly this ordered set. */
  | { kind: 'folders'; entries: Array<[name: string, path: string]> };

/**
 * Decide what a session's remembered workspace should resolve to.
 *
 * `codeWorkspaceFileExists` must be computed by the caller (an
 * `fs.existsSync` check) — this function stays pure/no I/O. A remembered
 * `.code-workspace` file that no longer exists on disk falls back to the
 * folder list rather than erroring (explicit product decision).
 *
 * Once `remembered.locked` is true, the `.code-workspace` file is skipped
 * entirely — even if it exists — and this always resolves to the folder
 * list. A locked folder that's since been edited out of that file on disk
 * would otherwise be silently dropped by reopening via the file, defeating
 * the whole point of the lock; the folder map is the only structure the
 * server's reconciliation (`WorkflowEngine.handle_workspace_folders`)
 * actually guarantees to still contain it.
 */
export function resumeTarget(
  remembered: RememberedWorkspace | null,
  codeWorkspaceFileExists: boolean,
): ResumeTarget {
  if (!remembered || (!remembered.physicalRoot && Object.keys(remembered.folders).length === 0)) {
    return { kind: 'none' };
  }
  if (!remembered.locked && remembered.codeWorkspaceFile && codeWorkspaceFileExists) {
    return { kind: 'file', path: remembered.codeWorkspaceFile };
  }
  return { kind: 'folders', entries: Object.entries(remembered.folders) };
}

/**
 * Whether the current window's workspace already matches `target` — if so,
 * the session can be opened directly with no reload at all. Folder-set
 * matching is order-independent (a same-set-different-order workspace is
 * still a match); which entry becomes `workspaceFolders[0]` after a REAL
 * replace is a separate concern handled by the caller when actually
 * replacing (see `resumeTarget`'s `entries` order, which is preserved from
 * the server's remembered order for that purpose).
 */
export function resumeTargetMatchesCurrent(
  target: ResumeTarget,
  current: { workspaceFile: string | undefined; folderPaths: string[] },
): boolean {
  if (target.kind === 'none') {
    return true;
  }
  if (target.kind === 'file') {
    return current.workspaceFile === target.path;
  }
  const targetPaths = target.entries.map(([, folderPath]) => folderPath);
  if (targetPaths.length !== current.folderPaths.length) {
    return false;
  }
  const a = [...targetPaths].sort();
  const b = [...current.folderPaths].sort();
  return a.every((p, i) => p === b[i]);
}

/**
 * Whether resuming a session needs the user's explicit confirmation before
 * this window's workspace is reloaded.
 *
 * Only sessions with at least one locked folder require it — an unlocked
 * session has no legitimate workspace link to protect yet, so it keeps the
 * pre-existing silent-reopen behaviour (`_resumeSessionIntoWorkspace`).
 *
 * `compatible` (server-computed, `RememberedWorkspace.compatible`) is the
 * gate, not exact identity: a workspace that already hosts every bound
 * directory needs no confirmation (and no reload at all — see
 * `_resumeSessionIntoWorkspace`'s own compatible-fast-path check) even if
 * it isn't byte-identical to what was remembered. This is a strictly wider
 * "no confirmation needed" set than the old exact-match-only check.
 */
export function requiresWorkspaceSwitchConfirmation(locked: boolean, compatible: boolean): boolean {
  return locked && !compatible;
}
