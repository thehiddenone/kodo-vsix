import * as assert from 'assert';
import * as path from 'path';

import { resolveLogicalPath } from '../logical-path';

// Pure resolution logic for agent-supplied logical paths (edit_file /
// create_file / filesystem's "open this file" link) — no VS Code window / WS
// / server needed, so these run instantly and deterministically.
suite('logical-path', () => {
  suite('resolveLogicalPath', () => {
    test('single-root workspace: does not double the root folder name', () => {
      // The exact repro: workspace opened directly on "fibonacci-cli", tool
      // call path is "fibonacci-cli/main.py" (folder-name-prefixed) — must
      // resolve to <physicalRoot>/fibonacci-cli/main.py, not
      // <physicalRoot>/fibonacci-cli/fibonacci-cli/main.py.
      const folders = { 'fibonacci-cli': '/home/dev/projects/fibonacci-cli' };
      assert.strictEqual(
        resolveLogicalPath(folders, 'fibonacci-cli/main.py'),
        path.join('/home/dev/projects/fibonacci-cli', 'main.py'),
      );
    });

    test('multi-root workspace: picks the folder named by the path, not the first one', () => {
      const folders = {
        frontend: '/home/dev/repos/frontend',
        backend: '/home/dev/repos/backend',
      };
      assert.strictEqual(
        resolveLogicalPath(folders, 'backend/src/main.py'),
        path.join('/home/dev/repos/backend', 'src', 'main.py'),
      );
      assert.strictEqual(
        resolveLogicalPath(folders, 'frontend/src/index.ts'),
        path.join('/home/dev/repos/frontend', 'src', 'index.ts'),
      );
    });

    test('disambiguated same-name folders resolve by their "name (parent)" key', () => {
      const folders = {
        'backend (org-a)': '/home/dev/org-a/backend',
        'backend (org-b)': '/home/dev/org-b/backend',
      };
      assert.strictEqual(
        resolveLogicalPath(folders, 'backend (org-b)/README.md'),
        path.join('/home/dev/org-b/backend', 'README.md'),
      );
    });

    test('root with no remainder resolves to the root itself', () => {
      const folders = { 'fibonacci-cli': '/home/dev/projects/fibonacci-cli' };
      assert.strictEqual(resolveLogicalPath(folders, 'fibonacci-cli'), '/home/dev/projects/fibonacci-cli');
    });

    test('absolute paths pass through unchanged (attachment paths, agent absolute paths)', () => {
      const folders = { 'fibonacci-cli': '/home/dev/projects/fibonacci-cli' };
      assert.strictEqual(resolveLogicalPath(folders, '/etc/hosts'), '/etc/hosts');
    });

    test('unknown root name (e.g. a temporary/scratch-dir path) resolves to null, not a guess', () => {
      const folders = { 'fibonacci-cli': '/home/dev/projects/fibonacci-cli' };
      assert.strictEqual(resolveLogicalPath(folders, 'notes.txt'), null);
      assert.strictEqual(resolveLogicalPath(folders, 'other-repo/main.py'), null);
    });

    test('empty path resolves to null', () => {
      assert.strictEqual(resolveLogicalPath({}, ''), null);
    });
  });
});
