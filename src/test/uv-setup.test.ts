import * as assert from 'assert';

import { UV_RETRY_DELAYS_MS, compareVersions, retryAsync } from '../uv-setup';

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

  // The uv retry ladder behind `py-kodo` install/upgrade. The real sleeps are
  // injected out, so a test of the 1s/3s ladder still runs in microseconds.
  suite('retryAsync', () => {
    const noSleep = async (): Promise<void> => undefined;

    test('the shipped ladder is three attempts: immediate, +1s, +3s', () => {
      assert.deepStrictEqual([...UV_RETRY_DELAYS_MS], [0, 1_000, 3_000]);
    });

    test('returns the first success without further attempts or waits', async () => {
      const waits: number[] = [];
      let calls = 0;
      const result = await retryAsync(
        async () => { calls++; return 'ok'; },
        UV_RETRY_DELAYS_MS,
        { sleepFn: async (ms) => { waits.push(ms); } },
      );
      assert.strictEqual(result, 'ok');
      assert.strictEqual(calls, 1);
      assert.deepStrictEqual(waits, []);
    });

    test('waits 1s before the 2nd attempt and 3s before the 3rd', async () => {
      const waits: number[] = [];
      let calls = 0;
      const result = await retryAsync(
        async () => {
          calls++;
          if (calls < 3) { throw new Error(`boom ${calls}`); }
          return calls;
        },
        UV_RETRY_DELAYS_MS,
        { sleepFn: async (ms) => { waits.push(ms); } },
      );
      assert.strictEqual(result, 3);
      assert.deepStrictEqual(waits, [1_000, 3_000]);
    });

    test('rethrows the LAST error once every attempt fails', async () => {
      let calls = 0;
      await assert.rejects(
        retryAsync(
          async () => { calls++; throw new Error(`fail ${calls}`); },
          UV_RETRY_DELAYS_MS,
          { sleepFn: noSleep },
        ),
        /fail 3/,
      );
      assert.strictEqual(calls, 3);
    });

    test('reports willRetry=false only on the final failure', async () => {
      const seen: boolean[] = [];
      await assert.rejects(
        retryAsync(
          async () => { throw new Error('always'); },
          UV_RETRY_DELAYS_MS,
          { sleepFn: noSleep, onFailure: (_n, _e, willRetry) => seen.push(willRetry) },
        ),
      );
      assert.deepStrictEqual(seen, [true, true, false]);
    });

    test('a verification failure counts as a failed attempt', async () => {
      // Mirrors `upgradeAttemptWithRetries`: uv "succeeds" every time, but the
      // installed version only actually moves on the third attempt.
      let installed = '0.1.9';
      let attempt = 0;
      const result = await retryAsync(
        async () => {
          attempt++;
          if (attempt === 3) { installed = '0.1.11'; }
          if (compareVersions(installed, '0.1.11') < 0) {
            throw new Error(`uv exited 0 but py-kodo is still ${installed}`);
          }
          return installed;
        },
        UV_RETRY_DELAYS_MS,
        { sleepFn: noSleep },
      );
      assert.strictEqual(result, '0.1.11');
      assert.strictEqual(attempt, 3);
    });
  });
});
