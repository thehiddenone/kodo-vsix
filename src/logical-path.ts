/**
 * Pure resolution logic for *logical* paths — extracted so it can be unit
 * tested without a live VS Code window, mirroring the `reconcile-policy.ts` /
 * `workspace-resume-policy.ts` precedent.
 *
 * Every agent-supplied `path` (edit_file/create_file/filesystem/etc, see
 * doc/WS_PROTOCOL.md) is logical: a relative path's first segment names a
 * bound root — a `workspace.folders` key (`buildFolderMap()` in
 * `extension/settings-io.ts`) — and the rest resolves beneath that root's
 * physical path. This mirrors the server's own
 * `kodo.tools._paths.resolve_logical`, which resolves the *same* `folders`
 * map the client pushes it. Resolving instead against the single project
 * root (`getProjectRoot()`) double-counts that root's own folder name in a
 * single-root workspace (`fibonacci-cli/main.py` under project root
 * `.../fibonacci-cli` became `.../fibonacci-cli/fibonacci-cli/main.py`) and
 * picks the wrong root entirely once more than one folder is open.
 */

import * as path from 'path';

/**
 * Resolve a logical path against `folders` (a `buildFolderMap()` snapshot).
 * An absolute path is returned as-is (matches attachment paths, which are
 * already `uri.fsPath`).
 *
 * Returns `null` when `logicalPath` is empty, or relative with a first
 * segment that isn't a known root — e.g. a `temporary: true` scratch-dir
 * path, whose real location the client was never told and can't reconstruct.
 */
export function resolveLogicalPath(folders: Record<string, string>, logicalPath: string): string | null {
  if (!logicalPath) {
    return null;
  }
  if (path.isAbsolute(logicalPath)) {
    return logicalPath;
  }
  const parts = logicalPath.split(/[/\\]/).filter((p) => p.length > 0);
  const base = parts.length > 0 ? folders[parts[0]] : undefined;
  if (base === undefined) {
    return null;
  }
  return path.join(base, ...parts.slice(1));
}
