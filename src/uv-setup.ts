/**
 * Ensures uv, the kōdo venv, and the kōdo package are all present before the
 * server subprocess is launched.  Runs on every extension activation; each
 * step is a no-op when its artifact already exists.
 *
 * Directory layout under ~/.kodo/:
 *
 *   ~/.kodo/uv/
 *     uv.json                   ← pinned version metadata
 *     0.11.19/
 *       uv  (or uv.exe)         ← uv executable
 *   ~/.kodo/venv/               ← shared Python 3.12 venv
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const UV_VERSION = '0.11.19';
const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function kodoDir(): string {
  return path.join(os.homedir(), '.kodo');
}

function uvRootDir(): string {
  return path.join(kodoDir(), 'uv');
}

function uvJsonPath(): string {
  return path.join(uvRootDir(), 'uv.json');
}

function uvVersionedDir(version: string): string {
  return path.join(uvRootDir(), version);
}

function uvExecPath(version: string): string {
  return path.join(uvVersionedDir(version), IS_WINDOWS ? 'uv.exe' : 'uv');
}

export function kodoVenvDir(): string {
  return path.join(kodoDir(), 'venv');
}

// ---------------------------------------------------------------------------
// Platform → uv release target
// ---------------------------------------------------------------------------

interface UvTarget {
  target: string;
  ext: 'zip' | 'tar.gz';
}

function getUvTarget(): UvTarget {
  const archMap: Partial<Record<NodeJS.Architecture, string>> = {
    x64: 'x86_64',
    arm64: 'aarch64',
  };
  const arch = archMap[process.arch];
  if (!arch) {
    throw new Error(`Unsupported CPU architecture: ${process.arch}`);
  }
  if (IS_WINDOWS) {
    return { target: `${arch}-pc-windows-msvc`, ext: 'zip' };
  }
  if (process.platform === 'darwin') {
    return { target: `${arch}-apple-darwin`, ext: 'tar.gz' };
  }
  if (process.platform === 'linux') {
    return { target: `${arch}-unknown-linux-gnu`, ext: 'tar.gz' };
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

// ---------------------------------------------------------------------------
// uv.json
// ---------------------------------------------------------------------------

interface UvJson {
  version: string;
  path: string;
  download_url: string;
}

function readUvJson(): UvJson | null {
  try {
    return JSON.parse(fs.readFileSync(uvJsonPath(), 'utf-8')) as UvJson;
  } catch {
    return null;
  }
}

function writeUvJson(data: UvJson): void {
  fs.mkdirSync(uvRootDir(), { recursive: true });
  fs.writeFileSync(uvJsonPath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Download (https, follows redirects)
// ---------------------------------------------------------------------------

function downloadToFile(url: string, dest: string, out: vscode.OutputChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, hops = 0): void => {
      if (hops > 10) { reject(new Error('Too many HTTP redirects')); return; }
      out.appendLine(`[uv] Downloading ${u}`);
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

function extractArchive(
  archivePath: string,
  ext: 'zip' | 'tar.gz',
  destDir: string,
  out: vscode.OutputChannel,
): Promise<void> {
  const execName = IS_WINDOWS ? 'uv.exe' : 'uv';
  const tmpDir = `${archivePath}.tmp`;
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });

  return new Promise((resolve, reject) => {
    out.appendLine(`[uv] Extracting ${path.basename(archivePath)}`);

    const onExtracted = (): void => {
      const src = findFileInDir(tmpDir, execName);
      if (!src) {
        reject(new Error(`${execName} not found in downloaded archive`));
        return;
      }
      try {
        fs.copyFileSync(src, path.join(destDir, execName));
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
// Steps
// ---------------------------------------------------------------------------

async function ensureUv(out: vscode.OutputChannel): Promise<string> {
  const meta = readUvJson();
  const execPath = uvExecPath(UV_VERSION);

  if (meta?.version === UV_VERSION && fs.existsSync(meta.path)) {
    out.appendLine(`[uv] uv ${UV_VERSION} already present`);
    return meta.path;
  }

  const { target, ext } = getUvTarget();
  const archiveName = `uv-${target}.${ext}`;
  const downloadUrl =
    `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archiveName}`;
  const tmpArchive = path.join(uvRootDir(), archiveName);

  fs.mkdirSync(uvRootDir(), { recursive: true });

  try {
    await downloadToFile(downloadUrl, tmpArchive, out);
    await extractArchive(tmpArchive, ext, uvVersionedDir(UV_VERSION), out);
  } finally {
    try { fs.unlinkSync(tmpArchive); } catch { /* ignore */ }
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(execPath, 0o755);
  }

  writeUvJson({ version: UV_VERSION, path: execPath, download_url: downloadUrl });
  out.appendLine(`[uv] uv ${UV_VERSION} installed at ${execPath}`);
  return execPath;
}

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
 * Each step is idempotent — repeated calls are fast no-ops when everything is
 * already in place.  On any failure, shows an error notification and rethrows
 * so the caller can abort server launch.
 */
export async function ensureKodoEnvironment(out: vscode.OutputChannel): Promise<string> {
  let uvExec: string;
  try {
    uvExec = await ensureUv(out);
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Kodo: failed to install uv ${UV_VERSION} — ${e instanceof Error ? e.message : String(e)}`,
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
