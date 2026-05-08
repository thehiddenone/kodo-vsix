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
   * The Anthropic API key is passed via the child process environment so
   * it is never written to disk (FR-VSIX-04, NFR-06).
   *
   * @param projectRoot  Absolute path to the Kodo project directory.
   * @param port         WebSocket port (default 9042).
   * @param apiKey       Anthropic API key to inject as ANTHROPIC_API_KEY.
   */
  launch(projectRoot: string, port = 9042, apiKey = ''): void {
    if (this.proc !== null) {
      return; // already running
    }

    // Spawn the venv Python directly instead of going through a shell wrapper.
    //
    // The previous approach (cmd.exe /c "call activate.bat && python ..." on
    // Windows, bash -c "source activate && exec python ..." on POSIX) caused
    // argument-quoting bugs: nested double-quotes inside the cmd.exe /c string
    // mangled paths that contained backslashes, stripping drive letters and
    // producing nonsense project roots like "E:\source\kodo\sourcekodo-vsix".
    //
    // Spawning the venv interpreter directly avoids any shell in the middle.
    // Node's spawn() handles argument quoting correctly via CreateProcess on
    // Windows and execvp on POSIX, so projectRoot is always passed verbatim.
    // The venv Python already has all packages installed; no activation needed.
    const python = IS_WINDOWS
      ? `${KODO_VENV_DIR_WIN}\\Scripts\\python.exe`
      : `${KODO_VENV_DIR_POSIX}/bin/python`;

    const cmd = python;
    const args = [
      '-m', 'kodo.server',
      '--project', projectRoot,
      '--port', String(port),
      '--log-level', 'DEBUG',
    ];
    // detached=true on POSIX puts the child in its own process group so
    // dispose() can kill the whole group (see dispose() below).
    const detached = !IS_WINDOWS;

    this.output.appendLine(`$ ${cmd} ${args.join(' ')}`);

    // Pass the API key via environment; it is never written to disk.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (apiKey) {
      childEnv['ANTHROPIC_API_KEY'] = apiKey;
    }

    this.proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached,
      env: childEnv,
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
