/**
 * Pure decision logic for attaching this window to the singleton Kōdo server —
 * extracted from `server-launcher.ts` / `extension/server-lifecycle.ts` so it
 * can be unit tested without a VS Code window, a WebSocket, or a server.
 *
 * Three decisions live here:
 *   1. {@link decideAttach} — given what the discovery file says and what the
 *      OS says about its PID and port: reuse the server, wait for it to exit,
 *      or spawn a new one. Mirrors the server's own start-time rule in
 *      `kodo.server._lifecycle` (doc/STATE_AND_LIFECYCLE.md).
 *   2. {@link connectFailureResponse} — after a failed or dropped control
 *      connection: keep retrying, or relaunch because the server is gone.
 *   3. {@link startFailureAction} — after a genuine start failure: retry
 *      after a pause, rebuild `~/.kodo/venv`, or give up.
 *
 * The distinction 2 vs. 3 is the point of this module: a server that
 * self-reaped (or was shut down) between this window deciding to reuse it and
 * actually connecting is not a broken environment, so it is relaunched for
 * free rather than counted toward a venv rebuild.
 */

/** The discovery file's `state` (absent from files written by older servers). */
export type ServerState = 'starting' | 'serving' | 'stopping';

/** Parsed `~/.kodo/kodo-server`. */
export interface ServerDiscovery {
  pid: number;
  port: number;
  /** `null` for a file that predates the field — judged by PID/port alone. */
  state: ServerState | null;
}

/** A discovery-file read plus the liveness of what it points at. */
export interface ServerProbe {
  discovery: ServerDiscovery | null;
  pidAlive: boolean;
  portBusy: boolean;
}

export type AttachDecision =
  /** A live server this window can connect to (possibly still booting). */
  | 'reuse'
  /** The server has committed to shutting down — wait for it to exit, then spawn. */
  | 'await-exit'
  /** No server (absent or stale file) — spawn one. */
  | 'spawn';

/**
 * Decide what to do about the server the discovery file describes.
 *
 * `serving` with a free port is stale even when the PID is alive: a serving
 * server keeps its port until it has advertised `stopping`, so the PID belongs
 * to an unrelated process that recycled it.
 */
export function decideAttach(probe: ServerProbe): AttachDecision {
  const disc = probe.discovery;
  if (disc === null) {
    return 'spawn';
  }
  const alive = probe.pidAlive || probe.portBusy;
  if (!alive) {
    return 'spawn';
  }
  if (disc.state === 'stopping') {
    return 'await-exit';
  }
  if (disc.state === 'serving' && !probe.portBusy) {
    return 'spawn';
  }
  return 'reuse';
}

/** How this window's most recent `ServerLauncher.launch()` resolved. */
export type LaunchOutcome = 'reused' | 'spawned';

export interface ConnectFailureContext {
  /** {@link decideAttach} said `reuse` right after the failure. */
  serverPresent: boolean;
  /** The control connection has opened at least once since the last launch. */
  connectedSinceLaunch: boolean;
  /** `null` before the first launch has resolved. */
  lastLaunch: LaunchOutcome | null;
}

export type ConnectFailureResponse = 'retry' | 'relaunch';

/**
 * After a failed or dropped control connection: retry, or relaunch?
 *
 * Relaunch only when the server is gone AND this window had a server to lose —
 * it connected to one, or it decided to reuse one. A server this window just
 * spawned and never reached is not "gone", it is still starting (its
 * discovery file may not even exist yet while Python imports) or it failed to
 * start; either way that is for the reconnect budget and
 * {@link startFailureAction} to judge, not a free relaunch.
 */
export function connectFailureResponse(ctx: ConnectFailureContext): ConnectFailureResponse {
  if (ctx.serverPresent) {
    return 'retry';
  }
  if (ctx.connectedSinceLaunch || ctx.lastLaunch === 'reused') {
    return 'relaunch';
  }
  return 'retry';
}

/** Consecutive free relaunches allowed before they count as a start failure. */
export const MAX_FREE_RELAUNCHES = 3;

/** Pause before the plain retry that precedes a venv rebuild. */
export const START_RETRY_DELAY_MS = 3_000;

export type StartFailureAction =
  /** Wait, then launch again exactly as before (no rebuild). */
  | { kind: 'retry'; delayMs: number }
  /** Delete `~/.kodo/venv` and launch on a fresh one. */
  | { kind: 'rebuild' }
  /** Tell the user; nothing automatic is left to try. */
  | { kind: 'give-up' };

/**
 * What to do about the `failureCount`-th consecutive start failure (1-based).
 *
 * A first failure is often transient (a server that was still tearing down, a
 * slow machine), so it gets one plain retry after {@link START_RETRY_DELAY_MS}
 * before the far more disruptive rebuild. Only a failure after the rebuild is
 * surfaced.
 */
export function startFailureAction(failureCount: number): StartFailureAction {
  if (failureCount <= 1) {
    return { kind: 'retry', delayMs: START_RETRY_DELAY_MS };
  }
  if (failureCount === 2) {
    return { kind: 'rebuild' };
  }
  return { kind: 'give-up' };
}
