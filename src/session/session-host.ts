/**
 * Where a session's webview lives. A {@link SessionController} drives the same
 * Preact app (`dist/webview.js`) in one of two places:
 *   - a native editor tab — {@link PanelSessionHost} over a `WebviewPanel`;
 *   - the Secondary Side Bar's docked session view — {@link DockSessionHost}
 *     over the `kodo.sessionView` `WebviewView` (see
 *     `src/extension/session-dock.ts`).
 *
 * The two differ in lifetime: a tab IS its session (closing one closes the
 * other), whereas the docked view outlives the sessions shown in it — the dock
 * swaps sessions in and out of one view. A `DockSessionHost` is therefore
 * one session's lease on that view: `close()` ends the lease (detaching every
 * listener it added) and leaves the view itself alone.
 */

import * as vscode from 'vscode';

/** Which kind of host a session is shown in. */
export type SessionPlacement = 'tab' | 'dock';

type Message = Record<string, unknown>;

/**
 * The webview posts `{type: 'focused'}` whenever its window takes focus
 * (`src/webview/main.tsx`). A click into a tab that is already the active one
 * in its group, or into the docked view, changes no VS Code view state — this
 * is the only way the host learns that the user is now working in it. Consumed
 * by the hosts; the controller never sees it.
 */
const FOCUSED = 'focused';

export interface SessionHost {
  readonly placement: SessionPlacement;
  /** For the HTML shell and `asWebviewUri` only — post through {@link post}. */
  readonly webview: vscode.Webview;
  /** In front: the active tab of its editor group, or the visible docked view. */
  readonly active: boolean;
  /** What the user sees this session called (notification text). */
  readonly label: string;
  /** Column a review companion tab opens in (`ReviewGateController`). */
  readonly reviewColumn: vscode.ViewColumn;
  setSessionName(name: string): void;
  post(msg: Message): void;
  onMessage(listener: (msg: Message) => void): void;
  /** Came to the front, or its webview took focus. */
  onActivated(listener: () => void): void;
  /** Fires once, when the session leaves this host for good. */
  onClosed(listener: () => void): void;
  reveal(): void;
  close(): void;
}

/** A session shown in a native editor tab. */
export class PanelSessionHost implements SessionHost {
  readonly placement = 'tab';
  // Next to the session tab, so the diff never covers the conversation.
  readonly reviewColumn = vscode.ViewColumn.Beside;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    iconPath: vscode.Uri,
  ) {
    panel.iconPath = iconPath;
  }

  get webview(): vscode.Webview {
    return this.panel.webview;
  }

  get active(): boolean {
    return this.panel.active;
  }

  get label(): string {
    return this.panel.title;
  }

  setSessionName(name: string): void {
    this.panel.title = name || 'Kōdo';
  }

  post(msg: Message): void {
    void this.panel.webview.postMessage(msg);
  }

  onMessage(listener: (msg: Message) => void): void {
    this.panel.webview.onDidReceiveMessage((msg: Message) => {
      if (msg.type !== FOCUSED) {
        listener(msg);
      }
    });
  }

  onActivated(listener: () => void): void {
    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        listener();
      }
    });
    this.panel.webview.onDidReceiveMessage((msg: Message) => {
      if (msg.type === FOCUSED) {
        listener();
      }
    });
  }

  onClosed(listener: () => void): void {
    this.panel.onDidDispose(listener);
  }

  reveal(): void {
    this.panel.reveal();
  }

  close(): void {
    this.panel.dispose();
  }
}

/** One session's lease on the docked `kodo.sessionView`. */
export class DockSessionHost implements SessionHost {
  readonly placement = 'dock';
  // The dock sits outside the editor area, so there is nothing to open
  // beside: use the editor group the user was last in instead of splitting.
  readonly reviewColumn = vscode.ViewColumn.Active;

  private attached = true;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly closedListeners: (() => void)[] = [];

  constructor(private readonly view: vscode.WebviewView) {}

  get webview(): vscode.Webview {
    return this.view.webview;
  }

  get active(): boolean {
    return this.attached && this.view.visible;
  }

  get label(): string {
    return this.view.description || 'Kōdo';
  }

  setSessionName(name: string): void {
    if (this.attached) {
      this.view.description = name || undefined;
    }
  }

  post(msg: Message): void {
    if (this.attached) {
      void this.view.webview.postMessage(msg);
    }
  }

  onMessage(listener: (msg: Message) => void): void {
    this.subscriptions.push(
      this.view.webview.onDidReceiveMessage((msg: Message) => {
        if (msg.type !== FOCUSED) {
          listener(msg);
        }
      }),
    );
  }

  onActivated(listener: () => void): void {
    this.subscriptions.push(
      this.view.onDidChangeVisibility(() => {
        if (this.view.visible) {
          listener();
        }
      }),
      this.view.webview.onDidReceiveMessage((msg: Message) => {
        if (msg.type === FOCUSED) {
          listener();
        }
      }),
    );
  }

  onClosed(listener: () => void): void {
    this.closedListeners.push(listener);
  }

  reveal(): void {
    this.view.show(false);
  }

  /** End this session's lease on the view; the view stays. Idempotent. */
  close(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    for (const s of this.subscriptions.splice(0)) {
      s.dispose();
    }
    try {
      this.view.description = undefined;
    } catch {
      // The view itself was disposed — the reason this lease is ending.
    }
    for (const listener of this.closedListeners.splice(0)) {
      listener();
    }
  }
}
