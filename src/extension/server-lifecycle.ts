/**
 * Singleton-server launch + the "Starting the local Kōdo server…" progress
 * notification spanning environment bootstrap, spawn, and the WebSocket
 * connect (including remediation retries).
 *
 * Two kinds of trouble are told apart here (policy in
 * `server-attach-policy.ts`):
 *   - The server this window had (connected to, or decided to reuse) went
 *     away — it self-reaped, or another window shut it down. Nothing is wrong
 *     with the environment, so it is simply launched again
 *     ({@link relaunchKodoServer}); this does not count as a failure.
 *   - A launch genuinely failed (environment bootstrap threw, or a server
 *     this window spawned never accepted a connection). That escalates:
 *     a plain retry after a pause, then a venv rebuild, then an error dialog
 *     ({@link handleServerStartFailure}).
 */

import * as vscode from 'vscode';
import {
  MAX_FREE_RELAUNCHES,
  connectFailureResponse,
  decideAttach,
  startFailureAction,
} from '../server-attach-policy';
import { probeServer } from '../server-launcher';
import type { FailureVerdict } from '../ws-client';
import { state } from './state';

export const SERVER_STARTUP_DELAY_MS = 1_500;

/**
 * Show the "Starting the local Kōdo server…" progress notification, if not
 * already showing. Spans the whole startup sequence as a single indicator
 * rather than one toast per phase.
 */
export function beginServerStartupProgress(): void {
  if (state.serverStartProgressResolve !== null) {
    return;
  }
  vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Starting local Kōdo server…', cancellable: false },
      (progress) =>
        new Promise<void>((resolve) => {
          state.serverStartProgressReporter = progress;
          state.serverStartProgressResolve = resolve;
        }),
    )
    .then(undefined, () => undefined);
}

export function endServerStartupProgress(): void {
  state.serverStartProgressResolve?.();
  state.serverStartProgressResolve = null;
  state.serverStartProgressReporter = null;
}

/**
 * Show an info-style toast that dismisses itself after 5 seconds, instead of
 * `showInformationMessage`'s notification which stays until the user closes
 * it. A progress notification with no buttons has no such requirement.
 */
export function showTransientNotification(message: string): void {
  void vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title: message, cancellable: false },
      () => new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    )
    .then(undefined, () => undefined);
}

/**
 * Launch the singleton server and, once spawned (or found alive and reused),
 * connect the control WebSocket. A reused server is connected to at once —
 * every moment between deciding to reuse it and connecting is a moment its
 * idle self-reap can fire in — while a fresh spawn gets
 * {@link SERVER_STARTUP_DELAY_MS} to come up. Failure at either step
 * (environment bootstrap throwing, or the server never accepting a
 * connection) routes to {@link handleServerStartFailure}.
 */
export function launchKodoServer(port: number, rebuildVenv = false): void {
  state.serverLaunchInFlight = true;
  state.controlConnectedSinceLaunch = false;
  state.launcher!
    .launch(port, { rebuildVenv })
    .then((outcome) => {
      state.serverLaunchInFlight = false;
      state.lastLaunchOutcome = outcome;
      state.controlClient?.resetAttempts();
      const delay = outcome === 'reused' ? 0 : SERVER_STARTUP_DELAY_MS;
      setTimeout(() => state.controlClient?.connect(), delay);
    })
    .catch((e: unknown) => {
      state.serverLaunchInFlight = false;
      handleServerStartFailure(port, e instanceof Error ? e.message : String(e));
    });
}

/**
 * The control WebSocket's `onFailure` hook: after every failed attempt or
 * dropped connection, decide whether to keep retrying or to relaunch because
 * the server is gone (`connectFailureResponse`).
 */
export async function onControlConnectionFailure(port: number, wasOpen: boolean): Promise<FailureVerdict> {
  if (state.serverLaunchInFlight || state.deactivating) {
    return 'stop'; // the launch in flight connects when it resolves
  }
  const probe = await probeServer();
  const response = connectFailureResponse({
    serverPresent: decideAttach(probe) === 'reuse',
    connectedSinceLaunch: state.controlConnectedSinceLaunch || wasOpen,
    lastLaunch: state.lastLaunchOutcome,
  });
  if (response === 'retry') {
    return 'retry';
  }
  if (state.serverLaunchInFlight) {
    return 'stop'; // another failure started a launch while this one probed
  }
  const disc = probe.discovery;
  const what = disc === null
    ? 'its discovery file is gone'
    : `pid=${disc.pid} is ${disc.state === 'stopping' ? 'shutting down' : 'no longer running'}`;
  relaunchKodoServer(port, `the Kōdo server went away (${what})`);
  return 'stop';
}

/**
 * Launch the server again because the one this window had went away — not
 * a start failure, so no rebuild and no failure count. Bounded by
 * {@link MAX_FREE_RELAUNCHES} consecutive relaunches without a connect, so a
 * server that keeps vanishing still ends up in {@link handleServerStartFailure}.
 */
export function relaunchKodoServer(port: number, reason: string): void {
  if (state.serverLaunchInFlight) {
    return;
  }
  state.freeRelaunches++;
  if (state.freeRelaunches > MAX_FREE_RELAUNCHES) {
    handleServerStartFailure(port, `${reason}, and it kept going away after ${MAX_FREE_RELAUNCHES} relaunches`);
    return;
  }
  state.launcher?.log(`[connect] ${reason} — launching it again (no venv rebuild)`);
  beginServerStartupProgress();
  launchKodoServer(port);
}

/**
 * The server failed to start (either `ensureKodoEnvironment` threw, or the
 * control WebSocket exhausted its reconnect attempts without ever
 * connecting — see `WsClient`'s `onNeverConnected`).
 *
 * Escalates per consecutive failure (`startFailureAction`): first a plain
 * relaunch after a short pause — a transient cause (a server that was still
 * tearing down, a slow machine) is the likeliest and costs nothing to rule
 * out; then a rebuild of `~/.kodo/venv`, since a corrupt or
 * partially-installed venv is the next plausible cause; and only after that
 * do we surface anything to the user. A successful connect resets the count.
 */
export function handleServerStartFailure(port: number, reason: string): void {
  state.serverStartFailures++;
  const action = startFailureAction(state.serverStartFailures);
  state.launcher?.log(`[remediation] start failure #${state.serverStartFailures}: ${reason} — next: ${action.kind}`);
  switch (action.kind) {
    case 'retry':
      beginServerStartupProgress();
      state.serverStartProgressReporter?.report({ message: 'Retrying…' });
      // Held as "in flight" through the pause so a stray connection failure
      // cannot start a second, overlapping launch.
      state.serverLaunchInFlight = true;
      setTimeout(() => launchKodoServer(port), action.delayMs);
      return;
    case 'rebuild':
      beginServerStartupProgress();
      state.serverStartProgressReporter?.report({ message: 'Rebuilding the Python environment and retrying…' });
      launchKodoServer(port, true);
      return;
    case 'give-up':
      endServerStartupProgress();
      void vscode.window.showErrorMessage(
        `Kōdo can't work without the local server. Startup failed even after rebuilding the Python environment (~/.kodo/venv) — ${reason}. See the "Kodo Server" output channel for details.`,
        { modal: true },
      );
      return;
  }
}

/**
 * The control connection opened: the server is up and the environment is
 * fine, so every failure counter starts over, and session tabs whose own
 * reconnect loops gave up (or are deep in their backoff) try again now.
 */
export function onControlConnected(): void {
  state.serverStartFailures = 0;
  state.freeRelaunches = 0;
  state.controlConnectedSinceLaunch = true;
  endServerStartupProgress();
  for (const session of state.sessions.values()) {
    session.reconnectNow();
  }
}
