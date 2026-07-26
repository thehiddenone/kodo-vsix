/**
 * The Edit Control review gate (WS_PROTOCOL.md §6.5b): `prompt.edit_review`
 * requests, the companion read-only/diff tab they open, closing that tab
 * (explicit decision or implicit reject on tab-close), and the
 * selection-driven "Add feedback" affordance. One outstanding review at a
 * time per session.
 */

import * as vscode from 'vscode';
import type { Envelope } from '../envelope';
import { makeResponse } from '../envelope';
import { buildReviewUris, clearReviewContent, setReviewContent } from '../file-review-provider';
import type { FileReviewData } from './types';

type Post = (msg: Record<string, unknown>) => void;
type Send = (env: Envelope) => void;

/** Matches a VS Code tab whose input is a text doc or diff referencing any
 *  of `targets` (compared by URI string) — used to find/close the review's
 *  companion tab regardless of whether it's a plain doc or a diff editor. */
function tabMatchesUris(tab: vscode.Tab, targets: Set<string>): boolean {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return targets.has(input.uri.toString());
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return targets.has(input.original.toString()) || targets.has(input.modified.toString());
  }
  return false;
}

export class ReviewGateController {
  private pending: FileReviewData | null = null;
  private uris: { oldUri?: vscode.Uri; newUri: vscode.Uri } | null = null;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly post: Post,
  ) {}

  /** Null the pending request without responding or closing the tab —
   *  mirrors the original `_submitPrompt`'s reset, which deliberately leaves
   *  a stale companion tab open rather than also tearing it down. */
  clear(): void {
    this.pending = null;
  }

  handleEditReviewRequest(env: Envelope): void {
    this.pending = {
      requestId: env.id,
      toolCallId: String(env.payload.tool_call_id ?? ''),
      toolName: String(env.payload.tool_name ?? ''),
      path: String(env.payload.path ?? ''),
      mode: env.payload.mode === 'modification' ? 'modification' : 'new_file',
      oldContent: String(env.payload.old_content ?? ''),
      newContent: String(env.payload.new_content ?? ''),
    };
    this.post({ type: 'file_review_request', ...this.pending });
    void this.openReviewTab();
  }

  respond(msg: Record<string, unknown>, send: Send): void {
    const rawFeedback = Array.isArray(msg.feedback) ? msg.feedback : [];
    const feedback = rawFeedback.map((f) => {
      const r = f as Record<string, unknown>;
      if (r.generalFeedback === true) {
        return { general_feedback: true, feedback: String(r.feedback ?? '') };
      }
      return {
        general_feedback: false,
        line_from: Number(r.lineFrom ?? 0),
        line_to: Number(r.lineTo ?? 0),
        targeted_code: String(r.targetedCode ?? ''),
        feedback: String(r.feedback ?? ''),
      };
    });
    send(
      makeResponse(String(msg.requestId ?? ''), {
        type: 'prompt.edit_review.response',
        action: String(msg.action ?? 'reject'),
        feedback,
      }),
    );
    // Cleared before the (async) tab close, so the tabGroups.onDidChangeTabs
    // fallout from that close sees `pending` already null and does not also
    // fire an implicit-reject response for the same decision.
    this.pending = null;
    void this.closeReviewTab();
  }

  /**
   * Open the pending review's companion tab: a plain read-only doc for a new
   * file, a native diff for a modification. Reveals this session's panel
   * first so `ViewColumn.Beside` lands the tab next to it regardless of what
   * the user was previously looking at. Closes any tab a *previous* review
   * in this same session left open first, so reviews don't accumulate
   * editor splits (e.g. a crash-resume re-fire for the same call).
   */
  private async openReviewTab(): Promise<void> {
    const review = this.pending;
    if (!review) {
      return;
    }
    await this.closeReviewTab();

    const uris = buildReviewUris(review.toolCallId, review.path, review.mode);
    setReviewContent(uris.newUri, review.newContent);
    if (uris.oldUri) {
      setReviewContent(uris.oldUri, review.oldContent);
    }
    this.uris = uris;

    this.panel.reveal();
    try {
      if (review.mode === 'modification' && uris.oldUri) {
        await vscode.commands.executeCommand(
          'vscode.diff',
          uris.oldUri,
          uris.newUri,
          `${review.path} (Review)`,
          { viewColumn: vscode.ViewColumn.Beside, preview: false },
        );
      } else {
        await vscode.window.showTextDocument(uris.newUri, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Kōdo: cannot open review tab — ${String(err)}`);
    }
  }

  /** Close this session's review companion tab (if any) and drop its
   *  content-provider entries. Best-effort: the tab may already be gone
   *  (e.g. the user just closed it, which is what triggered this call via
   *  {@link handleTabsChanged} in the first place). */
  async closeReviewTab(): Promise<void> {
    const uris = this.uris;
    if (!uris) {
      return;
    }
    this.uris = null;
    clearReviewContent(uris.oldUri, uris.newUri);
    const targets = new Set(
      [uris.newUri.toString(), uris.oldUri?.toString()].filter((u): u is string => Boolean(u)),
    );
    const toClose: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tabMatchesUris(tab, targets)) {
          toClose.push(tab);
        }
      }
    }
    if (toClose.length > 0) {
      try {
        await vscode.window.tabGroups.close(toClose);
      } catch {
        // Best-effort — see method doc.
      }
    }
  }

  /**
   * Called for every `tabGroups.onDidChangeTabs` event, window-wide (fanned
   * out from `extension.ts` to every open session). If one of the closed
   * tabs is this session's pending review's companion tab, treat it as an
   * implicit Reject — closing the tab without deciding discards any
   * drafted-but-unsubmitted feedback (WS_PROTOCOL.md §6.5b).
   *
   * `pending` is already `null` by the time this fires for a tab this
   * controller closed itself (`respond` clears it before calling
   * {@link closeReviewTab}), so an explicit decision never double-fires a
   * second response here.
   */
  handleTabsChanged(closed: readonly vscode.Tab[], send: Send): void {
    const uris = this.uris;
    if (!uris || this.pending === null) {
      return;
    }
    const targets = new Set(
      [uris.newUri.toString(), uris.oldUri?.toString()].filter((u): u is string => Boolean(u)),
    );
    if (!closed.some((tab) => tabMatchesUris(tab, targets))) {
      return;
    }
    const requestId = this.pending.requestId;
    this.pending = null;
    this.uris = null;
    clearReviewContent(uris.oldUri, uris.newUri);
    send(
      makeResponse(requestId, {
        type: 'prompt.edit_review.response',
        action: 'reject',
        feedback: [],
      }),
    );
    this.post({ type: 'file_review_cleared' });
  }

  /**
   * Called for every `onDidChangeActiveTextEditor`/`onDidChangeTextEditorSelection`
   * event, window-wide. Pushes the live selection to the webview only when
   * it belongs to THIS session's pending review's new/proposed side — the
   * old/removed side of a diff never matches, which is the entire
   * enforcement of "only the new content is selectable for feedback"
   * (WS_PROTOCOL.md §6.5b). `editor === undefined` (focus moved to a
   * non-editor view — most commonly this session's own webview, e.g. while
   * clicking "Add feedback") leaves the last known selection as-is rather
   * than spuriously disabling the button mid-click.
   */
  handleActiveSelectionChanged(editor: vscode.TextEditor | undefined): void {
    const uris = this.uris;
    if (!uris || editor === undefined) {
      return;
    }
    if (editor.document.uri.toString() !== uris.newUri.toString()) {
      this.post({ type: 'file_review_selection', hasSelection: false, lineFrom: 0, lineTo: 0, targetedCode: '' });
      return;
    }
    const sel = editor.selection;
    this.post({
      type: 'file_review_selection',
      hasSelection: !sel.isEmpty,
      lineFrom: sel.start.line + 1,
      lineTo: sel.end.line + 1,
      targetedCode: editor.document.getText(sel),
    });
  }

  /**
   * Backs the `kodo.addFeedback` editor/context command: if the active
   * editor is this session's pending review's new/proposed side with a
   * non-empty selection, tell the webview to append a draft from it (the
   * exact action the in-panel "Add feedback" button triggers) and report
   * success so `extension.ts`'s window-wide command handler stops looking.
   */
  tryAddFeedbackFromActiveSelection(): boolean {
    const uris = this.uris;
    const editor = vscode.window.activeTextEditor;
    if (
      !uris ||
      !editor ||
      editor.document.uri.toString() !== uris.newUri.toString() ||
      editor.selection.isEmpty
    ) {
      return false;
    }
    this.post({ type: 'add_feedback_draft' });
    return true;
  }

  /** Best-effort teardown on session dispose — don't leave an orphaned
   *  review companion tab behind for a session that's gone. */
  async disposeReviewTab(): Promise<void> {
    await this.closeReviewTab();
  }

  rehydrate(): void {
    if (this.pending !== null) {
      this.post({ type: 'file_review_request', ...this.pending });
    }
  }
}
