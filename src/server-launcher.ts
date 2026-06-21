/**
 * Kōdo server subprocess launcher.
 *
 * Calls {@link ensureKodoEnvironment} before spawning the server so that uv,
 * the shared venv (~/.kodo/venv), and the kōdo package are all present.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ensureKodoEnvironment } from './uv-setup';

const IS_WINDOWS = process.platform === 'win32';

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
  async launch(workspaceRoot: string, port = 9042): Promise<void> {
    if (this.proc !== null) {
      return; // already running
    }

    const venv = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Kodo initialization is in progress...',
        cancellable: false,
      },
      () => ensureKodoEnvironment(this.output),
    );

    // Spawn the venv Python directly (no shell wrapper).
    //
    // Node's spawn() handles argument quoting correctly via CreateProcess on
    // Windows and execvp on POSIX, so workspaceRoot is always passed verbatim.
    // The venv Python already has all packages installed; no activation needed.
    const python = IS_WINDOWS
      ? path.join(venv, 'Scripts', 'python.exe')
      : path.join(venv, 'bin', 'python');

    const args = [
      '-m', 'kodo.server',
      '--workspace', workspaceRoot,
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
      if (code !== 0 && code !== null) {
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
