/**
 * Client half of `workspace.confirm_folder` (WS_PROTOCOL.md §6.11) — the
 * round-trip that lets the server's `scaffold_new_project` tool wait for a
 * freshly scaffolded directory to actually be open in this window before it
 * returns to the agent.
 *
 * The problem it solves is the window reload. `updateWorkspaceFolders`
 * restarts the extension host whenever it adds a window's *first* folder or
 * turns a single-folder window multi-root (`reloadWipesSerializerState`), and
 * until recently the server only pushed a fire-and-forget `workspace.add_folder`
 * event and let the tool return immediately. The agent would then carry on
 * creating files, running commands and reading roots straight through the
 * restart — against a workspace that was being torn down and rebuilt under it.
 *
 * Surviving the reload needs no durable state for the *reply* itself: the
 * server keeps the request on the `SessionChannel`, so this host simply dies
 * without answering and the request is replayed to the next one, which finds
 * the folder already present and answers at once. The only thing that does not
 * survive is the knowledge that a reload happened at all — hence the small
 * `reloadedForAttach` marker below, whose sole job is to let the reply say
 * `reloaded: true` so the server log can explain a 20-second tool call.
 */

import * as vscode from 'vscode';

import { kodoDiagnostics } from '../diagnostics';
import { reloadWipesSerializerState } from '../reconcile-policy';
import { armSerializerDead } from './window-sessions';
import { armWindowIdContinuity } from './window-id';
import { state } from './state';

/** The answer sent back as the `workspace.confirm_folder` response payload. */
export interface WorkspaceAttachResult {
  /** The directory is genuinely one of this window's workspace folders. */
  attached: boolean;
  /** This attach required an extension-host restart (informational). */
  reloaded: boolean;
  /** Why `attached` is false. Omitted on success. */
  error?: string;
}

/**
 * How long to wait for `onDidChangeWorkspaceFolders` to report the folder
 * before giving up and answering with a failure.
 *
 * Deliberately *below* the server's own `WORKSPACE_ATTACH_TIMEOUT_S` (60s) so
 * that when something goes wrong it is this side — the side that actually
 * knows what VS Code did — that names the failure, rather than the server
 * reporting a bare "timeout". If you raise the server's deadline, raise this
 * one with it and keep the gap.
 */
export const FOLDER_CHANGE_TIMEOUT_MS = 45_000;

/**
 * The server's matching deadline (`EngineCore.WORKSPACE_ATTACH_TIMEOUT_S`),
 * duplicated here only so a test can assert {@link FOLDER_CHANGE_TIMEOUT_MS}
 * stays below it. Nothing reads it at runtime.
 */
export const SERVER_ATTACH_TIMEOUT_MS = 60_000;

/**
 * Shape the `workspace.confirm_folder` response payload.
 *
 * The cross-repo contract, in one place: the server reads `attached` and
 * `reloaded` off this and treats a present `error` as the reason a scaffold
 * could not be shown to the user. `error` is omitted rather than sent as an
 * empty string so a successful attach can never be mistaken for a failed one.
 */
export function attachResponsePayload(
  result: WorkspaceAttachResult,
): Record<string, unknown> {
  return {
    attached: result.attached,
    reloaded: result.reloaded,
    ...(result.error ? { error: result.error } : {}),
  };
}

function reloadedForAttachKey(id: string = state.windowId): string {
  return `kodo.reloadedForAttach.${id}`;
}

/**
 * Remember, across the reload we are about to trigger, that this window
 * restarted in order to take a scaffolded folder. Written under the id this
 * window will still hold afterwards — `windowId` is preserved across both
 * reload-inducing transitions, via continuity for empty→first-folder and via
 * an unchanged `folders[0]` for single→multi-root — exactly like the
 * dead-serializer marker it is armed alongside.
 */
async function armReloadedForAttach(): Promise<void> {
  await state.extensionContext?.globalState.update(reloadedForAttachKey(), true);
}

/** One-shot read-and-clear of the marker. */
async function consumeReloadedForAttach(): Promise<boolean> {
  const armed = state.extensionContext?.globalState.get<boolean>(reloadedForAttachKey()) === true;
  if (armed) {
    await state.extensionContext?.globalState.update(reloadedForAttachKey(), undefined);
  }
  return armed;
}

/** Whether `folderPath` is already one of this window's workspace folders. */
function isOpen(folderPath: string): boolean {
  const target = vscode.Uri.file(folderPath).fsPath;
  return vscode.workspace.workspaceFolders?.some((f) => f.uri.fsPath === target) ?? false;
}

/**
 * Resolve once `folderPath` shows up in `workspace.workspaceFolders`, or after
 * {@link FOLDER_CHANGE_TIMEOUT_MS}. Always disposes its listener.
 */
function waitForFolder(folderPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      subscription.dispose();
      resolve(ok);
    };
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (isOpen(folderPath)) {
        finish(true);
      }
    });
    const timer = setTimeout(() => finish(false), FOLDER_CHANGE_TIMEOUT_MS);
    // The folder can land between the caller's own check and this listener
    // being wired up; re-check rather than wait for an event already fired.
    if (isOpen(folderPath)) {
      finish(true);
    }
  });
}

/**
 * Register `folderPath` as a workspace folder, arming everything the
 * resulting transition needs to survive.
 *
 * The single place both the fire-and-forget `addWorkspaceFolder` and the
 * waited-on {@link confirmWorkspaceFolder} go through, because the arming is
 * load-bearing and must never diverge between them:
 *
 * - Adding a window's FIRST folder restarts the extension host with a new
 *   workspace identity, so `armWindowIdContinuity` (awaited, before the
 *   update) preserves this window's id across it — without which the
 *   post-reload reconcile cannot find this window's remembered sessions.
 * - Both reload-inducing transitions (`reloadWipesSerializerState`) land in a
 *   fresh workspace storage whose webview-panel serializer state is empty, so
 *   `armSerializerDead` marks leftover `kodoPanel` tabs as ghosts to close
 *   rather than placeholders to defer on forever.
 *
 * Caller must have already established that the folder is not open.
 *
 * @param markReloadedForAttach Also arm the `reloaded` flag that
 *   {@link confirmWorkspaceFolder}'s reply reports. Only the confirm path
 *   wants it: a marker armed by an unrelated add would be consumed by the
 *   next confirmation and mis-report why it was slow.
 */
export async function addFolderToWorkspace(
  folderPath: string,
  name: string,
  opts: { markReloadedForAttach: boolean } = { markReloadedForAttach: false },
): Promise<{ accepted: boolean; willReload: boolean }> {
  const insertAt = vscode.workspace.workspaceFolders?.length ?? 0;
  const willReload = reloadWipesSerializerState(insertAt);
  if (insertAt === 0 && state.extensionContext) {
    await armWindowIdContinuity(state.extensionContext, folderPath);
  }
  if (willReload) {
    await armSerializerDead();
    if (opts.markReloadedForAttach) {
      await armReloadedForAttach();
    }
  }
  kodoDiagnostics().appendLine(
    `[kodo] adding workspace folder ${folderPath} at index ${insertAt} (willReload=${willReload})`,
  );
  const accepted = vscode.workspace.updateWorkspaceFolders(
    insertAt,
    0,
    name ? { uri: vscode.Uri.file(folderPath), name } : { uri: vscode.Uri.file(folderPath) },
  );
  return { accepted, willReload };
}

/**
 * Add a server-scaffolded directory to this window's workspace and report
 * whether it is really there.
 *
 * Idempotent by construction, which is what makes the replay path work: an
 * already-open folder answers immediately and touches nothing, so the reloaded
 * host — and any host that receives the request twice because a socket dropped
 * and the server re-sent it — behaves correctly without tracking request ids.
 *
 * When the add triggers a reload this never returns: the extension host is
 * torn down mid-await. That is the expected path, not an error; the same
 * `armSerializerDead` / `armWindowIdContinuity` preparation `addWorkspaceFolder`
 * does is performed here first, so the reload lands in a window that can still
 * find its session.
 */
export async function confirmWorkspaceFolder(
  folderPath: string,
  name: string,
): Promise<WorkspaceAttachResult> {
  const log = kodoDiagnostics();
  if (isOpen(folderPath)) {
    // Either it was already open, or this is the post-reload replay of a
    // request the previous host died holding.
    const reloaded = await consumeReloadedForAttach();
    log.appendLine(`[kodo] workspace.confirm_folder: ${folderPath} already open (reloaded=${reloaded})`);
    return { attached: true, reloaded };
  }

  const { accepted } = await addFolderToWorkspace(folderPath, name, {
    markReloadedForAttach: true,
  });
  if (!accepted) {
    log.appendLine(`[kodo] workspace.confirm_folder: VS Code refused ${folderPath}`);
    // The marker was armed in anticipation of a reload that is now not
    // happening — leaving it would make the NEXT confirmation claim it waited
    // out a restart it never saw.
    await consumeReloadedForAttach();
    return {
      attached: false,
      reloaded: false,
      error: 'VS Code rejected the workspace-folder change',
    };
  }

  // On the reloading path the host is killed somewhere inside this await and
  // the server's replay finishes the job. On the non-reloading path the folder
  // shows up within a tick or two.
  const landed = await waitForFolder(folderPath);
  if (!landed) {
    log.appendLine(`[kodo] workspace.confirm_folder: ${folderPath} never appeared in the workspace`);
    await consumeReloadedForAttach();
    return {
      attached: false,
      reloaded: false,
      error: 'the editor accepted the folder but never reported it as open',
    };
  }
  return { attached: true, reloaded: await consumeReloadedForAttach() };
}
