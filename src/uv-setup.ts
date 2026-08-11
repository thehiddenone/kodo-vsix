/**
 * Ensures the third-party utils Kōdo bundles, the kōdo venv, and the kōdo
 * package are all present *and up to date* before the server subprocess is
 * launched.  Runs on every extension activation; most steps are a no-op when
 * their artifact already exists, except the `py-kodo` version check, which
 * always runs (cheap) so that an extension auto-update also upgrades the
 * `py-kodo` left installed from a previous activation — see
 * `ensureKodoEnvironment` and `maybeUpgradeKodo`.
 *
 * The version check has one hard prerequisite the caller owns: **no
 * kodo-server may be running against `~/.kodo/venv` while `py-kodo` is being
 * replaced.** `ServerLauncher.launch` calls `planKodoUpgrade` before it
 * decides to reuse a live server and shuts that server down first when an
 * upgrade is due; everything in here assumes it succeeded. Concurrent windows
 * are serialised by `withKodoEnvLock`, since an extension update reloads every
 * window at once and N simultaneous `uv pip install`s on one venv is worse
 * than the stale install being fixed.
 *
 * Third-party utils live under ``~/.kodo/bin/``.  Each util gets its own
 * directory with the binary placed directly inside it, plus a sibling JSON
 * manifest recording the pinned version, the absolute binary path, and the URL
 * it was downloaded from:
 *
 *   ~/.kodo/bin/
 *     uv.json                   ← pinned version + path + download_url
 *     uv/uv  (or uv\uv.exe)     ← uv executable
 *     ripgrep.json   ripgrep/rg
 *     fd.json        fd/fd
 *   ~/.kodo/venv/               ← shared Python 3.12 venv
 *
 * These are called **utils** (not "tools") to avoid colliding with the
 * agent-facing tool catalog on the Python side (``kodo.toolspecs``).
 *
 * The extension only installs **uv** (it needs uv to build the venv before the
 * Python backend exists).  ripgrep and fd are installed by the Python backend
 * itself — see ``kodo/bin/_utils.py`` in the kodo repo, which reads/writes the
 * same ``~/.kodo/bin/<util>.json`` manifest.  Both sides check the manifest and
 * only download when missing, so whichever runs first wins and the other is a
 * no-op.  The manifest schema is shared and must stay in sync across the repos.
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { appendDiag as append, logDiag as log } from './diagnostics';
import { state } from './extension/state';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Best-effort description of the singleton kodo-server's tracked state, read
 * directly from its discovery file. Diagnostic-only — never affects control
 * flow, only what gets logged before/after a `py-kodo` upgrade attempt, so
 * "was the server still running against this venv" is answerable from the
 * log alone (a running server can hold OS-level locks on loaded
 * native-extension files on Windows, which can make an in-place upgrade fail
 * — see the call site in `maybeUpgradeKodo`).
 *
 * Duplicates `server-launcher.ts`'s `readServerDiscovery`/`pidAlive` instead
 * of importing them, to avoid a circular module dependency (server-launcher.ts
 * already imports this file).
 */
function describeRunningServer(): string {
  const discPath = path.join(kodoDir(), 'kodo-server');
  let data: { pid?: unknown; port?: unknown };
  try {
    data = JSON.parse(fs.readFileSync(discPath, 'utf-8')) as { pid?: unknown; port?: unknown };
  } catch {
    return 'no discovery file found — no kodo-server appears to be tracked';
  }
  if (typeof data.pid !== 'number') {
    return 'discovery file present but unparseable';
  }
  const port = String(data.port ?? '?');
  try {
    process.kill(data.pid, 0); // signal 0 = existence check
    return `pid=${data.pid} port=${port} — ALIVE (still running against ~/.kodo/venv)`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      return `pid=${data.pid} port=${port} — ALIVE (no signal permission, but process exists)`;
    }
    return `pid=${data.pid} port=${port} — not running (stale discovery file)`;
  }
}

// ---------------------------------------------------------------------------
// Util specs (pinned)
// ---------------------------------------------------------------------------

/**
 * A pinned third-party util installable into ``~/.kodo/bin/<name>/``.
 *
 * `targets` maps a ``"<os>-<arch>"`` platform key (os ∈ darwin/linux/windows,
 * arch ∈ x86_64/aarch64) to the release-target token embedded in the asset
 * filename.  `archiveName` / `downloadUrl` build the GitHub release asset name
 * and URL from the pinned version.
 */
interface UtilSpec {
  name: string;
  version: string;
  /** Unix binary name (``.exe`` is appended on Windows). */
  binary: string;
  targets: Record<string, string>;
  archiveName: (version: string, target: string, ext: ArchiveExt) => string;
  downloadUrl: (version: string, archive: string) => string;
}

type ArchiveExt = 'zip' | 'tar.gz';

const UV_SPEC: UtilSpec = {
  name: 'uv',
  version: '0.11.24',
  binary: 'uv',
  targets: {
    'darwin-x86_64': 'x86_64-apple-darwin',
    'darwin-aarch64': 'aarch64-apple-darwin',
    'linux-x86_64': 'x86_64-unknown-linux-gnu',
    'linux-aarch64': 'aarch64-unknown-linux-gnu',
    'windows-x86_64': 'x86_64-pc-windows-msvc',
    'windows-aarch64': 'aarch64-pc-windows-msvc',
  },
  archiveName: (_v, target, ext) => `uv-${target}.${ext}`,
  downloadUrl: (v, archive) =>
    `https://github.com/astral-sh/uv/releases/download/${v}/${archive}`,
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function kodoDir(): string {
  return path.join(os.homedir(), '.kodo');
}

function binRootDir(): string {
  return path.join(kodoDir(), 'bin');
}

function utilDir(name: string): string {
  return path.join(binRootDir(), name);
}

function utilJsonPath(name: string): string {
  return path.join(binRootDir(), `${name}.json`);
}

function binaryFileName(spec: UtilSpec): string {
  return IS_WINDOWS ? `${spec.binary}.exe` : spec.binary;
}

function utilBinPath(spec: UtilSpec): string {
  return path.join(utilDir(spec.name), binaryFileName(spec));
}

export function kodoVenvDir(): string {
  return path.join(kodoDir(), 'venv');
}

/**
 * Deletes the shared venv so the next {@link ensureKodoEnvironment} call
 * recreates it from scratch.
 *
 * Used as startup-failure remediation (see ``server-launcher.ts``): a corrupt
 * or partially-installed venv is a plausible reason the server process never
 * comes up, and rebuilding is cheap relative to leaving the user stuck.
 */
export function rebuildKodoVenv(out: vscode.OutputChannel): void {
  const venv = kodoVenvDir();
  log(out, `[uv] Rebuilding venv: removing ${venv}`);
  try {
    fs.rmSync(venv, { recursive: true, force: true });
  } catch (e) {
    log(
      out,
      `[uv] Warning: failed to remove venv directory — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Platform → release target
// ---------------------------------------------------------------------------

function platformKey(): string {
  const archMap: Partial<Record<NodeJS.Architecture, string>> = {
    x64: 'x86_64',
    arm64: 'aarch64',
  };
  const arch = archMap[process.arch];
  if (!arch) {
    throw new Error(`Unsupported CPU architecture: ${process.arch}`);
  }
  let osKey: string;
  if (IS_WINDOWS) {
    osKey = 'windows';
  } else if (process.platform === 'darwin') {
    osKey = 'darwin';
  } else if (process.platform === 'linux') {
    osKey = 'linux';
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }
  return `${osKey}-${arch}`;
}

function resolveTarget(spec: UtilSpec): { target: string; ext: ArchiveExt } {
  const key = platformKey();
  const target = spec.targets[key];
  if (!target) {
    throw new Error(`${spec.name}: no release target for platform ${key}`);
  }
  return { target, ext: IS_WINDOWS ? 'zip' : 'tar.gz' };
}

// ---------------------------------------------------------------------------
// <tool>.json manifest (schema shared with kodo/bin/_tools.py)
// ---------------------------------------------------------------------------

interface UtilJson {
  name: string;
  version: string;
  path: string;
  download_url: string;
}

function readUtilJson(name: string): UtilJson | null {
  try {
    return JSON.parse(fs.readFileSync(utilJsonPath(name), 'utf-8')) as UtilJson;
  } catch {
    return null;
  }
}

function writeUtilJson(data: UtilJson): void {
  fs.mkdirSync(binRootDir(), { recursive: true });
  fs.writeFileSync(utilJsonPath(data.name), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Download (https, follows redirects)
// ---------------------------------------------------------------------------

function downloadToFile(url: string, dest: string, out: vscode.OutputChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, hops = 0): void => {
      if (hops > 10) { reject(new Error('Too many HTTP redirects')); return; }
      log(out, `[utils] Downloading ${u}`);
      https.get(u, (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          log(out, `[utils] HTTP ${res.statusCode} redirect -> ${loc}`);
          res.resume();
          follow(loc, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          log(out, `[utils] Download failed: HTTP ${res.statusCode ?? '?'} from ${u}`);
          reject(new Error(`HTTP ${res.statusCode ?? '?'} from ${u}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => { log(out, `[utils] Downloaded to ${dest}`); resolve(); }));
        file.on('error', (e) => { try { fs.unlinkSync(dest); } catch { /* ignore */ } reject(e); });
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

// ---------------------------------------------------------------------------
// Archive extraction
// ---------------------------------------------------------------------------

function findFileInDir(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileInDir(full, name);
      if (found) { return found; }
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

/**
 * Extracts `archivePath` and copies the binary named `execName` (located
 * anywhere in the archive — these archives nest it in a versioned subdir) to
 * `destBinPath`.
 */
function extractArchive(
  archivePath: string,
  ext: ArchiveExt,
  execName: string,
  destBinPath: string,
  out: vscode.OutputChannel,
): Promise<void> {
  const tmpDir = `${archivePath}.tmp`;
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(destBinPath), { recursive: true });

  return new Promise((resolve, reject) => {
    log(out, `[utils] Extracting ${path.basename(archivePath)} (${ext}) -> ${tmpDir}`);

    const onExtracted = (): void => {
      const src = findFileInDir(tmpDir, execName);
      if (!src) {
        log(out, `[utils] ERROR: ${execName} not found anywhere under ${tmpDir}`);
        reject(new Error(`${execName} not found in downloaded archive`));
        return;
      }
      try {
        log(out, `[utils] Found ${execName} at ${src} — copying to ${destBinPath}`);
        fs.copyFileSync(src, destBinPath);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve();
      } catch (e) {
        reject(e);
      }
    };

    let proc: childProcess.ChildProcess;
    if (ext === 'tar.gz') {
      log(out, `[utils] Running: tar -xzf ${archivePath} -C ${tmpDir}`);
      proc = childProcess.spawn('tar', ['-xzf', archivePath, '-C', tmpDir], {
        stdio: 'ignore',
      });
    } else {
      log(out, `[utils] Running: powershell.exe Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}'`);
      proc = childProcess.spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force`],
        { stdio: 'ignore', windowsHide: true },
      );
    }

    proc.on('exit', (code) => {
      log(out, `[utils] Archive extraction exited with code ${String(code)}`);
      if (code === 0) { onExtracted(); }
      else { reject(new Error(`Archive extraction failed (exit ${String(code)})`)); }
    });
    proc.on('error', (e) => {
      log(out, `[utils] Archive extraction process failed to start: ${e.message}`);
      reject(e);
    });
  });
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

/** Substrings in a failed process's stderr that suggest a file held open by
 *  another process — e.g. a still-running kodo-server holding one of the
 *  venv's native-extension (.pyd) files loaded, which Windows locks against
 *  overwrite/deletion (POSIX allows unlinking an open file, so this class of
 *  failure is effectively Windows-only). Purely a logging heuristic — never
 *  changes control flow. */
const LOCK_ERROR_PATTERN = /access is denied|being used by another process|winerror (5|32)|permissionerror|errno 13/i;

function runProcess(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string>,
  out: vscode.OutputChannel,
): Promise<void> {
  return new Promise((resolve, reject) => {
    log(out, `[proc] Running: ${cmd} ${args.join(' ')}${Object.keys(extraEnv).length ? ` (env: ${Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`);
    const proc = childProcess.spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    let stderrBuf = '';
    proc.stdout?.on('data', (d: Buffer) => append(out, d.toString()));
    proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      stderrBuf += s;
      append(out, s);
    });
    proc.on('exit', (code) => {
      log(out, `[proc] ${path.basename(cmd)} exited with code ${String(code)}`);
      if (code === 0) {
        resolve();
        return;
      }
      if (IS_WINDOWS && LOCK_ERROR_PATTERN.test(stderrBuf)) {
        log(
          out,
          `[proc] NOTE: this failure looks like a Windows file-lock error — some process still has a file this command needed to overwrite open. If kodo-server is running against this same venv, that is the most likely holder (see the kodo-server status logged above). Stopping it (or reloading the window, which lets it self-reap) before retrying may resolve it.`,
        );
      }
      reject(new Error(`${path.basename(cmd)} ${args.join(' ')} exited with code ${String(code)}`));
    });
    proc.on('error', (e) => {
      log(out, `[proc] ${path.basename(cmd)} failed to start: ${e.message}`);
      reject(e);
    });
  });
}

/**
 * Wait-before-retry ladder for a failed `uv pip install`.
 *
 * `[0, 1000, 3000]` = three attempts: immediate, then after 1s, then after 3s.
 * uv failures on this path are dominated by *transient* causes — a file still
 * held open by a process that is on its way out (Windows), a half-released
 * lock on `~/.kodo/venv`, an antivirus scanner mid-file, a flaky index request
 * — all of which a second attempt a moment later clears. A cause that is not
 * transient costs 4 extra seconds before the existing fallback path takes
 * over, which is a fair price on a path that only runs when an upgrade is
 * actually due.
 */
export const UV_RETRY_DELAYS_MS: readonly number[] = [0, 1_000, 3_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `attempt` once per entry in `delays`, waiting that entry's delay first,
 * until one resolves. Rethrows the last error if every attempt fails.
 *
 * `onAttempt` is called before each try with the 1-based attempt number and
 * the delay just waited, and `onFailure` after each failed one — the caller
 * owns all logging, so this stays a pure retry primitive (and testable
 * without a VS Code window; see `src/test/uv-setup.test.ts`).
 */
export async function retryAsync<T>(
  attempt: () => Promise<T>,
  delays: readonly number[],
  hooks: {
    onAttempt?: (attemptNo: number, waitedMs: number) => void;
    onFailure?: (attemptNo: number, error: unknown, willRetry: boolean) => void;
    sleepFn?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const sleepFn = hooks.sleepFn ?? sleep;
  let lastError: unknown;
  for (let i = 0; i < delays.length; i++) {
    const waitMs = delays[i];
    if (waitMs > 0) {
      await sleepFn(waitMs);
    }
    hooks.onAttempt?.(i + 1, waitMs);
    try {
      return await attempt();
    } catch (e) {
      lastError = e;
      hooks.onFailure?.(i + 1, e, i < delays.length - 1);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Cross-window environment lock
// ---------------------------------------------------------------------------

/**
 * Path of the advisory lock serialising `~/.kodo/venv` mutation across VS Code
 * windows (`~/.kodo/env.lock`).
 */
function envLockPath(): string {
  return path.join(kodoDir(), 'env.lock');
}

/** A lock older than this is assumed abandoned (crashed window) and broken. */
const ENV_LOCK_STALE_MS = 10 * 60 * 1_000;
/** How long to wait for another window's lock before giving up and proceeding. */
const ENV_LOCK_WAIT_MS = 3 * 60 * 1_000;
const ENV_LOCK_POLL_MS = 500;

/** Re-entrancy depth — `launch()` takes the lock, then calls `ensureKodoEnvironment`. */
let envLockDepth = 0;

/**
 * Runs `fn` holding an advisory cross-window lock on the shared environment.
 *
 * Every VS Code window runs this bootstrap independently, and an extension
 * auto-update reloads *all* of them at once — so without this, N windows can
 * run `uv pip install` against the same `~/.kodo/venv` concurrently, which is
 * a far worse outcome (a half-written venv) than the stale `py-kodo` this
 * change exists to fix. Waiters do not skip their turn: they re-run the checks
 * once they get the lock, which is then a cheap no-op because the window that
 * held it already did the work.
 *
 * Advisory and deliberately forgiving — a lock that cannot be taken never
 * blocks startup outright:
 *   * a lock file older than {@link ENV_LOCK_STALE_MS} is broken and retaken
 *     (its window died mid-bootstrap);
 *   * after {@link ENV_LOCK_WAIT_MS} of waiting we proceed anyway, logging
 *     loudly — a stuck peer must not leave this window without a server.
 * Re-entrant within a process, so nested calls (`launch` → `ensureKodoEnvironment`)
 * share the one acquisition rather than deadlocking.
 */
export async function withKodoEnvLock<T>(out: vscode.OutputChannel, fn: () => Promise<T>): Promise<T> {
  if (envLockDepth > 0) {
    envLockDepth++;
    try {
      return await fn();
    } finally {
      envLockDepth--;
    }
  }

  const lockFile = envLockPath();
  fs.mkdirSync(kodoDir(), { recursive: true });
  const deadline = Date.now() + ENV_LOCK_WAIT_MS;
  let held = false;

  for (;;) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      held = true;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
        log(out, `[lock] Could not create ${lockFile} (${e instanceof Error ? e.message : String(e)}) — proceeding without the lock`);
        break;
      }
    }
    let ageMs: number;
    try {
      ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
    } catch {
      continue; // released between the failed create and the stat — retry immediately
    }
    if (ageMs > ENV_LOCK_STALE_MS) {
      log(out, `[lock] Breaking stale environment lock (${Math.round(ageMs / 1000)}s old) at ${lockFile}`);
      try { fs.unlinkSync(lockFile); } catch { /* someone else won the race */ }
      continue;
    }
    if (Date.now() > deadline) {
      log(out, `[lock] Another window has held ${lockFile} for ${Math.round(ENV_LOCK_WAIT_MS / 1000)}s — proceeding anyway`);
      break;
    }
    await sleep(ENV_LOCK_POLL_MS);
  }

  if (held) {
    log(out, `[lock] Holding environment lock ${lockFile}`);
  }
  envLockDepth++;
  try {
    return await fn();
  } finally {
    envLockDepth--;
    if (held) {
      try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
      log(out, '[lock] Released environment lock');
    }
  }
}

// ---------------------------------------------------------------------------
// Tool installation
// ---------------------------------------------------------------------------

/**
 * Ensures `spec` is installed at ``~/.kodo/bin/<name>/<binary>`` and returns
 * the absolute binary path.  No-op when the manifest already records the pinned
 * version and the binary is present on disk.
 */
async function ensureUtil(spec: UtilSpec, out: vscode.OutputChannel): Promise<string> {
  const meta = readUtilJson(spec.name);
  const binPath = utilBinPath(spec);
  log(
    out,
    `[utils] ${spec.name}: manifest version=${meta?.version ?? '(none)'}, pinned=${spec.version}, ` +
    `manifest binary exists=${meta ? fs.existsSync(meta.path) : false}`,
  );

  if (meta?.version === spec.version && fs.existsSync(meta.path)) {
    log(out, `[utils] ${spec.name} ${spec.version} already present — skipping install`);
    return meta.path;
  }
  log(out, `[utils] ${spec.name} missing or outdated — installing ${spec.version}`);

  const { target, ext } = resolveTarget(spec);
  const archiveName = spec.archiveName(spec.version, target, ext);
  const downloadUrl = spec.downloadUrl(spec.version, archiveName);
  const tmpArchive = path.join(binRootDir(), archiveName);
  log(out, `[utils] ${spec.name}: platform target=${target}, archive=${archiveName}`);

  fs.mkdirSync(utilDir(spec.name), { recursive: true });

  try {
    await downloadToFile(downloadUrl, tmpArchive, out);
    await extractArchive(tmpArchive, ext, binaryFileName(spec), binPath, out);
  } finally {
    try { fs.unlinkSync(tmpArchive); } catch { /* ignore */ }
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(binPath, 0o755);
  }

  writeUtilJson({
    name: spec.name,
    version: spec.version,
    path: binPath,
    download_url: downloadUrl,
  });
  log(out, `[utils] ${spec.name} ${spec.version} installed at ${binPath}`);
  return binPath;
}

// ---------------------------------------------------------------------------
// venv + kodo steps
// ---------------------------------------------------------------------------

async function ensureVenv(uvExec: string, out: vscode.OutputChannel): Promise<string> {
  const venv = kodoVenvDir();
  const cfgPath = path.join(venv, 'pyvenv.cfg');
  const exists = fs.existsSync(cfgPath);
  log(out, `[uv] Venv check: ${cfgPath} exists=${exists}`);
  if (exists) {
    log(out, `[uv] Venv already present at ${venv}`);
    return venv;
  }
  log(out, `[uv] Creating Python 3.12 venv at ${venv}`);
  await runProcess(uvExec, ['venv', '-p', 'python@3.12', venv], {}, out);
  return venv;
}

/** Returns the installed `py-kodo` version, or `null` if it isn't installed. */
export function getInstalledKodoVersion(uvExec: string, venv: string, out: vscode.OutputChannel): string | null {
  log(out, `[uv] Checking installed py-kodo version (${uvExec} pip show py-kodo, VIRTUAL_ENV=${venv})`);
  const r = childProcess.spawnSync(uvExec, ['pip', 'show', 'py-kodo'], {
    env: { ...process.env, VIRTUAL_ENV: venv },
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    log(
      out,
      `[uv] py-kodo not installed (uv pip show exited ${String(r.status)}` +
      `${r.stderr ? `: ${r.stderr.trim()}` : ''})`,
    );
    return null;
  }
  const match = /^Version:\s*(\S+)/m.exec(r.stdout);
  log(out, `[uv] Installed py-kodo version: ${match ? match[1] : '(unparseable "uv pip show" output)'}`);
  return match ? match[1] : null;
}

/**
 * Compares two `major.minor.build`-style version strings component-by-component
 * as numbers. Returns >0 if `a` > `b`, <0 if `a` < `b`, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Reads this extension's own version out of its `package.json`.
 *
 * `kodo-vsix`'s `package.json` "version" is kept in lockstep with the
 * `py-kodo` version it depends on — see `kodo/scripts/post_build.py`, which
 * stamps both from the same `pyproject.toml` value on every kodo release.
 * Reads via `extensionContext.extensionPath` (set as the first line of
 * `activate()`, long before this can be called) rather than a `__dirname`-relative
 * guess, so it stays correct regardless of the bundle's output layout.
 */
function getExtensionVersion(): string {
  const pkgPath = path.join(state.extensionContext!.extensionPath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

/**
 * Installs `py-kodo` for the first time in a venv that doesn't have it yet.
 * In local dev (``KODO_DEV_PATH`` set), installs kodo editable from that
 * checkout. Otherwise installs the published ``py-kodo`` PyPI package,
 * pinned to this extension's own version so the client/server protocol
 * never drifts out of sync. If the pinned version isn't resolvable (e.g. it
 * hasn't reached PyPI's index yet), falls back to the latest ``py-kodo``.
 *
 * For upgrading an *already-installed* `py-kodo` after the extension itself
 * has updated, see {@link maybeUpgradeKodo}.
 */
async function installKodo(uvExec: string, venv: string, out: vscode.OutputChannel): Promise<void> {
  const kodoSrc = process.env['KODO_DEV_PATH'];
  if (kodoSrc) {
    log(out, `[uv] KODO_DEV_PATH=${kodoSrc} — installing kodo editable from that checkout (dev mode)`);
    await pipInstallWithRetries(uvExec, ['-e', kodoSrc], venv, out);
    return;
  }

  const version = getExtensionVersion();
  log(out, `[uv] KODO_DEV_PATH not set — installing py-kodo==${version} from PyPI`);
  try {
    await pipInstallWithRetries(uvExec, [`py-kodo==${version}`], venv, out);
    log(out, `[uv] Installed py-kodo==${version}`);
  } catch (e) {
    log(
      out,
      `[uv] WARNING: py-kodo==${version} install failed (${e instanceof Error ? e.message : String(e)}) — falling back to unpinned py-kodo`,
    );
    await pipInstallWithRetries(uvExec, ['py-kodo'], venv, out);
    log(out, `[uv] Installed latest unpinned py-kodo (pin ${version} unavailable)`);
  }
}

/**
 * Runs `uv pip install <args>` against `venv`, retrying per
 * {@link UV_RETRY_DELAYS_MS}. Rejects with the last attempt's error if every
 * attempt fails, so callers keep their existing catch/fallback behaviour.
 */
async function pipInstallWithRetries(
  uvExec: string,
  args: string[],
  venv: string,
  out: vscode.OutputChannel,
): Promise<void> {
  const label = args.join(' ');
  await retryAsync(
    () => runProcess(uvExec, ['pip', 'install', ...args], { VIRTUAL_ENV: venv }, out),
    UV_RETRY_DELAYS_MS,
    {
      onAttempt: (n, waited) =>
        log(
          out,
          `[uv] uv pip install ${label}: attempt ${n}/${UV_RETRY_DELAYS_MS.length}` +
          (waited > 0 ? ` (after waiting ${waited}ms)` : ''),
        ),
      onFailure: (n, e, willRetry) =>
        log(
          out,
          `[uv] uv pip install ${label}: attempt ${n} FAILED (${e instanceof Error ? e.message : String(e)})` +
          (willRetry ? ' — retrying' : ' — no attempts left'),
        ),
    },
  );
}

/**
 * Upgrades an already-installed `py-kodo` to match this extension's version,
 * when the extension has auto-updated to a newer version than the `py-kodo`
 * left over from a previous activation (the venv/install step is otherwise a
 * no-op once `py-kodo` is present at all — see `ensureKodoEnvironment`).
 *
 * No-ops if `installedVersion` is already >= the extension's own version —
 * this only ever upgrades forward, never downgrades. Never throws: this is
 * best-effort. If the pinned upgrade fails, falls back to the latest
 * unpinned `py-kodo` (mirrors `installKodo`'s fresh-install fallback); if
 * that also fails, logs a warning and leaves the previously-installed
 * version in place so the caller can still launch the server on it.
 *
 * Two things make this more than "run uv and hope":
 *   * every `uv pip install` gets {@link UV_RETRY_DELAYS_MS}' three attempts;
 *   * **success is confirmed by re-reading the installed version**, not by
 *     trusting uv's exit code. The failure that motivated all of this was
 *     silent — extension 0.1.11 alongside a `py-kodo` still on 0.1.9 — so a
 *     0 exit that leaves the old version in place is treated as a failed
 *     attempt and retried like any other.
 *
 * Not called when ``KODO_DEV_PATH`` is set (see `ensureKodoEnvironment`) —
 * dev mode's editable install isn't a PyPI-versioned artifact to compare
 * against or overwrite.
 *
 * Callers must have stopped the running kodo-server first (see
 * `ServerLauncher.launch`): a live server runs Python out of this very venv
 * and, on Windows, holds unbreakable OS-level locks on the loaded
 * native-extension files uv needs to replace.
 */
async function maybeUpgradeKodo(
  uvExec: string,
  venv: string,
  installedVersion: string,
  out: vscode.OutputChannel,
): Promise<void> {
  const extVersion = getExtensionVersion();
  log(out, `[uv] Version check: extension=${extVersion}, installed py-kodo=${installedVersion}`);
  if (compareVersions(extVersion, installedVersion) <= 0) {
    log(out, `[uv] py-kodo ${installedVersion} is already >= extension ${extVersion} — no upgrade needed`);
    return;
  }
  log(
    out,
    `[uv] py-kodo ${installedVersion} is older than extension ${extVersion} — attempting upgrade`,
  );
  log(out, `[uv] kodo-server status: ${describeRunningServer()}`);
  if (IS_WINDOWS) {
    log(
      out,
      '[uv] NOTE (Windows): if kodo-server above is still ALIVE, it is a python.exe process running out ' +
      'of this same venv, and can hold OS-level locks on native-extension (.pyd) files belonging to ' +
      "py-kodo's dependencies. Unlike POSIX, Windows will not let uv overwrite those while the process " +
      'holding them is alive, which can make the upgrade below fail (or partially apply) without an ' +
      'obvious cause. The launcher shuts the server down before getting here, so seeing ALIVE at this ' +
      'point means that shutdown did not take — read the [shutdown] lines above.',
    );
  }
  try {
    await upgradeAttemptWithRetries(uvExec, venv, `py-kodo==${extVersion}`, extVersion, out);
    log(out, `[uv] Upgraded py-kodo ${installedVersion} -> ${extVersion}`);
  } catch (e) {
    log(
      out,
      `[uv] WARNING: py-kodo==${extVersion} upgrade failed (${e instanceof Error ? e.message : String(e)}) — falling back to unpinned py-kodo`,
    );
    try {
      await upgradeAttemptWithRetries(uvExec, venv, 'py-kodo', installedVersion, out);
      log(out, `[uv] Installed latest unpinned py-kodo (pin ${extVersion} unavailable)`);
    } catch (e2) {
      log(
        out,
        `[uv] WARNING: unpinned py-kodo upgrade also failed (${e2 instanceof Error ? e2.message : String(e2)}) — continuing with py-kodo ${installedVersion}`,
      );
    }
  }
}

/**
 * One `uv pip install <requirement>` upgrade attempt, retried per
 * {@link UV_RETRY_DELAYS_MS} — where "attempt succeeded" means uv exited 0
 * **and** `uv pip show` now reports a version at least `expectAtLeast`.
 *
 * `expectAtLeast` is the pinned target for a pinned requirement, and the
 * currently-installed version for the unpinned fallback (which only has to
 * move the version forward — whatever latest happens to be).
 */
async function upgradeAttemptWithRetries(
  uvExec: string,
  venv: string,
  requirement: string,
  expectAtLeast: string,
  out: vscode.OutputChannel,
): Promise<void> {
  await retryAsync(
    async () => {
      await runProcess(uvExec, ['pip', 'install', requirement], { VIRTUAL_ENV: venv }, out);
      const now = getInstalledKodoVersion(uvExec, venv, out);
      if (now === null) {
        throw new Error('uv exited 0 but py-kodo is no longer installed');
      }
      if (compareVersions(now, expectAtLeast) < 0) {
        throw new Error(
          `uv exited 0 but py-kodo is still ${now} (expected >= ${expectAtLeast}) — the install did not take effect`,
        );
      }
      log(out, `[uv] Verified: uv pip show now reports py-kodo ${now}`);
    },
    UV_RETRY_DELAYS_MS,
    {
      onAttempt: (n, waited) =>
        log(
          out,
          `[uv] Upgrade to ${requirement}: attempt ${n}/${UV_RETRY_DELAYS_MS.length}` +
          (waited > 0 ? ` (after waiting ${waited}ms)` : ''),
        ),
      onFailure: (n, e, willRetry) => {
        log(
          out,
          `[uv] Upgrade to ${requirement}: attempt ${n} FAILED (${e instanceof Error ? e.message : String(e)})` +
          (willRetry ? ' — retrying' : ' — no attempts left'),
        );
        if (willRetry) {
          log(out, `[uv] kodo-server status before retry: ${describeRunningServer()}`);
        }
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Ensures uv is installed, the kōdo venv exists, and the kōdo package is
 * present *and up to date* in that venv.  Returns the venv directory path;
 * the caller derives the Python executable from it.
 *
 * Only uv is installed here — the Python backend installs ripgrep and fd on its
 * own startup (see ``kodo/bin/_tools.py``), sharing the ``~/.kodo/bin``
 * manifest convention so a future console-only build works without the
 * extension.
 *
 * Each step is idempotent — repeated calls are fast no-ops when everything is
 * already in place. The one exception is the `py-kodo` version check: it runs
 * on every call (cheap — a single `uv pip show`) so that when the extension
 * auto-updates to a newer version than whatever `py-kodo` was left installed
 * from a previous activation, it upgrades `py-kodo` to match before launching
 * the server — see `maybeUpgradeKodo`. That check only applies when `py-kodo`
 * is already installed (i.e. the venv was set up by a previous activation); a
 * brand-new venv always goes through the plain `installKodo` first-install
 * path instead, pinned to the current extension version.
 *
 * On any failure, logs to `out` and rethrows; this function never shows a
 * user-facing notification itself — the caller (`server-launcher.ts`)
 * owns that, and only after its own rebuild-venv-and-retry remediation has also
 * failed, so the user isn't shown an error for a problem that fixed itself.
 * The `py-kodo` upgrade step is an exception to the rethrow rule: it never
 * throws, since a failed upgrade should still launch the server on the
 * already-installed version rather than block startup (see
 * `maybeUpgradeKodo`).
 */
export async function ensureKodoEnvironment(out: vscode.OutputChannel): Promise<string> {
  return withKodoEnvLock(out, () => ensureKodoEnvironmentLocked(out));
}

async function ensureKodoEnvironmentLocked(out: vscode.OutputChannel): Promise<string> {
  log(out, '[uv] ensureKodoEnvironment: starting (see the "Kodo" output channel for the full step/branch trace)');

  let uvExec: string;
  try {
    uvExec = await ensureUtil(UV_SPEC, out);
  } catch (e) {
    log(
      out,
      `[uv] ERROR: failed to install uv ${UV_SPEC.version} — ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  let venv: string;
  try {
    venv = await ensureVenv(uvExec, out);
  } catch (e) {
    log(
      out,
      `[uv] ERROR: failed to create Python virtual environment — ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  try {
    const installedVersion = getInstalledKodoVersion(uvExec, venv, out);
    const devPath = process.env['KODO_DEV_PATH'];
    if (installedVersion === null) {
      log(out, '[uv] Branch: no py-kodo installation found in venv -> first-time install');
      await installKodo(uvExec, venv, out);
    } else if (!devPath) {
      log(out, `[uv] Branch: py-kodo ${installedVersion} already installed, KODO_DEV_PATH unset -> version check`);
      await maybeUpgradeKodo(uvExec, venv, installedVersion, out);
    } else {
      log(
        out,
        `[uv] Branch: py-kodo ${installedVersion} already installed, KODO_DEV_PATH=${devPath} set -> ` +
        'skipping version check (dev editable install is not PyPI-versioned)',
      );
    }
  } catch (e) {
    log(
      out,
      `[uv] ERROR: failed to install kodo server — ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  log(out, '[uv] ensureKodoEnvironment: done');
  return venv;
}

/** The outcome of {@link planKodoUpgrade}. */
export interface KodoUpgradePlan {
  /** Is the installed `py-kodo` older than this extension? */
  needsUpgrade: boolean;
  /** Installed `py-kodo` version, or `null` if absent/undeterminable. */
  installedVersion: string | null;
  /** This extension's own version. */
  extensionVersion: string;
  /** Human-readable one-liner explaining the verdict — logged by the caller. */
  reason: string;
}

/**
 * Decides — **without changing anything** — whether the `py-kodo` in
 * `~/.kodo/venv` is older than this extension and therefore has to be
 * upgraded before the server is used.
 *
 * This is the check `ServerLauncher.launch` runs *before* it decides to reuse
 * an already-running singleton server, and it is the crux of the whole
 * upgrade-on-extension-update feature. Previously the version check lived
 * only inside `ensureKodoEnvironment`, which `launch()` never reaches when it
 * finds a live server — so on the single most common post-update state
 * (extension auto-updated, window reloaded, the singleton server survived the
 * reload by design) the upgrade was never even attempted, and the backend
 * stayed pinned to the old `py-kodo` until the user happened to close every
 * window long enough for the server to self-reap.
 *
 * Cheap enough for the startup path: one `uv pip show` (~100ms), and it does
 * not install uv — if uv isn't on disk yet there is no venv to judge either,
 * and the caller is about to run the full bootstrap regardless.
 *
 * Never throws; any uncertainty resolves to `needsUpgrade: false`, i.e. leave
 * the running server alone. Restarting the server is disruptive to every
 * other window, so it must only happen on positive evidence.
 */
export function planKodoUpgrade(out: vscode.OutputChannel): KodoUpgradePlan {
  const extensionVersion = (() => {
    try {
      return getExtensionVersion();
    } catch {
      return '';
    }
  })();
  const no = (reason: string): KodoUpgradePlan => ({
    needsUpgrade: false,
    installedVersion: null,
    extensionVersion,
    reason,
  });

  if (!extensionVersion) {
    return no('could not read this extension\'s own version');
  }
  const devPath = process.env['KODO_DEV_PATH'];
  if (devPath) {
    return no(`KODO_DEV_PATH=${devPath} is set — dev editable installs are not PyPI-versioned`);
  }
  const uvMeta = readUtilJson(UV_SPEC.name);
  if (uvMeta === null || !fs.existsSync(uvMeta.path)) {
    return no('uv is not installed yet — nothing has been bootstrapped to upgrade');
  }
  if (!fs.existsSync(path.join(kodoVenvDir(), 'pyvenv.cfg'))) {
    return no('no venv yet — nothing has been bootstrapped to upgrade');
  }

  let installedVersion: string | null;
  try {
    installedVersion = getInstalledKodoVersion(uvMeta.path, kodoVenvDir(), out);
  } catch (e) {
    return no(`could not read the installed py-kodo version (${e instanceof Error ? e.message : String(e)})`);
  }
  if (installedVersion === null) {
    return no('py-kodo is not installed in the venv — this is a first install, not an upgrade');
  }
  if (compareVersions(extensionVersion, installedVersion) <= 0) {
    return {
      needsUpgrade: false,
      installedVersion,
      extensionVersion,
      reason: `py-kodo ${installedVersion} is already >= extension ${extensionVersion}`,
    };
  }
  return {
    needsUpgrade: true,
    installedVersion,
    extensionVersion,
    reason: `py-kodo ${installedVersion} is older than extension ${extensionVersion}`,
  };
}
