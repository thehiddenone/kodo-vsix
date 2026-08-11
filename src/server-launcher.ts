/**
 * Kōdo server subprocess launcher.
 *
 * Calls {@link ensureKodoEnvironment} before spawning the server so that uv,
 * the shared venv (~/.kodo/venv), and the kōdo package are all present.
 *
 * The singleton server is normally never killed by us — it is shared by every
 * window and self-reaps when idle. {@link requestServerShutdown} is the one
 * deliberate exception: when this extension has updated past the `py-kodo` in
 * the venv, the running server is what stops that venv from being upgraded, so
 * it is asked to stop, the backend is upgraded, and a fresh server is spawned
 * on it. Every other window's `WsClient` reconnects to the new one by itself.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { logDiag as log } from './diagnostics';
import { makeRequest, fromJson, toJson } from './envelope';
import { ensureKodoEnvironment, planKodoUpgrade, rebuildKodoVenv, withKodoEnvLock } from './uv-setup';

const IS_WINDOWS = process.platform === 'win32';

/** How long to wait for the server's `server.shutdown.ack`. */
const SHUTDOWN_ACK_TIMEOUT_MS = 20_000;
/** How long to wait for the server process to actually disappear after acking. */
const SHUTDOWN_EXIT_TIMEOUT_MS = 20_000;
/** How long to wait after the SIGTERM fallback before giving up entirely. */
const SHUTDOWN_KILL_TIMEOUT_MS = 5_000;
const SHUTDOWN_POLL_MS = 250;

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

export function pidAlive(pid: number): boolean {
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

/**
 * Ask the running singleton server to shut itself down, and wait until its
 * process is actually gone. Returns `true` if it is.
 *
 * Sent as the `server.shutdown` command (doc/WS_PROTOCOL.md §7.6g) over a
 * throwaway WebSocket rather than the window's own control connection: this
 * runs during `launch()`, long before `WsClient` connects, and the connection
 * we want dead is the one we would be sending on.
 *
 * The ack means "accepted", not "finished" — the server tears down its
 * llama-servers and sessions on the way out — so the completion signal we
 * actually wait for is the process disappearing. Only then is it safe to let
 * uv replace `py-kodo` underneath it (on Windows, a live server holds
 * unbreakable locks on the very files uv must overwrite).
 *
 * Escalates rather than hanging: no ack in time, or an ack from a process
 * that then refuses to exit, falls back to SIGTERM. If even that leaves it
 * alive we return `false` and the caller proceeds anyway — a stale backend is
 * better than an extension that will not start.
 */
export async function requestServerShutdown(
  disc: { pid: number; port: number },
  out: vscode.OutputChannel,
  reason: string,
): Promise<boolean> {
  log(out, `[shutdown] Asking kodo-server pid=${disc.pid} port=${disc.port} to shut down (${reason})`);

  const acked = await sendShutdownCommand(disc.port, reason, out);
  log(out, `[shutdown] server.shutdown ${acked ? 'acknowledged' : 'NOT acknowledged'}`);

  if (await waitForExit(disc, SHUTDOWN_EXIT_TIMEOUT_MS)) {
    log(out, `[shutdown] kodo-server pid=${disc.pid} exited cleanly`);
    return true;
  }

  // Last resort. On POSIX the server's own SIGTERM handler still runs (same
  // graceful path as the command). On Windows Node maps SIGTERM to
  // TerminateProcess — abrupt, no handlers, and the discovery file is left
  // behind; the caller deletes it immediately after, and a killed server's
  // llama-server children are re-adopted by the next server's startup scan.
  log(
    out,
    `[shutdown] kodo-server pid=${disc.pid} is still alive ${SHUTDOWN_EXIT_TIMEOUT_MS / 1000}s after the shutdown request — sending SIGTERM`,
  );
  try {
    process.kill(disc.pid, 'SIGTERM');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      log(out, '[shutdown] Process was already gone');
      return true;
    }
    log(out, `[shutdown] SIGTERM failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (await waitForExit(disc, SHUTDOWN_KILL_TIMEOUT_MS)) {
    log(out, `[shutdown] kodo-server pid=${disc.pid} exited after SIGTERM`);
    return true;
  }
  log(
    out,
    `[shutdown] WARNING: kodo-server pid=${disc.pid} survived SIGTERM. Continuing anyway — an in-place ` +
    'py-kodo upgrade may fail against a venv this process still has files open in (Windows especially).',
  );
  return false;
}

/** Open a one-shot WS, send `server.shutdown`, resolve `true` on its ack. */
function sendShutdownCommand(port: number, reason: string, out: vscode.OutputChannel): Promise<boolean> {
  return new Promise((resolve) => {
    const env = makeRequest('server.shutdown', { reason });
    let settled = false;
    const done = (ok: boolean, note?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (note) {
        log(out, `[shutdown] ${note}`);
      }
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      resolve(ok);
    };

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(
      () => done(false, `No ack within ${SHUTDOWN_ACK_TIMEOUT_MS / 1000}s`),
      SHUTDOWN_ACK_TIMEOUT_MS,
    );

    ws.on('open', () => ws.send(toJson(env)));
    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const reply = fromJson(data.toString());
        if (reply.correlation_id === env.id) {
          done(true, `Server acked: ${JSON.stringify(reply.payload)}`);
        }
      } catch {
        // Not our frame (the server pushes unrelated events) — keep waiting.
      }
    });
    // A close/error before the ack is not necessarily a failure: a server that
    // shuts down fast can drop the socket first. waitForExit is the arbiter.
    ws.on('close', () => done(false, 'Socket closed before an ack arrived'));
    ws.on('error', (e: Error) => done(false, `Shutdown socket error: ${e.message}`));
  });
}

/** Poll until neither the PID nor the port is live, or `timeoutMs` elapses. */
async function waitForExit(disc: { pid: number; port: number }, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!pidAlive(disc.pid) && !(await portBusy(disc.port, SHUTDOWN_POLL_MS))) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_MS));
  }
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
   *
   * Finding a live singleton server is the common case and usually means
   * "reuse it and return". The exception is a server whose ``py-kodo`` this
   * extension has since outgrown: it is asked to stop
   * ({@link requestServerShutdown}), the backend is upgraded, and a fresh
   * server is spawned — see {@link planKodoUpgrade} for why the check has to
   * happen here, before the reuse decision, and not inside
   * {@link ensureKodoEnvironment}.
   */
  async launch(port = DEFAULT_PORT, opts: { rebuildVenv?: boolean } = {}): Promise<void> {
    if (this.proc !== null) {
      return; // we already spawned the singleton from this window
    }
    // The lock spans the reuse decision too, not just the install: after an
    // extension auto-update every window reloads at once, and each one is
    // about to ask "is py-kodo stale?" and possibly restart the server. Held
    // serially, the first window upgrades and relaunches and the rest simply
    // find a current py-kodo and reuse what it started. See `withKodoEnvLock`.
    await withKodoEnvLock(this.output, () => this.launchLocked(port, opts));
  }

  private async launchLocked(port: number, opts: { rebuildVenv?: boolean }): Promise<void> {
    // Singleton discovery / stale-file protocol: if a live server already holds
    // the discovery file (its port is busy or its PID is alive), reuse it and do
    // not spawn. Only when the file is absent or stale do we launch a new one
    // (the server itself does the authoritative exit-1 race guard).
    const disc = readServerDiscovery();
    if (disc !== null) {
      if ((await portBusy(disc.port)) || pidAlive(disc.pid)) {
        // A live server is NOT automatically a server we can keep: it may be
        // running the py-kodo of an extension version we have since replaced.
        // Check before reusing — this is the only path that runs after the
        // common "extension updated, window reloaded, singleton survived"
        // sequence, so a version check that lives further down (inside
        // `ensureKodoEnvironment`, which we would never reach) never fires
        // there at all.
        const plan = planKodoUpgrade(this.output);
        if (!plan.needsUpgrade) {
          log(this.output, `[launch] Reusing kodo-server pid=${disc.pid} port=${disc.port} — ${plan.reason}`);
          // This window did not spawn the server, but it can still surface the
          // shared singleton's logs: follow the log file from its current end.
          this.startTailing(serverStdoutLogPath(), false);
          return;
        }
        log(
          this.output,
          `[launch] ${plan.reason} — the running kodo-server must stop before py-kodo can be upgraded in place`,
        );
        await requestServerShutdown(disc, this.output, `py-kodo upgrade to ${plan.extensionVersion}`);
        // Fall through to the spawn path: `ensureKodoEnvironment` performs the
        // upgrade, then we start a fresh server on the new backend. Other
        // windows' WsClients reconnect to it on their own.
      } else {
        log(this.output, '[launch] Removing stale kodo-server discovery file');
      }
      try {
        fs.rmSync(discoveryPath());
      } catch {
        /* already gone */
      }
    } else {
      log(this.output, '[launch] No kodo-server discovery file — starting a new singleton server');
    }

    if (opts.rebuildVenv) {
      log(this.output, '[remediation] previous attempt failed — rebuilding kodo venv and retrying');
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

    log(this.output, `$ ${python} ${args.join(' ')}`);
    log(this.output, `[server stdout/stderr -> ${logPath}]`);

    if (IS_WINDOWS) {
      // `start "" /b` launches via a transient nested cmd that exits right
      // away, orphaning the python process; redirection happens in the inner
      // cmd so the server owns the log handle, not this host.
      const inner = `""${python}" ${args.join(' ')} > "${logPath}" 2>&1"`;
      this.proc = spawn('cmd.exe', ['/d', '/s', '/c', `start "" /b cmd /d /s /c ${inner}`], {
        stdio: 'ignore',
        detached: false,
        windowsHide: true,
        // cmd.exe's /c parses its command line with its own quoting rules, not
        // CommandLineToArgvW. Without this, Node re-escapes the embedded quotes
        // in the string above (backslash-before-quote) before building the
        // Win32 command line, which cmd.exe then misparses: the whole `start
        // "" /b cmd ...` line is silently swallowed, the launcher shell exits 0
        // having spawned nothing, and no log/discovery file is ever written —
        // surfacing later as a WS-connect timeout with no diagnostic trace.
        windowsVerbatimArguments: true,
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
   * connected. So we only stop tailing and drop our local reference. (The sole
   * place we do stop it on purpose is {@link requestServerShutdown}, on the
   * py-kodo upgrade path — never on window teardown.)
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
