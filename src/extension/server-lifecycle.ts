/**
 * Singleton-server launch + the "Starting the local Kōdo server…" progress
 * notification spanning environment bootstrap, spawn, and the WebSocket
 * connect (including a remediation retry).
 */

import * as vscode from 'vscode';
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
      { location: vscode.ProgressLocation.Notification, title: 'Starting the local Kōdo server…', cancellable: false },
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
 * Launch the singleton server and, once spawned, connect the control
 * WebSocket. Failure at either step (environment bootstrap throwing, or the
 * server never accepting a connection) routes to {@link handleServerStartFailure}.
 */
export function launchKodoServer(port: number, rebuildVenv = false): void {
  state.launcher!
    .launch(port, { rebuildVenv })
    .then(() => {
      setTimeout(() => state.controlClient?.connect(), SERVER_STARTUP_DELAY_MS);
    })
    .catch((e: unknown) => {
      handleServerStartFailure(port, e instanceof Error ? e.message : String(e));
    });
}

/**
 * The server failed to start (either `ensureKodoEnvironment` threw, or the
 * control WebSocket exhausted its reconnect attempts without ever
 * connecting — see `WsClient`'s `onNeverConnected`).
 *
 * First failure: rebuild `~/.kodo/venv` and retry the whole launch once —
 * a corrupt or partially-installed venv is a plausible root cause and is
 * cheap to rule out. Only if that retry also fails do we surface anything
 * to the user; a transient first failure that self-heals should stay quiet.
 */
export function handleServerStartFailure(port: number, reason: string): void {
  if (state.serverStartRemediationAttempted) {
    endServerStartupProgress();
    void vscode.window.showErrorMessage(
      `Kōdo can't work without the local server. Startup failed even after rebuilding the Python environment (~/.kodo/venv) — ${reason}. See the "Kodo Server" output channel for details.`,
      { modal: true },
    );
    return;
  }
  state.serverStartRemediationAttempted = true;
  state.serverStartProgressReporter?.report({ message: 'Rebuilding the Python environment and retrying…' });
  state.controlClient?.resetAttempts();
  launchKodoServer(port, true);
}
