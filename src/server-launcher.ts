/**
 * Kōdo server subprocess launcher.
 *
 * Calls {@link ensureKodoEnvironment} before spawning the server so that uv,
 * the shared venv (~/.kodo/venv), and the kōdo package are all present.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ensureKodoEnvironment } from './uv-setup';

const IS_WINDOWS = process.platform === 'win32';

export const DEFAULT_PORT = 9042;

/** Path to the singleton server's discovery file (`~/.kodo/kodo-server`). */
export function discoveryPath(): string {
  return path.join(os.homedir(), '.kodo', 'kodo-server');
}

/** Read `{pid, port}` from the discovery file, or null if absent/unparseable. */
export function readServerDiscovery(): { pid: number; port: number } | null {
  try {
    const data = JSON.parse(fs.readFileSync(discoveryPath(), 'utf8')) as {
      pid?: unknown;
      port?: unknown;
    };
    if (typeof data.pid === 'number' && typeof data.port === 'number') {
      return { pid: data.pid, port: data.port };
    }
  } catch {
    /* missing or malformed */
  }
  return null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Probe whether something is listening on a loopback port. */
export function portBusy(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (busy: boolean): void => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

export class ServerLauncher {
  private proc: ChildProcess | null = null;
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel('Kodo Server');
  }

  /**
   * Ensure the kōdo environment is ready, then launch the server for the
   * physical workspace root ``workspaceRoot`` on ``port``.
   *
   * Returns a Promise that resolves once the subprocess has been spawned
   * (environment setup is complete).  The caller should wait for this before
   * attempting a WebSocket connection.
   *
   * API keys are delivered at runtime over the WebSocket via
   * ``api_key.request`` / ``api_key.response`` — never via environment
   * variables.
   */
  async launch(port = DEFAULT_PORT): Promise<void> {
    if (this.proc !== null) {
      return; // we already spawned the singleton from this window
    }

    // Singleton discovery / stale-file protocol: if a live server already holds
    // the discovery file (its port is busy or its PID is alive), reuse it and do
    // not spawn. Only when the file is absent or stale do we launch a new one
    // (the server itself does the authoritative exit-1 race guard).
    const disc = readServerDiscovery();
    if (disc !== null) {
      if ((await portBusy(disc.port)) || pidAlive(disc.pid)) {
        this.output.appendLine(`[reusing kodo-server pid=${disc.pid} port=${disc.port}]`);
        return;
      }
      this.output.appendLine('[removing stale kodo-server discovery file]');
      try {
        fs.rmSync(discoveryPath());
      } catch {
        /* already gone */
      }
    }

    const venv = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Kodo initialization is in progress...',
        cancellable: false,
      },
      () => ensureKodoEnvironment(this.output),
    );

    // Spawn the venv Python directly (no shell wrapper). The server is a global
    // singleton rooted at ~/.kodo — no per-workspace argument.
    const python = IS_WINDOWS
      ? path.join(venv, 'Scripts', 'python.exe')
      : path.join(venv, 'bin', 'python');

    const args = [
      '-m', 'kodo.server',
      '--port', String(port),
      '--log-level', 'DEBUG',
    ];
    // detached=true on POSIX puts the child in its own process group so
    // dispose() can kill the whole group (see dispose() below).
    const detached = !IS_WINDOWS;

    this.output.appendLine(`$ ${python} ${args.join(' ')}`);

    this.proc = spawn(python, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
      env: process.env,
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      this.output.append(data.toString());
    });

    this.proc.stderr?.on('data', (data: Buffer) => {
      this.output.append(data.toString());
    });

    this.proc.on('exit', (code) => {
      this.output.appendLine(`[kodo-server exited with code ${String(code)}]`);
      this.proc = null;
      // Exit code 1 means another window won the launch race and this spawn
      // refused to start a duplicate (server-side discovery guard). That is
      // expected: the WebSocket client just connects to the winner. Only alarm
      // on other non-zero exits.
      if (code !== 0 && code !== 1 && code !== null) {
        void vscode.window
          .showErrorMessage(
            `Kodo server exited with code ${String(code)}.`,
            'Show Output',
          )
          .then((choice) => {
            if (choice === 'Show Output') {
              this.output.show();
            }
          });
      }
    });
  }

  /**
   * Kill the server subprocess and any descendants.
   *
   * - Windows: ``taskkill /PID <pid> /T /F`` walks descendants.
   * - POSIX: ``process.kill(-pid)`` signals the process group (created by
   *   ``detached: true`` at spawn time).
   */
  dispose(): void {
    if (this.proc === null) {
      return;
    }
    const pid = this.proc.pid;
    if (pid === undefined) {
      this.proc.kill();
      this.proc = null;
      return;
    }
    if (IS_WINDOWS) {
      spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // group may already be gone; ignore
      }
    }
    this.proc = null;
    this.output.dispose();
  }
}
