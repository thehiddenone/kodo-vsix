/**
 * Files staged for the next prompt: the open-file-picker → validate →
 * stage → chip-post flow, the attachment control tag prepended to a
 * submitted prompt, and rehydrating the chips on webview reconnect.
 * Content is read here only to validate (text + size) and is otherwise
 * never held past the check — see `AttachedFile`'s doc comment.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AttachedFile } from './types';
import { MAX_ATTACHMENTS, MAX_ATTACH_BYTES } from './types';

type Post = (msg: Record<string, unknown>) => void;

/**
 * True iff `data` decodes cleanly as UTF-8. Used (alongside a NUL-byte scan) to
 * reject binary files: `Buffer.toString('utf8')` silently substitutes U+FFFD on
 * malformed input, so a fatal TextDecoder is needed to actually detect it.
 */
function isValidUtf8(data: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

export class AttachmentManager {
  private readonly files = new Map<string, AttachedFile>();
  private seq = 0;

  constructor(private readonly post: Post) {}

  get size(): number {
    return this.files.size;
  }

  remove(id: string): void {
    this.files.delete(id);
  }

  /**
   * Prepend a single machine-generated control line listing the staged
   * attachment paths, which the server parses, strips, and replaces with the
   * files' content when prepping the prompt for the LLM. The content itself is
   * never embedded here, so it never lands in `session.jsonl`. Format:
   *
   *   <!--KODO_ATTACHMENTS:["/abs/a.py","/abs/b.md"]-->
   *   <the user's prompt>
   *
   * Kept byte-compatible with `kodo.runtime._attachments.parse_attachment_marker`.
   */
  composePrompt(text: string): string {
    if (this.files.size === 0) {
      return text;
    }
    const paths = [...this.files.values()].map((f) => f.path);
    return `<!--KODO_ATTACHMENTS:${JSON.stringify(paths)}-->\n${text}`;
  }

  /** Forget all staged attachments and clear their chips in the webview. */
  clear(): void {
    if (this.files.size === 0) {
      return;
    }
    this.files.clear();
    this.post({ type: 'attachments_cleared' });
  }

  /**
   * Open a file picker and stage each chosen file after a sanity check: it must
   * be a text file (no binary/NUL bytes), at most 128 KB on its own, and must
   * not push the combined attachment size to/over 128 KB. Rejections surface a
   * native error message explaining why; accepted files post `attachment_added`.
   */
  async attachFiles(): Promise<void> {
    if (this.files.size >= MAX_ATTACHMENTS) {
      void vscode.window.showWarningMessage(`Kōdo: You can attach at most ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: 'Attach',
      title: 'Attach text files to your prompt',
    });
    if (!uris || uris.length === 0) {
      return;
    }
    for (const uri of uris) {
      if (this.files.size >= MAX_ATTACHMENTS) {
        void vscode.window.showWarningMessage(
          `Kōdo: You can attach at most ${MAX_ATTACHMENTS} files — some files were not attached.`,
        );
        break;
      }
      await this.tryAttachOne(uri);
    }
  }

  /**
   * Validate a single file for instant user feedback and, if it passes, stage
   * its path + chip. The content is read here only to validate (text + size);
   * it is discarded — the server re-reads, re-validates, and copies the file at
   * submit time and is the authoritative gate (the original may change before
   * the prompt is sent).
   */
  private async tryAttachOne(uri: vscode.Uri): Promise<void> {
    const name = path.basename(uri.fsPath);
    let data: Buffer;
    try {
      data = await fs.promises.readFile(uri.fsPath);
    } catch (err) {
      void vscode.window.showErrorMessage(`Kōdo: Cannot attach "${name}" — ${String(err)}`);
      return;
    }
    // A NUL byte (or a UTF-8 decode failure) means this is not a text file.
    if (data.includes(0) || !isValidUtf8(data)) {
      void vscode.window.showErrorMessage(
        `Kōdo: Cannot attach "${name}" — it appears to be a binary file. Only text files can be attached.`,
      );
      return;
    }
    const size = data.byteLength;
    if (size > MAX_ATTACH_BYTES) {
      void vscode.window.showErrorMessage(
        `Kōdo: Cannot attach "${name}" — its text content is larger than 128 KB.`,
      );
      return;
    }
    if (this.attachedBytes() + size > MAX_ATTACH_BYTES) {
      void vscode.window.showErrorMessage(
        `Kōdo: Cannot attach "${name}" — the combined size of attached files would exceed the 128 KB limit.`,
      );
      return;
    }
    const id = `att-${++this.seq}`;
    this.files.set(id, { name, path: uri.fsPath, size });
    this.post({ type: 'attachment_added', id, name, path: uri.fsPath });
  }

  /** Total text-content bytes across all staged attachments. */
  private attachedBytes(): number {
    let total = 0;
    for (const f of this.files.values()) {
      total += f.size;
    }
    return total;
  }

  /** Restore each staged attachment's chip on a fresh webview mount. */
  rehydrate(): void {
    for (const [id, f] of this.files) {
      this.post({ type: 'attachment_added', id, name: f.name, path: f.path });
    }
  }
}
