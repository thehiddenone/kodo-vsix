/**
 * Ensures the third-party utils Kōdo bundles, the kōdo venv, and the kōdo
 * package are all present before the server subprocess is launched.  Runs on
 * every extension activation; each step is a no-op when its artifact already
 * exists.
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

const IS_WINDOWS = process.platform === 'win32';

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
      out.appendLine(`[utils] Downloading ${u}`);
      https.get(u, (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          follow(loc, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode ?? '?'} from ${u}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
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
    out.appendLine(`[utils] Extracting ${path.basename(archivePath)}`);

    const onExtracted = (): void => {
      const src = findFileInDir(tmpDir, execName);
      if (!src) {
        reject(new Error(`${execName} not found in downloaded archive`));
        return;
      }
      try {
        fs.copyFileSync(src, destBinPath);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve();
      } catch (e) {
        reject(e);
      }
    };

    let proc: childProcess.ChildProcess;
    if (ext === 'tar.gz') {
      proc = childProcess.spawn('tar', ['-xzf', archivePath, '-C', tmpDir], {
        stdio: 'ignore',
      });
    } else {
      proc = childProcess.spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force`],
        { stdio: 'ignore', windowsHide: true },
      );
    }

    proc.on('exit', (code) => {
      if (code === 0) { onExtracted(); }
      else { reject(new Error(`Archive extraction failed (exit ${String(code)})`)); }
    });
    proc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

function runProcess(
  cmd: string,
  args: string[],
  extraEnv: Record<string, string>,
  out: vscode.OutputChannel,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    proc.stdout?.on('data', (d: Buffer) => out.append(d.toString()));
    proc.stderr?.on('data', (d: Buffer) => out.append(d.toString()));
    proc.on('exit', (code) => {
      if (code === 0) { resolve(); }
      else { reject(new Error(`${path.basename(cmd)} ${args.join(' ')} exited with code ${String(code)}`)); }
    });
    proc.on('error', reject);
  });
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

  if (meta?.version === spec.version && fs.existsSync(meta.path)) {
    out.appendLine(`[utils] ${spec.name} ${spec.version} already present`);
    return meta.path;
  }

  const { target, ext } = resolveTarget(spec);
  const archiveName = spec.archiveName(spec.version, target, ext);
  const downloadUrl = spec.downloadUrl(spec.version, archiveName);
  const tmpArchive = path.join(binRootDir(), archiveName);

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
  out.appendLine(`[utils] ${spec.name} ${spec.version} installed at ${binPath}`);
  return binPath;
}

// ---------------------------------------------------------------------------
// venv + kodo steps
// ---------------------------------------------------------------------------

async function ensureVenv(uvExec: string, out: vscode.OutputChannel): Promise<string> {
  const venv = kodoVenvDir();
  if (fs.existsSync(path.join(venv, 'pyvenv.cfg'))) {
    out.appendLine(`[uv] Venv already present at ${venv}`);
    return venv;
  }
  out.appendLine(`[uv] Creating Python 3.12 venv at ${venv}`);
  await runProcess(uvExec, ['venv', '-p', 'python@3.12', venv], {}, out);
  return venv;
}

function isKodoInstalled(uvExec: string, venv: string): boolean {
  const r = childProcess.spawnSync(uvExec, ['pip', 'show', 'kodo'], {
    env: { ...process.env, VIRTUAL_ENV: venv },
    encoding: 'utf-8',
  });
  return r.status === 0;
}

async function installKodo(uvExec: string, venv: string, out: vscode.OutputChannel): Promise<void> {
  // STUB: kodo is not yet published on PyPI.
  // TODO: replace the args below with ['pip', 'install', 'kodo'] after publish.
  const kodoSrc = process.env['KODO_DEV_PATH'];
  if (!kodoSrc) {
    const msg = 'Kodo: KODO_DEV_PATH environment variable is not set. Cannot install kodo in dev mode.';
    void vscode.window.showErrorMessage(msg);
    throw new Error(msg);
  }
  out.appendLine(`[uv] Installing kodo from ${kodoSrc} (dev stub)`);
  await runProcess(uvExec, ['pip', 'install', '-e', kodoSrc], { VIRTUAL_ENV: venv }, out);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Ensures uv is installed, the kōdo venv exists, and the kōdo package is
 * present in that venv.  Returns the venv directory path; the caller derives
 * the Python executable from it.
 *
 * Only uv is installed here — the Python backend installs ripgrep and fd on its
 * own startup (see ``kodo/bin/_tools.py``), sharing the ``~/.kodo/bin``
 * manifest convention so a future console-only build works without the
 * extension.
 *
 * Each step is idempotent — repeated calls are fast no-ops when everything is
 * already in place.  On any failure, shows an error notification and rethrows
 * so the caller can abort server launch.
 */
export async function ensureKodoEnvironment(out: vscode.OutputChannel): Promise<string> {
  let uvExec: string;
  try {
    uvExec = await ensureUtil(UV_SPEC, out);
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Kodo: failed to install uv ${UV_SPEC.version} — ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  let venv: string;
  try {
    venv = await ensureVenv(uvExec, out);
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Kodo: failed to create Python virtual environment — ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  try {
    if (!isKodoInstalled(uvExec, venv)) {
      await installKodo(uvExec, venv, out);
    }
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Kodo: failed to install kodo server — ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  return venv;
}
