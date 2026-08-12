import * as assert from 'assert';

import { llamaCppBuildNumber, llamaCppIsUpToDate } from '../settings-webview/localLlmUtils';

// The "Update llama.cpp" button in the Kōdo Settings panel's Llama.cpp section
// is disabled off `llamaCppIsUpToDate`. Pure string/number logic — no VS Code
// window, no webview, no server (localLlmUtils only imports types, erased at
// compile time).
suite('llamaCppBuildNumber', () => {
  test('parses the "bN" form llama.cpp versions are reported in', () => {
    assert.strictEqual(llamaCppBuildNumber('b9876'), 9876);
  });

  test('accepts a bare number and an uppercase prefix', () => {
    assert.strictEqual(llamaCppBuildNumber('9876'), 9876);
    assert.strictEqual(llamaCppBuildNumber('B9876'), 9876);
  });

  test('returns null for null, empty, and non-numeric input', () => {
    assert.strictEqual(llamaCppBuildNumber(null), null);
    assert.strictEqual(llamaCppBuildNumber(''), null);
    assert.strictEqual(llamaCppBuildNumber('bogus'), null);
  });
});

suite('llamaCppIsUpToDate', () => {
  test('is true when the installed build equals the latest', () => {
    assert.strictEqual(llamaCppIsUpToDate('b9876', 'b9876'), true);
  });

  test('is false when a newer build is available', () => {
    assert.strictEqual(llamaCppIsUpToDate('b9876', 'b9877'), false);
  });

  test('is true when the installed build is ahead of the published latest', () => {
    // A manually pinned newer/nightly build — there is still nothing to update
    // to, and the server's own short-circuit is `installed >= latest` too.
    assert.strictEqual(llamaCppIsUpToDate('b9999', 'b9876'), true);
  });

  test('compares numerically, not lexicographically, across a digit boundary', () => {
    // The whole reason for the shared parser: as strings, "b9876" > "b10000".
    assert.strictEqual(llamaCppIsUpToDate('b9876', 'b10000'), false);
    assert.strictEqual(llamaCppIsUpToDate('b10000', 'b9876'), true);
  });

  test('is false when llama.cpp is not installed', () => {
    assert.strictEqual(llamaCppIsUpToDate(null, 'b9876'), false);
  });

  test('is false when the latest version is unknown', () => {
    // GitHub unreachable/rate-limited, or the panel has not fetched yet.
    // "Can't tell" must never disable the button — that would block the user
    // exactly when they most need it.
    assert.strictEqual(llamaCppIsUpToDate('b9876', null), false);
  });
});
