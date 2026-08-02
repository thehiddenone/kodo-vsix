/**
 * llama.cpp install/update/uninstall/start lifecycle — progress notifications,
 * the window-global running-state mirror (`applyLlamaState`, fed by both the
 * control connection's explicit Start/Stop buttons and any session's
 * auto-started launch), and the info shape the Kōdo Settings panel's
 * "Llama.cpp" section renders.
 */

import * as vscode from 'vscode';
import { makeRequest } from '../envelope';
import type { Envelope } from '../envelope';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { LlamaCppInfo } from '../settings-panel/types';
import { sendControl, sendControlAwait } from './control-send';
import { confirmLocalLlamaLaunch } from './local-llm-registry';
import { state } from './state';

/** Current llama.cpp info as the Kōdo Settings panel's "Llama.cpp" section
 * shape — derived from the same module state the sidebar's llama.cpp
 * controls use. */
export function llamaCppInfoForPanel(): LlamaCppInfo {
  return {
    installedVersion: state.llamaInstalledState && state.llamaVersionState ? state.llamaVersionState : null,
    latestVersion: state.llamaLatestVersionState,
    busy: state.llamaInstallingState,
  };
}

/**
 * Apply an `llama.state` event to the window-global sidebar mirror + progress
 * UI. Called both from the control connection (explicit Start/Stop buttons) and
 * — crucially — from any session connection, because llama.cpp is auto-started
 * inside an engine run, which emits this event on that *session's* socket, not
 * the control socket. Without the session-side forward the "starting…"
 * notification and the sidebar's running state are lost on a prompt-triggered
 * launch. The llama server is a window-wide singleton, so these updates are
 * idempotent no matter which connection delivers them.
 */
export function applyLlamaState(payload: Record<string, unknown>): void {
  if (Boolean(payload.starting)) {
    state.llamaStartingState = true;
    state.llamaRunningState = false;
    state.sidebarProvider?.update({ llamaStarting: true, llamaRunning: false });
    if (state.llamaStartProgressResolve === null) {
      vscode.window
        .withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'llama.cpp is starting…', cancellable: false },
          () => new Promise<void>((resolve) => { state.llamaStartProgressResolve = resolve; }),
        )
        .then(undefined, () => undefined);
    }
    return;
  }

  state.llamaRunningState = Boolean(payload.running);
  state.llamaRunningModelState =
    state.llamaRunningState && typeof payload.model === 'string' ? payload.model : '';
  state.llamaStartingState = false;
  state.llamaStoppingState = false;

  const errMsg = typeof payload.error === 'string' ? payload.error : '';
  if (errMsg) {
    vscode.window.showErrorMessage(`Kōdo: llama-server — ${errMsg}`);
    state.llamaStartProgressResolve?.();
    state.llamaStartProgressResolve = null;
  } else if (state.llamaRunningState) {
    const port = Number(payload.port ?? 8080);
    state.llamaStartProgressResolve?.();
    state.llamaStartProgressResolve = null;
    vscode.window.showInformationMessage(`Kōdo: llama.cpp is running on localhost:${port}`);
  }

  state.sidebarProvider?.update({
    llamaRunning: state.llamaRunningState,
    llamaRunningModel: state.llamaRunningModelState,
    llamaStarting: false,
    llamaStopping: false,
  });
}

/**
 * Start (or restart) llama.cpp for the active local model — gated behind
 * `confirmLocalLlamaLaunch` when that model has outstanding memory/llama.cpp-
 * version warnings. `openSettings` is forwarded straight through to the gate
 * (see its doc comment in local-llm-registry.ts for why it's injected).
 */
export async function startLlamaCpp(openSettings: () => void): Promise<void> {
  if (state.llamaStartingState) { return; }
  if (!(await confirmLocalLlamaLaunch(openSettings))) { return; }
  const isRestart = state.llamaRunningState;
  const notifTitle = isRestart ? 'llama.cpp is restarting…' : 'llama.cpp is starting…';

  state.llamaStartingState = true;
  state.llamaRunningState = false;
  state.sidebarProvider?.update({ llamaRunning: false, llamaStarting: true });
  sendControl(makeRequest('llama.start'));

  vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title: notifTitle, cancellable: false },
      () => new Promise<void>((resolve) => { state.llamaStartProgressResolve = resolve; }),
    )
    .then(undefined, () => undefined);
}

/** Shared by `installLlamaCpp`/`updateLlamaCppToLatest`/
 * `installLlamaCppVersion` — sends *request* and drives the same progress
 * notification + `llamaProgress*` state that `onLlamaProgress` (fed by the
 * `llamacpp.install.progress` event, shared by both `llamacpp.install` and
 * `llamacpp.update`) reports into, regardless of which of the three
 * triggered it. */
function runLlamaCppInstallOp(request: Envelope, title: string): void {
  if (state.llamaInstallingState) { return; }
  state.llamaInstallingState = true;
  state.sidebarProvider?.update({ llamaInstalling: true });
  KodoSettingsPanel.instance?.update({ llamaCpp: llamaCppInfoForPanel() });
  sendControl(request);

  vscode.window
    .withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      (progress) =>
        new Promise<void>((resolve, reject) => {
          state.llamaProgressReporter = progress;
          state.llamaProgressResolve = resolve;
          state.llamaProgressReject = reject;
          state.llamaLastPct = 0;
        }),
    )
    .then(undefined, () => undefined);
}

export function installLlamaCpp(): void {
  runLlamaCppInstallOp(makeRequest('llamacpp.install'), 'Installing llama.cpp');
}

export function updateLlamaCppToLatest(): void {
  runLlamaCppInstallOp(makeRequest('llamacpp.update'), 'Updating llama.cpp to the latest version');
}

export function installLlamaCppVersion(version: string): void {
  runLlamaCppInstallOp(makeRequest('llamacpp.update', { version }), `Installing llama.cpp ${version}`);
}

/** Prompt for a build number (Kōdo Settings panel's "Install specific
 * version" button) and kick off the pinned install. Accepts "b12345" or a
 * bare "12345", normalizing to the "bN" form the wire protocol expects
 * (kodo/doc/WS_PROTOCOL.md §7.6). */
export async function promptInstallLlamaCppVersion(): Promise<void> {
  const raw = await vscode.window.showInputBox({
    title: 'Install a specific llama.cpp version',
    prompt: 'Enter the GitHub release build number (e.g. "b12345" or "12345")',
    placeHolder: 'b12345',
    validateInput: (value) =>
      /^b?\d+$/i.test(value.trim()) ? null : 'Enter a build number, e.g. "b12345" or "12345".',
  });
  if (!raw) {
    return;
  }
  const trimmed = raw.trim();
  const version = /^b/i.test(trimmed) ? trimmed : `b${trimmed}`;
  installLlamaCppVersion(version);
}

/** Uninstall llama.cpp (Kōdo Settings panel's "Uninstall llama.cpp" button).
 * Quick request/response, not a progress stream (`llamacpp.uninstall`,
 * kodo/doc/WS_PROTOCOL.md §7.6) — reuses `llamaInstallingState` as a general
 * "an install-affecting op is in flight" busy flag so the panel's buttons
 * disable the same way they do during an install/update. */
export async function uninstallLlamaCpp(): Promise<void> {
  if (state.llamaInstallingState) { return; }
  state.llamaInstallingState = true;
  state.sidebarProvider?.update({ llamaInstalling: true });
  KodoSettingsPanel.instance?.update({ llamaCpp: llamaCppInfoForPanel() });
  try {
    await sendControlAwait('llamacpp.uninstall');
    state.llamaInstalledState = false;
    state.llamaVersionState = '';
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to uninstall llama.cpp.');
  } finally {
    state.llamaInstallingState = false;
    state.sidebarProvider?.update({
      llamaInstalling: false,
      llamaInstalled: state.llamaInstalledState,
      llamaVersion: state.llamaVersionState,
      llamaRunning: false,
    });
    KodoSettingsPanel.instance?.update({ llamaCpp: llamaCppInfoForPanel() });
  }
}

/** Fetch `llamacpp.version_info` (kodo/doc/WS_PROTOCOL.md §7.6) and fold its
 * `installed_version`/`latest_version` into module state — this is the only
 * place `llamaLatestVersionState` is ever set, and it re-confirms
 * `llamaInstalledState`/`llamaVersionState` more freshly than `hello.ack`
 * did. Returns the documented "unknown" shape (and shows a toast) only on a
 * true WS-unreachable failure — a GitHub-fetch failure is instead reported
 * server-side via the response's own `error` field, which just leaves
 * `latestVersion` `null` here without erroring. */
export async function fetchLlamaCppVersionInfo(): Promise<LlamaCppInfo> {
  try {
    const resp = await sendControlAwait('llamacpp.version_info');
    state.llamaInstalledState = typeof resp.installed_version === 'string';
    state.llamaVersionState = typeof resp.installed_version === 'string' ? resp.installed_version : '';
    state.llamaLatestVersionState = typeof resp.latest_version === 'string' ? resp.latest_version : null;
    return llamaCppInfoForPanel();
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to check llama.cpp versions.');
    return llamaCppInfoForPanel();
  }
}

export function onLlamaProgress(pct: number, msg: string, upToDate: boolean): void {
  if (state.llamaProgressReporter) {
    const increment = Math.max(0, pct - state.llamaLastPct);
    state.llamaLastPct = pct;
    state.llamaProgressReporter.report({ message: `${pct}%  ${msg}`, increment });
  }

  if (pct === 100) {
    state.llamaInstallingState = false;
    state.llamaInstalledState = true;
    state.sidebarProvider?.update({ llamaInstalling: false, llamaInstalled: true });
    KodoSettingsPanel.instance?.update({ llamaCpp: llamaCppInfoForPanel() });
    if (upToDate) {
      // Server short-circuited before touching the install (or the titler) —
      // nothing was actually reinstalled, just surface why.
      vscode.window.showInformationMessage(`Kōdo: ${msg}`);
    }
    // Re-query for the authoritative build number (install/update only know
    // it completed, not which build "latest" resolved to) and refresh the
    // panel's "latest available" line at the same time.
    void fetchLlamaCppVersionInfo().then((llamaCpp) => {
      state.sidebarProvider?.update({ llamaVersion: state.llamaVersionState });
      KodoSettingsPanel.instance?.update({ llamaCpp });
    });
    setTimeout(() => {
      state.llamaProgressResolve?.();
      state.llamaProgressReporter = null;
      state.llamaProgressResolve = null;
      state.llamaProgressReject = null;
    }, 1000);
  } else if (pct < 0) {
    state.llamaInstallingState = false;
    state.sidebarProvider?.update({ llamaInstalling: false });
    KodoSettingsPanel.instance?.update({ llamaCpp: llamaCppInfoForPanel() });
    vscode.window.showErrorMessage(`llama.cpp installation failed: ${msg}`);
    state.llamaProgressReject?.(new Error(msg));
    state.llamaProgressReporter = null;
    state.llamaProgressResolve = null;
    state.llamaProgressReject = null;
  }
}
