/**
 * The dedicated **"Kodo"** diagnostic output channel.
 *
 * Carries the full step-by-step trace of everything that happens *around* the
 * server rather than inside it: the uv install, the venv, the `py-kodo`
 * install/upgrade decision tree, and the singleton server's
 * reuse/shutdown/launch flow. Separate from "Kodo Server"
 * (`server-launcher.ts`), which is dominated by the server subprocess's own
 * stdout/stderr tail and would otherwise bury all of it.
 *
 * **The channel is created eagerly at activation, on purpose.** VS Code only
 * lists an output channel in the Output view's dropdown once
 * `createOutputChannel` has actually run, and this channel used to be created
 * lazily on the first line written to it — from a code path that never runs
 * when activation finds a healthy server already up (`ServerLauncher.launch`
 * reuses it and returns early). The result was a channel that appeared on some
 * machines and not others, with no pattern the user could see: it was missing
 * exactly where the singleton server had survived the extension update, which
 * is the norm on Windows (extension update → window reload → server lives on)
 * and the exception on macOS (all windows closed → server self-reaps after its
 * idle grace → next launch runs the whole bootstrap). Nothing platform-specific
 * was ever involved. Create it unconditionally and it is always there to be
 * read, even when the trace is one "reusing the running server" line.
 */

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/**
 * Create the "Kodo" channel and tie it to the extension's lifetime. Called
 * first thing in `activate()`, before anything that logs.
 */
export function initKodoDiagnostics(context: vscode.ExtensionContext): void {
  channel ??= vscode.window.createOutputChannel('Kodo');
  context.subscriptions.push(channel);
  channel.appendLine(`[kodo] Extension activating (${new Date().toISOString()})`);
}

/**
 * The "Kodo" channel, creating it on demand.
 *
 * The fallback creation keeps non-activation callers (and tests) safe; it is
 * not the normal path — see the module docstring on why eager creation in
 * {@link initKodoDiagnostics} is what makes the channel reliably visible.
 */
export function kodoDiagnostics(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('Kodo');
  return channel;
}

/** Reveal the "Kodo" channel in the Output view (the `kodo.showDiagnostics` command). */
export function showKodoDiagnostics(): void {
  kodoDiagnostics().show(true);
}

/** Append a line to both `out` and the "Kodo" channel. */
export function logDiag(out: vscode.OutputChannel, line: string): void {
  out.appendLine(line);
  kodoDiagnostics().appendLine(line);
}

/** Append raw (non-newline-terminated) text to both `out` and "Kodo". */
export function appendDiag(out: vscode.OutputChannel, text: string): void {
  out.append(text);
  kodoDiagnostics().append(text);
}
