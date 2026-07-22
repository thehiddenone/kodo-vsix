import * as assert from 'assert';

import {
  reconcileSessionAction,
  reconcileTabAction,
  reloadWipesSerializerState,
} from '../reconcile-policy';

// Pure decision logic for the post-reload session-reconcile pass. These guard
// the "create_new_project reload leaves the session stuck" fix
// (project_kodo_no_workspace_bugs memory §8) — no VS Code window / WS / server
// needed, so they run instantly and deterministically.
suite('reconcile-policy', () => {
  suite('reconcileTabAction', () => {
    test('balanced counts always proceed, regardless of serializer state', () => {
      assert.strictEqual(reconcileTabAction(false, 0, 0), 'proceed');
      assert.strictEqual(reconcileTabAction(true, 0, 0), 'proceed');
      assert.strictEqual(reconcileTabAction(false, 2, 2), 'proceed');
      assert.strictEqual(reconcileTabAction(true, 3, 3), 'proceed');
    });

    test('fewer tabs than sessions proceeds (no un-accounted tab)', () => {
      assert.strictEqual(reconcileTabAction(false, 1, 2), 'proceed');
      assert.strictEqual(reconcileTabAction(true, 1, 2), 'proceed');
    });

    test('extra native tab + live serializer state defers (pending sticky placeholder)', () => {
      // Ordinary reload: the leftover tab will revive on click and be adopted
      // by the serializer — racing it would create a duplicate.
      assert.strictEqual(reconcileTabAction(false, 1, 0), 'defer');
      assert.strictEqual(reconcileTabAction(false, 3, 1), 'defer');
    });

    test('extra native tab + dead serializer state closes ghosts (the §8 fix)', () => {
      // create_new_project reload into a new workspace identity: the leftover
      // tab is a dead ghost that never revives — must NOT defer forever.
      assert.strictEqual(reconcileTabAction(true, 1, 0), 'close-ghosts');
      assert.strictEqual(reconcileTabAction(true, 2, 0), 'close-ghosts');
    });

    test('the live repro (tabCount=1, sessions=0, serializer dead) closes ghosts, not defer', () => {
      // Exactly the observed failure state before the fix — the regression this
      // whole change exists to prevent.
      assert.strictEqual(reconcileTabAction(true, 1, 0), 'close-ghosts');
      assert.notStrictEqual(reconcileTabAction(true, 1, 0), 'defer');
    });
  });

  suite('reloadWipesSerializerState', () => {
    test('empty→first-folder (insertAt 0) wipes serializer state', () => {
      assert.strictEqual(reloadWipesSerializerState(0), true);
    });

    test('single-folder→multi-root (insertAt 1) wipes serializer state', () => {
      // Guards against a regression to `=== 0`, which would leave the
      // has-workspace create_new_project path deadlocked.
      assert.strictEqual(reloadWipesSerializerState(1), true);
    });

    test('appending to an already-multi-root workspace (insertAt >= 2) does not', () => {
      assert.strictEqual(reloadWipesSerializerState(2), false);
      assert.strictEqual(reloadWipesSerializerState(3), false);
    });
  });

  suite('reconcileSessionAction', () => {
    test('present and free session is reopened', () => {
      assert.strictEqual(reconcileSessionAction(true, false), 'reopen');
    });

    test('missing session is forgotten', () => {
      assert.strictEqual(reconcileSessionAction(false, false), 'forget');
    });

    test('present but taken (held by another live window) is forgotten', () => {
      assert.strictEqual(reconcileSessionAction(true, true), 'forget');
    });

    test('missing and taken is forgotten', () => {
      assert.strictEqual(reconcileSessionAction(false, true), 'forget');
    });
  });
});
