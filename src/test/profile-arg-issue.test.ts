import * as assert from 'assert';

import { argIssue, argRangeWarning } from '../settings-webview/localLlmUtils';
import type { LlamaArgSpec } from '../settings-webview/types';

// The user-defined profile editor's ⚠ on an argument row (ProfileModal), which
// also gates Save. Pure functions — no VS Code window, webview or server.
const MIN_P: LlamaArgSpec = {
  flag: '--min-p',
  label: 'Min-P',
  kind: 'float',
  category: 'Sampling',
  help: '',
  minimum: 0,
  maximum: 1,
  step: 0.01,
  sensible_minimum: 0.01,
  sensible_maximum: 0.2,
  neutral: '0.0',
};

suite('profile editor argument ⚠', () => {
  test('the sampler\'s off value is not flagged, so it can be saved', () => {
    // Min-P is useful at 0.01–0.2 but off at 0 — the same exemption the
    // session sampling modal makes.
    assert.strictEqual(argIssue(MIN_P, '0.0'), null);
    assert.strictEqual(argIssue(MIN_P, '0'), null, 'same value, other spelling');
  });

  test('a value just above off is still out of band', () => {
    assert.notStrictEqual(argRangeWarning(MIN_P, '0.005'), null);
  });

  test('the out-of-band tooltip names the off value', () => {
    assert.match(argRangeWarning(MIN_P, '0.5') ?? '', /Set it to 0\.0 to turn Min-P off\./);
  });

  test('without a shipped neutral value (older server) the band applies as before', () => {
    const { neutral: _neutral, ...older } = MIN_P;
    assert.notStrictEqual(argRangeWarning(older, '0'), null);
  });
});
