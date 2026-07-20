import * as vscode from 'vscode';

/**
 * Read-only content backing the Edit Control review gate's companion editor
 * tab (`prompt.edit_review`, WS_PROTOCOL.md §6.5b) — a plain read-only doc for
 * a new file, or one side of a native `vscode.diff` for a modification.
 *
 * Registering a `TextDocumentContentProvider` with NO matching
 * `FileSystemProvider` is what makes VS Code treat a scheme's documents as
 * inherently non-editable — there is no writeback path, so the editor shows
 * them read-only automatically. Content lives in an in-memory map (never
 * touches disk pre-approval — nothing here is written until the user
 * approves).
 */
export const KODO_REVIEW_SCHEME = 'kodo-review';

const _content = new Map<string, string>();

export class FileReviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return _content.get(uri.toString()) ?? '';
  }
}

/**
 * Build the read-only URI pair for one pending review, keyed by `toolCallId`
 * so a crash-resume re-fire (same `tool_call_id`, fresh content) overwrites
 * rather than accumulates stale entries. The path ends in the real filename
 * so VS Code applies the right syntax highlighting/icon automatically.
 */
export function buildReviewUris(
  toolCallId: string,
  path: string,
  mode: 'new_file' | 'modification',
): { oldUri?: vscode.Uri; newUri: vscode.Uri } {
  const basename = path.split(/[\\/]/).pop() || path;
  const id = encodeURIComponent(toolCallId);
  const newUri = vscode.Uri.parse(`${KODO_REVIEW_SCHEME}:/${id}/new/${basename}`);
  if (mode === 'new_file') {
    return { newUri };
  }
  const oldUri = vscode.Uri.parse(`${KODO_REVIEW_SCHEME}:/${id}/old/${basename}`);
  return { oldUri, newUri };
}

/** Set (or overwrite) the content backing a review URI. */
export function setReviewContent(uri: vscode.Uri, content: string): void {
  _content.set(uri.toString(), content);
}

/** Drop the content backing one or more review URIs once a review resolves. */
export function clearReviewContent(...uris: (vscode.Uri | undefined)[]): void {
  for (const u of uris) {
    if (u) {
      _content.delete(u.toString());
    }
  }
}
