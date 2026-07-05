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
import { ensureKodoEnvironment, rebuildKodoVenv } from './uv-setup';

const IS_WINDOWS = process.platform === 'win32';

export const DEFAULT_PORT = 9042;

/** Path to the singleton server's discovery file (`~/.kodo/kodo-server`). */
export function discoveryPath(): string {
  return path.join(os.homedir(), '.kodo', 'kodo-server');
}

/**
 * Path to the file capturing the singleton server's raw stdout/stderr
 * (`~/.kodo/logs/server.out.log`).
 *
 * The server's stdio is redirected here (never piped to this extension host) so
 * the process is not tethered to the window that spawned it: on a window reload
 * the fd lives on in the surviving server, and any window's launcher can tail
 * this file into its "Kodo Server" output channel. This is deliberately a
 * *different* file from the server's own structured log (`server.log`, written
 * by its logging FileHandler) so the two never double up on the same records.
 */
export function serverStdoutLogPath(): string {
  return path.join(os.homedir(), '.kodo', 'logs', 'server.out.log');
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
  private tailTimer: ReturnType<typeof setInterval> | null = null;
  private tailPos = 0;

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
   *
   * ``rebuildVenv`` forces a fresh ``~/.kodo/venv`` before setup — used by the
   * caller as startup-failure remediation (a retry after the first attempt to
   * reach the server failed). See ``extension.ts``'s activation flow.
   */
  async launch(port = DEFAULT_PORT, opts: { rebuildVenv?: boolean } = {}): Promise<void> {
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
        // This window did not spawn the server, but it can still surface the
        // shared singleton's logs: follow the log file from its current end.
        this.startTailing(serverStdoutLogPath(), false);
        return;
      }
      this.output.appendLine('[removing stale kodo-server discovery file]');
      try {
        fs.rmSync(discoveryPath());
      } catch {
        /* already gone */
      }
    }

    if (opts.rebuildVenv) {
      this.output.appendLine('[remediation] previous attempt failed — rebuilding kodo venv and retrying');
      rebuildKodoVenv(this.output);
    }

    // The caller (`extension.ts`) owns the single user-facing progress
    // notification spanning the whole startup sequence; this only logs to
    // the output channel.
    const venv = await ensureKodoEnvironment(this.output);

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

    // The server is a global singleton that MUST survive this window reloading
    // or closing (another window may be mid-turn against it, and even this
    // window reconnects and drains its buffered events on reload). Three things
    // make the child independent of this extension host:
    //   1. stdio goes to a log FILE, never a pipe back to us — a piped stdout
    //      is a lifetime tether: when the ext host dies the pipe breaks and the
    //      server dies with it.
    //   2. detached (own process group / setsid on POSIX) + unref() so we hold
    //      no reference to it.
    //   3. The server is ORPHANED at birth: it is spawned through a short-lived
    //      intermediate shell that backgrounds it and exits immediately, so the
    //      server's parent dies at once and it is reparented to PID 1. This is
    //      the critical one: VS Code's extension-host teardown kills the host's
    //      *process tree by walking parent PIDs* (empirically: a detached,
    //      file-stdio, unref'd child spawned directly still received SIGTERM
    //      54 ms after a window reload — its own process group did not protect
    //      it, so the killer follows PPID, and whether the walk sees the child
    //      is a race against the host's own exit). An orphan has PPID 1 before
    //      any teardown can walk to it, which removes the race entirely.
    // The server self-reaps on its own idle timeout once no window is connected,
    // so nothing here ever needs to kill it.
    const logPath = serverStdoutLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    this.output.appendLine(`$ ${python} ${args.join(' ')}`);
    this.output.appendLine(`[server stdout/stderr -> ${logPath}]`);

    if (IS_WINDOWS) {
      // `start "" /b` launches via a transient nested cmd that exits right
      // away, orphaning the python process; redirection happens in the inner
      // cmd so the server owns the log handle, not this host.
      const inner = `""${python}" ${args.join(' ')} > "${logPath}" 2>&1"`;
      this.proc = spawn('cmd.exe', ['/d', '/s', '/c', `start "" /b cmd /d /s /c ${inner}`], {
        stdio: 'ignore',
        detached: false,
        windowsHide: true,
        env: process.env,
      });
    } else {
      // sh truncates+redirects to the log, backgrounds the server, and exits;
      // the server is reparented to PID 1 the moment sh dies. $0 = log path,
      // "$@" = the python command line.
      this.proc = spawn(
        '/bin/sh',
        ['-c', ': > "$0"; exec < /dev/null >> "$0" 2>&1; "$@" &', logPath, python, ...args],
        {
          stdio: 'ignore',
          detached: true,
          windowsHide: true,
          env: process.env,
        },
      );
    }
    this.proc.unref();
    this.proc.on('exit', () => {
      // This is only the short-lived launcher shell exiting (immediately and
      // always 0) — NOT the server. Server startup failures (including the
      // expected exit-1 "lost the launch race" case) surface in the tailed log.
      this.proc = null;
    });

    // Mirror the shared log into the output channel for live debugging.
    this.startTailing(logPath, true);
  }

  /**
   * Release this window's handle on the server WITHOUT killing it.
   *
   * The server is a global singleton shared across every VS Code window and is
   * spawned detached (see {@link launch}); killing it here would break other
   * windows and defeats the whole point of surviving a reload. Lifecycle is the
   * server's own job: it self-reaps on its idle timeout once no window is
   * connected. So we only stop tailing and drop our local reference.
   */
  dispose(): void {
    this.stopTailing();
    this.proc = null;
    this.output.dispose();
  }

  /**
   * Follow *logPath* and mirror appended bytes into the output channel.
   *
   * Polling (rather than ``fs.watch``) keeps this robust across the log file
   * being truncated/recreated when a new server instance starts. ``fromStart``
   * replays the whole file first (the window that just spawned the server);
   * otherwise we begin at the current end (a window reusing an existing server).
   */
  private startTailing(logPath: string, fromStart: boolean): void {
    this.stopTailing();
    try {
      this.tailPos = fromStart ? 0 : fs.statSync(logPath).size;
    } catch {
      this.tailPos = 0;
    }
    const pump = (): void => {
      let size: number;
      try {
        size = fs.statSync(logPath).size;
      } catch {
        return; // log not created yet, or momentarily gone
      }
      if (size < this.tailPos) {
        this.tailPos = 0; // file was truncated (new server instance)
      }
      if (size <= this.tailPos) {
        return;
      }
      try {
        const fd = fs.openSync(logPath, 'r');
        const buf = Buffer.alloc(size - this.tailPos);
        const read = fs.readSync(fd, buf, 0, buf.length, this.tailPos);
        fs.closeSync(fd);
        this.tailPos += read;
        if (read > 0) {
          this.output.append(buf.subarray(0, read).toString('utf8'));
        }
      } catch {
        /* transient read race; next tick retries */
      }
    };
    pump();
    this.tailTimer = setInterval(pump, 500);
  }

  private stopTailing(): void {
    if (this.tailTimer !== null) {
      clearInterval(this.tailTimer);
      this.tailTimer = null;
    }
  }
}
