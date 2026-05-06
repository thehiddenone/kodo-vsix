/**
 * Kōdo server subprocess launcher.
 *
 * For M1 (development): launches ``python -m kodo.server`` via the kōdo
 * project's venv. Production binary download is M7.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';

// HACK (M1): hard-coded path to the kōdo project's venv.
//
// VS Code's Extension Development Host inherits its environment from the OS
// shell that launched VS Code, which on this developer's machine is *not*
// mise-activated — so neither `python` nor any of the project's installed
// packages (aiohttp, anthropic, mcp, …) are on PATH. Pointing directly at
// the venv's activate script sidesteps this without requiring the user to
// remember to start VS Code from a specific terminal.
//
// This is throwaway scaffolding. It will be replaced in M7 by the proper
// release pipeline: the VSIX downloads a versioned, self-contained
// PyInstaller binary into ~/.kodo/bin/ and launches that directly. At that
// point the developer's local venv is irrelevant and this whole block goes
// away. See PLAN.md M7 / FR-VSIX-02.
const KODO_VENV_DIR_WIN = 'E:\\source\\kodo\\.venv';
const KODO_VENV_DIR_POSIX = `${os.homedir()}/.kodo/.venv`;
const IS_WINDOWS = process.platform === 'win32';

export class ServerLauncher {
  private proc: ChildProcess | null = null;
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel('Kodo Server');
  }

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

    let cmd: string;
    let args: string[];
    let detached: boolean;

    if (IS_WINDOWS) {
      // cmd.exe /c "call activate.bat && python -m kodo.server ..."
      //
      // The whole second argument must be wrapped in literal quotes so cmd
      // sees it as one /c command. Node.js normally escapes embedded quotes
      // with backslashes, which cmd doesn't understand — hence the
      // ``windowsVerbatimArguments`` flag below.
      const activate = `${KODO_VENV_DIR_WIN}\\Scripts\\activate.bat`;
      cmd = 'cmd.exe';
      args = [
        '/c',
        `"call "${activate}" && python -m kodo.server ` +
          `--project "${projectRoot}" --port ${port} --log-level DEBUG"`,
      ];
      detached = false;
    } else {
      // bash -c "source activate && exec python -m kodo.server ..."
      // `detached: true` puts the child in its own process group so we can
      // kill the entire group on dispose (POSIX equivalent of taskkill /T).
      // `exec` replaces the bash process with python so killing the group
      // reliably terminates python.
      const activate = `${KODO_VENV_DIR_POSIX}/bin/activate`;
      cmd = 'bash';
      args = [
        '-c',
        `. "${activate}" && exec python -m kodo.server ` +
          `--project "${projectRoot}" --port ${port} --log-level DEBUG`,
      ];
      detached = true;
    }

    this.output.appendLine(`$ ${cmd} ${args.join(' ')}`);

    this.proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
      // Windows: keep our manual quoting in the cmd.exe /c argument intact.
      // Without this, Node escapes embedded ``"`` as ``\"`` and cmd fails
      // to parse the activation path.
      windowsVerbatimArguments: IS_WINDOWS,
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      this.output.append(data.toString());
    });

    this.proc.stderr?.on('data', (data: Buffer) => {
      this.output.append(data.toString());
    });

    this.proc.on('exit', (code) => {
      this.output.appendLine(`[kodo-server exited with code ${code}]`);
      this.proc = null;
      if (code !== 0 && code !== null) {
        vscode.window
          .showErrorMessage(
            `Kodo server exited with code ${code}.`,
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
   * The shell wrapper means a plain ``proc.kill()`` only terminates the
   * shell — the python child survives and keeps the WS port bound, breaking
   * the next launch. We kill the whole process tree:
   *   - Windows: ``taskkill /PID <pid> /T /F`` walks descendants.
   *   - POSIX: ``process.kill(-pid)`` signals the process group (created
   *     by ``detached: true`` at spawn time).
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
