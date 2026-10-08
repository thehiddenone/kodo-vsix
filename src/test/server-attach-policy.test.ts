import * as assert from 'assert';

import {
  MAX_FREE_RELAUNCHES,
  START_RETRY_DELAY_MS,
  connectFailureResponse,
  decideAttach,
  startFailureAction,
  type ServerProbe,
  type ServerState,
} from '../server-attach-policy';

// Pure decision logic for attaching to the singleton server — the guard against
// "closed and reopened VS Code within a few seconds → the reused server
// self-reaped before we connected → 20 s of retries → needless venv rebuild".
// No VS Code window / WS / server needed.

function probe(
  state: ServerState | null,
  pidAlive: boolean,
  portBusy: boolean,
): ServerProbe {
  return { discovery: { pid: 4242, port: 9042, state }, pidAlive, portBusy };
}

suite('server-attach-policy', () => {
  suite('decideAttach', () => {
    test('no discovery file spawns', () => {
      assert.strictEqual(decideAttach({ discovery: null, pidAlive: false, portBusy: false }), 'spawn');
    });

    test('dead PID and free port is stale, whatever the state says', () => {
      for (const state of ['starting', 'serving', 'stopping', null] as const) {
        assert.strictEqual(decideAttach(probe(state, false, false)), 'spawn', String(state));
      }
    });

    test('a serving server holding its port is reused', () => {
      assert.strictEqual(decideAttach(probe('serving', true, true)), 'reuse');
    });

    test('a starting server is reused even before it listens (it is still booting)', () => {
      assert.strictEqual(decideAttach(probe('starting', true, false)), 'reuse');
    });

    test('a stopping server is waited out, never reused — the self-reap race', () => {
      assert.strictEqual(decideAttach(probe('stopping', true, true)), 'await-exit');
      assert.strictEqual(decideAttach(probe('stopping', true, false)), 'await-exit');
      assert.strictEqual(decideAttach(probe('stopping', false, true)), 'await-exit');
    });

    test('serving with a free port is stale even with a live PID (recycled PID)', () => {
      assert.strictEqual(decideAttach(probe('serving', true, false)), 'spawn');
    });

    test('a file from an older server (no state) is judged by PID or port alone', () => {
      assert.strictEqual(decideAttach(probe(null, true, false)), 'reuse');
      assert.strictEqual(decideAttach(probe(null, false, true)), 'reuse');
    });
  });

  suite('connectFailureResponse', () => {
    test('a present server is always retried', () => {
      for (const lastLaunch of ['reused', 'spawned', null] as const) {
        for (const connectedSinceLaunch of [true, false]) {
          assert.strictEqual(
            connectFailureResponse({ serverPresent: true, connectedSinceLaunch, lastLaunch }),
            'retry',
          );
        }
      }
    });

    test('a reused server that vanished before we connected is relaunched (the reported bug)', () => {
      assert.strictEqual(
        connectFailureResponse({ serverPresent: false, connectedSinceLaunch: false, lastLaunch: 'reused' }),
        'relaunch',
      );
    });

    test('a server that vanished after we connected is relaunched', () => {
      for (const lastLaunch of ['reused', 'spawned'] as const) {
        assert.strictEqual(
          connectFailureResponse({ serverPresent: false, connectedSinceLaunch: true, lastLaunch }),
          'relaunch',
        );
      }
    });

    test('a spawned server not reached yet is retried, not relaunched — it may still be importing', () => {
      assert.strictEqual(
        connectFailureResponse({ serverPresent: false, connectedSinceLaunch: false, lastLaunch: 'spawned' }),
        'retry',
      );
    });
  });

  suite('startFailureAction', () => {
    test('first failure retries after a 3 s pause, without a rebuild', () => {
      assert.deepStrictEqual(startFailureAction(1), { kind: 'retry', delayMs: START_RETRY_DELAY_MS });
      assert.strictEqual(START_RETRY_DELAY_MS, 3_000);
    });

    test('second failure rebuilds the venv', () => {
      assert.deepStrictEqual(startFailureAction(2), { kind: 'rebuild' });
    });

    test('a failure after the rebuild gives up', () => {
      assert.deepStrictEqual(startFailureAction(3), { kind: 'give-up' });
      assert.deepStrictEqual(startFailureAction(7), { kind: 'give-up' });
    });

    test('free relaunches are bounded', () => {
      assert.ok(MAX_FREE_RELAUNCHES >= 1);
    });
  });
});
