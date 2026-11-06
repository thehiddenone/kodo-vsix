/**
 * System prerequisites the Kōdo server refuses to start without, checked by
 * the launcher *before* it spends minutes bootstrapping uv and the venv.
 *
 * Today that is only `git`: `kodo.server` exits 1 at startup when `git` is
 * not on PATH (`_check_git_on_path` in the kodo repo). Left to the server,
 * that exit surfaced as a WS-connect timeout, a retry, a full venv rebuild,
 * and finally a modal blaming the Python environment — with the one line
 * that named the cause buried in the server log. Amazon Linux (2 and 2023)
 * ships without git, so a fresh Remote-SSH host hit exactly that.
 *
 * The lookup mirrors Python's `shutil.which` (PATH scan, PATHEXT on Windows)
 * rather than running `git --version`: on macOS `/usr/bin/git` is a stub that
 * pops the Command Line Tools installer when *run*, and `shutil.which` — what
 * the server actually checks — finds that stub and passes.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * A prerequisite is missing. Not a start *failure* — retrying or rebuilding
 * the venv cannot fix it — so the caller shows `message` and stops.
 */
export class MissingPrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingPrerequisiteError';
  }
}

/**
 * Absolute path of `name` on `pathVar`, or `null` — `shutil.which` semantics:
 * every PATH entry in order, and on Windows every PATHEXT extension.
 */
export function findOnPath(
  name: string,
  pathVar: string,
  platform: NodeJS.Platform,
  pathExt: string,
  isExecutable: (file: string) => boolean,
): string | null {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const exts = win ? ['', ...pathExt.split(';').filter((e) => e !== '')] : [''];
  for (const dir of pathVar.split(win ? ';' : ':')) {
    if (dir === '') {
      continue;
    }
    for (const ext of exts) {
      const candidate = p.join(dir, name + ext);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function isExecutableFile(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) {
      return false;
    }
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `/etc/os-release` as a key → unquoted-value map (empty if unreadable). */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) {
      out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

/** The command that installs git on this OS, or a generic pointer. */
export function gitInstallHint(platform: NodeJS.Platform, osRelease: Record<string, string>): string {
  if (platform === 'darwin') {
    return 'Install it with `xcode-select --install`.';
  }
  if (platform === 'win32') {
    return 'Install Git for Windows (`winget install Git.Git`).';
  }
  const ids = [osRelease['ID'] ?? '', ...(osRelease['ID_LIKE'] ?? '').split(' ')];
  if (osRelease['ID'] === 'amzn' && osRelease['VERSION_ID'] === '2') {
    return 'Install it with `sudo yum install -y git`.';
  }
  if (ids.some((id) => ['amzn', 'fedora', 'rhel', 'centos'].includes(id))) {
    return 'Install it with `sudo dnf install -y git`.';
  }
  if (ids.some((id) => ['debian', 'ubuntu'].includes(id))) {
    return 'Install it with `sudo apt install -y git`.';
  }
  return "Install it with your distribution's package manager.";
}

function readOsRelease(): Record<string, string> {
  try {
    return parseOsRelease(fs.readFileSync('/etc/os-release', 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Throws {@link MissingPrerequisiteError} when `git` is not on this process's
 * PATH — the same PATH the server inherits (`env: process.env` at spawn).
 * Names the host, since under Remote-SSH "this machine" is ambiguous.
 */
export function assertServerPrerequisites(): void {
  const found = findOnPath(
    'git',
    process.env['PATH'] ?? '',
    process.platform,
    process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD',
    isExecutableFile,
  );
  if (found === null) {
    throw new MissingPrerequisiteError(
      `Kōdo needs git, but it is not on PATH on ${os.hostname()}. ` +
      `${gitInstallHint(process.platform, process.platform === 'linux' ? readOsRelease() : {})} ` +
      'Then click Retry.',
    );
  }
}
