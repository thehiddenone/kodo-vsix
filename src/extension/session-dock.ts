/**
 * The docked session view: one Kōdo session at a time in VS Code's Secondary
 * Side Bar, next to Chat and the other agents' views. The view is
 * `kodo.sessionView` in the `kodo-session` `secondarySidebar` container
 * (package.json), and needs VS Code 1.106+; older hosts never show it, because
 * activation sets `kodo.dockUnsupported`.
 *
 * The view outlives the sessions shown in it. Each session gets a
 * {@link DockSessionHost} lease on the view, and switching sessions ends one
 * lease and starts the next (`load`). Which session the view shows:
 *   - on resolve (first open, a window reload, the view re-shown after VS Code
 *     disposed it): the one this window last docked — remembered per window id
 *     in globalState, like the open-tab list in window-sessions.ts but on a
 *     key of its own, so the reconcile pass never reopens it as a tab — and
 *     a new session when there is none;
 *   - "New Session": a new session; the previous one is released into history;
 *   - "Open Session from History…": the picked one (`pickSession('dock')`). A
 *     session open in an editor tab here is moved into the dock;
 *   - "Move to Editor Tab": the docked session moves out into a tab and the
 *     dock starts a new one;
 *   - a session that closes itself (deleted, or held by another window): a
 *     new one.
 *
 * Moves use `SessionController.handOff`, which drops the connection without
 * releasing the session, so the server keeps it reserved for this window and
 * the next host reclaims it mid-turn, exactly as across a reload. Loads run one
 * at a time (`queue`) because a move awaits the old host's hand-off before
 * the next host may exist.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { kodoDiagnostics } from '../diagnostics';
import { SessionController } from '../session/controller';
import { DockSessionHost } from '../session/session-host';
import type { SessionDeps } from '../session/types';
import { reconnectSessionWorkspace } from './session-resume';
import { state } from './state';
import { findBySessionId, openExistingSession, sessionDeps } from './window-sessions';

export const SESSION_VIEW_ID = 'kodo.sessionView';

function dockedSessionKey(id: string = state.windowId): string {
  return `kodo.dockedSession.${id}`;
}

function rememberedDockedSession(): string {
  const raw = state.extensionContext?.globalState.get<string>(dockedSessionKey());
  return typeof raw === 'string' ? raw : '';
}

function rememberDockedSession(sessionId: string): void {
  void state.extensionContext?.globalState.update(dockedSessionKey(), sessionId || undefined);
}

export class SessionDock implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private controller: SessionController | null = null;
  /** What to load once the view resolves (a session id, `''` for a new
   *  session); `null` loads the remembered one. */
  private pending: string | null = null;
  private queue: Promise<void> = Promise.resolve();

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(state.extensionContext!.extensionPath, 'dist'))],
    };
    view.onDidDispose(() => this.onViewDisposed(view));
    const sessionId = this.pending ?? this.resumableDockedSession();
    this.pending = null;
    this.enqueue(sessionId);
  }

  /** The remembered docked session — unless it was opened in a tab meanwhile
   *  (the view was not shown since the reload): only an explicit pick moves a
   *  tab into the dock, so the view starts a new session instead. */
  private resumableDockedSession(): string {
    const remembered = rememberedDockedSession();
    return remembered && findBySessionId(remembered) ? '' : remembered;
  }

  /** Show *sessionId* in the dock (`''`: a new session), revealing the view. */
  openSession(sessionId: string): void {
    if (!this.view) {
      // Resolving the view loads it; `<view id>.focus` is the command VS Code
      // registers for every contributed view.
      this.pending = sessionId;
      void vscode.commands.executeCommand(`${SESSION_VIEW_ID}.focus`);
      return;
    }
    this.view.show(false);
    this.enqueue(sessionId);
  }

  /** Move the docked session into an editor tab, and start a new one here. */
  moveToTab(): void {
    this.run(async () => {
      const current = this.controller;
      if (!current) {
        return;
      }
      const sessionId = current.sessionId;
      if (!sessionId) {
        void vscode.window.showInformationMessage('Kōdo: this session is still starting — try again in a moment.');
        return;
      }
      this.controller = null;
      await current.handOff();
      openExistingSession(sessionId);
      await this.load('');
    });
  }

  private enqueue(sessionId: string): void {
    this.run(() => this.load(sessionId));
  }

  private run(step: () => Promise<void>): void {
    this.queue = this.queue.then(step).catch((err: unknown) => {
      kodoDiagnostics().appendLine(`[kodo] docked session view: ${String(err)}`);
    });
  }

  private async load(sessionId: string): Promise<void> {
    const view = this.view;
    if (!view) {
      this.pending = sessionId;
      return;
    }
    const current = this.controller;
    if (current && sessionId !== '' && current.sessionId === sessionId) {
      current.reveal();
      return;
    }
    this.controller = null;
    current?.close();
    const inTab = sessionId ? findBySessionId(sessionId) : undefined;
    if (inTab) {
      await inTab.handOff();
    }
    if (this.view !== view) {
      this.pending = sessionId; // the view went away during the hand-off
      return;
    }
    const controller = new SessionController(this.deps(), new DockSessionHost(view), sessionId);
    this.controller = controller;
    state.sessions.set(controller.key, controller);
  }

  private deps(): SessionDeps {
    return sessionDeps({
      onSessionAssigned: (_c, sessionId) => rememberDockedSession(sessionId),
      onClosed: (c) => this.onControllerClosed(c),
      reconnectWorkspace: (sessionId) => reconnectSessionWorkspace(sessionId, 'dock'),
    });
  }

  private onControllerClosed(c: SessionController): void {
    state.sessions.delete(c.key);
    if (c !== this.controller) {
      return; // the dock replaced or moved it itself
    }
    // The session closed itself — deleted, or held by another window.
    this.controller = null;
    if (!state.deactivating) {
      rememberDockedSession('');
      this.enqueue('');
    }
  }

  /** VS Code disposed the view (e.g. the user hid it). The session is released
   *  like a closed tab but stays remembered, so showing the view again
   *  resumes it. */
  private onViewDisposed(view: vscode.WebviewView): void {
    if (this.view !== view) {
      return;
    }
    this.view = null;
    const c = this.controller;
    this.controller = null;
    c?.close();
  }
}
