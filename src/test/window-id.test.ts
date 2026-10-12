import * as assert from 'assert';
import * as vscode from 'vscode';

import { canonicalWindowKey, deriveWindowIdFromKey } from '../extension/window-id';

// Window-id continuity (WS_PROTOCOL.md §7.1a) only works if the key armed
// before a reload hashes to the id `stableWindowId` derives after it — and that
// one comes from VS Code's own `Uri.fsPath` of the folder we added.
suite('window-id', () => {
  suite('canonicalWindowKey', () => {
    test('a path missing its leading slash arms under the id the reloaded window derives', () => {
      // The 2026-10-11 regression: `Users/…` vs `/Users/…` hashed apart, the
      // reloaded window got a fresh id and never re-joined its session.
      const postReload = vscode.Uri.file('/Users/me/proj').fsPath;
      assert.strictEqual(
        deriveWindowIdFromKey(canonicalWindowKey('Users/me/proj')),
        deriveWindowIdFromKey(postReload),
      );
    });

    test('an already-canonical path is left exactly as it is', () => {
      const canonical = vscode.Uri.file('/Users/me/proj').fsPath;
      assert.strictEqual(canonicalWindowKey(canonical), canonical);
    });
  });
});
