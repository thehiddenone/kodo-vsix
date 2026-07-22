import * as assert from 'assert';

import {
  requiresWorkspaceSwitchConfirmation,
  resumeTarget,
  resumeTargetMatchesCurrent,
} from '../workspace-resume-policy';
import type { RememberedWorkspace } from '../workspace-resume-policy';

// Pure decision logic for resuming a picked session into its remembered VS
// Code workspace shape (session ↔ workspace linkage) — no VS Code window /
// WS / server needed, so these run instantly and deterministically.
suite('workspace-resume-policy', () => {
  const folders: RememberedWorkspace = {
    physicalRoot: '/home/dev',
    folders: { kodo: '/home/dev/kodo', 'kodo-vsix': '/home/dev/kodo-vsix' },
    codeWorkspaceFile: null,
    locked: false,
  };

  const withCodeWorkspaceFile: RememberedWorkspace = {
    ...folders,
    codeWorkspaceFile: '/home/dev/dev.code-workspace',
  };

  suite('resumeTarget', () => {
    test('null remembered workspace resolves to none', () => {
      assert.deepStrictEqual(resumeTarget(null, false), { kind: 'none' });
    });

    test('empty remembered workspace (no root, no folders) resolves to none', () => {
      const empty: RememberedWorkspace = {
        physicalRoot: '',
        folders: {},
        codeWorkspaceFile: null,
        locked: false,
      };
      assert.deepStrictEqual(resumeTarget(empty, false), { kind: 'none' });
    });

    test('remembered folders with no code-workspace file resolves to folders', () => {
      assert.deepStrictEqual(resumeTarget(folders, false), {
        kind: 'folders',
        entries: [
          ['kodo', '/home/dev/kodo'],
          ['kodo-vsix', '/home/dev/kodo-vsix'],
        ],
      });
    });

    test('remembered code-workspace file that exists resolves to file', () => {
      assert.deepStrictEqual(resumeTarget(withCodeWorkspaceFile, true), {
        kind: 'file',
        path: '/home/dev/dev.code-workspace',
      });
    });

    test('remembered code-workspace file that no longer exists falls back to folders', () => {
      // Explicit product decision: a missing .code-workspace file never
      // errors, it silently reconstructs from the remembered folder list.
      assert.deepStrictEqual(resumeTarget(withCodeWorkspaceFile, false), {
        kind: 'folders',
        entries: [
          ['kodo', '/home/dev/kodo'],
          ['kodo-vsix', '/home/dev/kodo-vsix'],
        ],
      });
    });

    test('a locked session ignores an existing code-workspace file — always folders', () => {
      // A locked folder edited out of the actual .code-workspace file on disk
      // would otherwise be silently dropped by reopening via that file, which
      // would defeat the lock — so once locked, the folder map (which the
      // server's reconciliation guarantees still contains it) always wins.
      const lockedWithFile: RememberedWorkspace = { ...withCodeWorkspaceFile, locked: true };
      assert.deepStrictEqual(resumeTarget(lockedWithFile, true), {
        kind: 'folders',
        entries: [
          ['kodo', '/home/dev/kodo'],
          ['kodo-vsix', '/home/dev/kodo-vsix'],
        ],
      });
    });
  });

  suite('resumeTargetMatchesCurrent', () => {
    test('none target always matches — nothing to reopen', () => {
      assert.strictEqual(
        resumeTargetMatchesCurrent({ kind: 'none' }, { workspaceFile: undefined, folderPaths: [] }),
        true,
      );
      assert.strictEqual(
        resumeTargetMatchesCurrent(
          { kind: 'none' },
          { workspaceFile: '/x.code-workspace', folderPaths: ['/a', '/b'] },
        ),
        true,
      );
    });

    test('file target matches only the exact same open workspace file', () => {
      const target = { kind: 'file' as const, path: '/home/dev/dev.code-workspace' };
      assert.strictEqual(
        resumeTargetMatchesCurrent(target, {
          workspaceFile: '/home/dev/dev.code-workspace',
          folderPaths: ['/home/dev/kodo'],
        }),
        true,
      );
      assert.strictEqual(
        resumeTargetMatchesCurrent(target, { workspaceFile: undefined, folderPaths: [] }),
        false,
      );
      assert.strictEqual(
        resumeTargetMatchesCurrent(target, {
          workspaceFile: '/other/other.code-workspace',
          folderPaths: [],
        }),
        false,
      );
    });

    test('folders target matches the same set regardless of order', () => {
      const target = {
        kind: 'folders' as const,
        entries: [['kodo', '/home/dev/kodo'], ['kodo-vsix', '/home/dev/kodo-vsix']] as Array<
          [string, string]
        >,
      };
      assert.strictEqual(
        resumeTargetMatchesCurrent(target, {
          workspaceFile: undefined,
          folderPaths: ['/home/dev/kodo-vsix', '/home/dev/kodo'],
        }),
        true,
      );
    });

    test('folders target does not match a different set (exact match, not additive)', () => {
      const target = {
        kind: 'folders' as const,
        entries: [['kodo', '/home/dev/kodo']] as Array<[string, string]>,
      };
      // Current has the remembered folder PLUS an extra one — still a
      // mismatch, since reopening must replace the set exactly.
      assert.strictEqual(
        resumeTargetMatchesCurrent(target, {
          workspaceFile: undefined,
          folderPaths: ['/home/dev/kodo', '/home/dev/unrelated'],
        }),
        false,
      );
      assert.strictEqual(
        resumeTargetMatchesCurrent(target, { workspaceFile: undefined, folderPaths: [] }),
        false,
      );
    });
  });

  suite('requiresWorkspaceSwitchConfirmation', () => {
    const mismatchedTarget = {
      kind: 'folders' as const,
      entries: [['kodo', '/home/dev/kodo']] as Array<[string, string]>,
    };
    const mismatchedCurrent = { workspaceFile: undefined, folderPaths: ['/home/dev/other'] };
    const matchingCurrent = { workspaceFile: undefined, folderPaths: ['/home/dev/kodo'] };

    test('locked + mismatch requires confirmation', () => {
      assert.strictEqual(
        requiresWorkspaceSwitchConfirmation(true, mismatchedTarget, mismatchedCurrent),
        true,
      );
    });

    test('unlocked + mismatch does not require confirmation (silent reopen, unchanged)', () => {
      assert.strictEqual(
        requiresWorkspaceSwitchConfirmation(false, mismatchedTarget, mismatchedCurrent),
        false,
      );
    });

    test('locked + already matching does not require confirmation — nothing to reload', () => {
      assert.strictEqual(
        requiresWorkspaceSwitchConfirmation(true, mismatchedTarget, matchingCurrent),
        false,
      );
    });

    test('unlocked + already matching does not require confirmation', () => {
      assert.strictEqual(
        requiresWorkspaceSwitchConfirmation(false, mismatchedTarget, matchingCurrent),
        false,
      );
    });
  });
});
