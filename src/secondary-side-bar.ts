/**
 * Whether this VS Code can host the docked session view: the
 * `viewsContainers.secondarySidebar` contribution point arrived in VS Code
 * 1.106. On anything older the `kodo-session` container does not exist, and
 * VS Code moves the views of a missing container into the Explorer — so
 * activation sets `kodo.dockUnsupported` from this, which hides the view and
 * its commands there (package.json `when` clauses).
 */
export function supportsSecondarySideBar(vscodeVersion: string): boolean {
  const [major, minor] = vscodeVersion.split('.').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }
  return major > 1 || (major === 1 && minor >= 106);
}
