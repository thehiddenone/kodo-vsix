/**
 * Kōdo server subprocess launcher.
 *
 * For M1 (development): launches ``python -m kodo.server`` from the
 * Python environment on PATH. Production binary download is M7.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as vscode from 'vscode';

export class ServerLauncher {
  private proc: ChildProcess | null = null;

  /**
   * Launch the Kōdo server for ``projectRoot``.
   *
   * @param projectRoot  Absolute path to the Kodo project directory.
   * @param port         WebSocket port (default 9042).
   */
  launch(projectRoot: string, port = 9042): void {
    if (this.proc !== null) {
      return; // already running
    }

    const args = [
      '-m', 'kodo.server',
      '--project', projectRoot,
      '--port', String(port),
      '--log-level', 'DEBUG',
    ];

    this.proc = spawn('python', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      vscode.window.showInformationMessage(`[kodo-server] ${data.toString().trim()}`);
    });

    this.proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      // Server writes structured logs to stderr; show warnings/errors only
      if (msg.includes('ERROR') || msg.includes('WARNING')) {
        vscode.window.showWarningMessage(`[kodo-server] ${msg}`);
      }
    });

    this.proc.on('exit', (code) => {
      this.proc = null;
      if (code !== 0 && code !== null) {
        vscode.window.showErrorMessage(`kodo-server exited with code ${code}`);
      }
    });
  }

  /** Kill the server subprocess if running. */
  dispose(): void {
    if (this.proc !== null) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
