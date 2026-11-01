import * as assert from 'assert';

import { supportsSecondarySideBar } from '../secondary-side-bar';

suite('supportsSecondarySideBar', () => {
  test('1.106 and later host the docked view', () => {
    assert.strictEqual(supportsSecondarySideBar('1.106.0'), true);
    assert.strictEqual(supportsSecondarySideBar('1.138.2'), true);
    assert.strictEqual(supportsSecondarySideBar('2.0.0'), true);
  });

  test('anything older does not', () => {
    assert.strictEqual(supportsSecondarySideBar('1.105.9'), false);
    assert.strictEqual(supportsSecondarySideBar('1.90.0'), false);
  });

  test('a pre-release suffix still parses', () => {
    assert.strictEqual(supportsSecondarySideBar('1.106.0-insider'), true);
  });

  test('an unparsable version counts as unsupported', () => {
    assert.strictEqual(supportsSecondarySideBar(''), false);
    assert.strictEqual(supportsSecondarySideBar('next'), false);
  });
});
