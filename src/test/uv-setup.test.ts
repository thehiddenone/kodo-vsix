import * as assert from 'assert';

import { compareVersions } from '../uv-setup';

// Pure version-comparison logic backing the py-kodo upgrade-on-extension-update
// check — no VS Code window / venv / uv needed, so these run instantly and
// deterministically.
suite('uv-setup', () => {
  suite('compareVersions', () => {
    test('numeric comparison, not lexicographic (0.1.9 < 0.1.10)', () => {
      assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
      assert.ok(compareVersions('0.1.9', '0.1.10') < 0);
    });

    test('equal versions compare as 0', () => {
      assert.strictEqual(compareVersions('0.1.10', '0.1.10'), 0);
    });

    test('compares major and minor components before build', () => {
      assert.ok(compareVersions('1.0.0', '0.9.9') > 0);
      assert.ok(compareVersions('0.2.0', '0.1.99') > 0);
    });

    test('handles differing component counts by treating missing as 0', () => {
      assert.strictEqual(compareVersions('0.1', '0.1.0'), 0);
      assert.ok(compareVersions('0.1.1', '0.1') > 0);
    });
  });
});
