import * as assert from 'assert';

import { activityChunks, activityTrials, mergeActivity } from '../benchmark-view';
import type { BenchmarkActivity } from '../benchmark-view';
import { activityEntries } from '../webview/benchmarkActivity';
import { initial, reducer } from '../webview/reducer';

// What the agent did in each trial of a benchmark run arrives as
// `harbor.activity` chunks (kodo doc/WS_PROTOCOL.md §5.9m): one log's events
// from a position on. A reconnect resends every log in full, and a live chunk
// can beat that resend, so what must hold: each event lands at its position
// once, whatever the order, and a trial's logs stay in run order.
function chunk(
  trial: string, log: string, first: number, events: Record<string, unknown>[],
  started = '2026-10-18T10:00:00.000+00:00', step: string | null = null,
): Record<string, unknown> {
  return { trial, log, step, started, first, events };
}

function ev(type: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { ts: '2026-10-18T10:00:01.000+00:00', type, ...fields };
}

function fold(chunks: Record<string, unknown>[]): BenchmarkActivity {
  return chunks.reduce<BenchmarkActivity>((activity, c) => mergeActivity(activity, c) ?? activity, {});
}

function types(activity: BenchmarkActivity, trial: string, index = 0): (string | undefined)[] {
  // Array.from, not map: map skips the holes a not-yet-filled position leaves.
  return Array.from(activity[trial][index].events, (e) => (e === undefined ? undefined : String(e.type)));
}

suite('benchmark activity', () => {
  test('events land at their position, and a repeat changes nothing', () => {
    const start = chunk('t1', 'a', 0, [ev('run.start'), ev('text', { text: 'one' })]);
    const activity = fold([start, chunk('t1', 'a', 2, [ev('thinking', { text: 'hm' })])]);
    assert.deepStrictEqual(types(activity, 't1'), ['run.start', 'text', 'thinking']);
    assert.strictEqual(mergeActivity(activity, start), null);
  });

  test('a live chunk that beats the full resend is kept, and the resend fills in before it', () => {
    const live = chunk('t1', 'a', 2, [ev('text', { text: 'late' })]);
    let activity = fold([live]);
    assert.deepStrictEqual(types(activity, 't1'), [undefined, undefined, 'text']);
    activity = fold([live, chunk('t1', 'a', 0, [ev('run.start'), ev('llm.turn'), ev('text', { text: 'late' })])]);
    assert.deepStrictEqual(types(activity, 't1'), ['run.start', 'llm.turn', 'text']);
  });

  test('a log learns its step once Harbor files it, and keeps it', () => {
    let activity = fold([chunk('t1', 'a', 0, [ev('run.start')])]);
    assert.strictEqual(activity.t1[0].step, null);
    activity = mergeActivity(activity, chunk('t1', 'a', 1, [], undefined, 's1-exact-output')) ?? activity;
    assert.strictEqual(activity.t1[0].step, 's1-exact-output');
    activity = mergeActivity(activity, chunk('t1', 'a', 1, [ev('text', { text: 'x' })])) ?? activity;
    assert.strictEqual(activity.t1[0].step, 's1-exact-output');
  });

  test('a trial\'s logs and the trials themselves read in run order', () => {
    const activity = fold([
      chunk('t2', 'c', 0, [ev('run.start')], '2026-10-18T10:02:00.000+00:00'),
      chunk('t1', 'b', 0, [ev('run.start')], '2026-10-18T10:05:00.000+00:00', 's2'),
      chunk('t1', 'a', 0, [ev('run.start')], '2026-10-18T10:00:00.000+00:00', 's1'),
    ]);
    assert.deepStrictEqual(activity.t1.map((l) => l.step), ['s1', 's2']);
    assert.deepStrictEqual(activityTrials(activity), ['t1', 't2']);
  });

  test('a malformed chunk changes nothing', () => {
    assert.strictEqual(mergeActivity({}, { trial: 't1', log: 'a', first: -1, events: [] }), null);
    assert.strictEqual(mergeActivity({}, { trial: '', log: 'a', first: 0, events: [] }), null);
    assert.strictEqual(mergeActivity({}, { trial: 't1', log: 'a', first: 0, events: 'nope' }), null);
  });

  test('a fresh webview rebuilds the same activity from the host\'s full chunks', () => {
    const activity = fold([
      chunk('t1', 'a', 0, [ev('run.start'), ev('text', { text: 'one' })], undefined, 's1'),
      chunk('t2', 'c', 0, [ev('run.start')], '2026-10-18T10:02:00.000+00:00'),
    ]);
    const state = activityChunks(activity).reduce(
      (s, c) => reducer(s, { type: 'benchmark_activity', chunk: c }),
      initial,
    );
    assert.deepStrictEqual(state.benchmarkActivity, activity);
    assert.deepStrictEqual(state.session, []);
  });

  suite('as feed entries', () => {
    test('a tool call\'s card fills in with its rows and outcome', () => {
      const entries = activityEntries([
        ev('run.start', { agent: 'kodo_problem_solver' }),
        ev('thinking', { text: 'read it first' }),
        ev('tool.start', { tool: 'run_command', tool_call_id: 'c1' }),
        ev('tool.call', {
          tool: 'run_command', tool_call_id: 'c1', success: true, schema_compliance: true,
          rows: [{ name: 'stdout', value: 'ok', source: 'output', visibility: 'visible' }],
        }),
        ev('usage', { input_tokens: 100, output_tokens: 20, duration_seconds: 2.5 }),
        ev('text', { text: 'Done.' }),
        ev('run.result', { outcome: 'completed' }),
      ]);
      assert.deepStrictEqual(entries.map((e) => e.type), ['thinking_block', 'tool_call', 'status_response', 'assistant_response']);
      const card = entries[1];
      assert.ok(card.type === 'tool_call');
      assert.strictEqual(card.toolName, 'run_command');
      assert.strictEqual(card.success, true);
      assert.deepStrictEqual(card.rows, [{ name: 'stdout', value: 'ok', source: 'output', visibility: 'visible' }]);
      const status = entries[2];
      assert.ok(status.type === 'status_response');
      assert.strictEqual(status.durationMs, 2500);
    });

    test('a sub-agent run reads as a subsession, with its brief, under its display name', () => {
      const entries = activityEntries([
        ev('run.start', { agent: 'kodo_problem_solver' }),
        ev('subsession.start', { agent: 'kodo_planner', display_name: 'Planner', task: 'plan it' }),
        ev('text', { text: 'the plan' }),
        ev('subsession.end', { agent: 'kodo_planner', display_name: 'Planner', failed: true }),
      ]);
      assert.deepStrictEqual(entries.map((e) => e.type), ['subsession_divider', 'subagent_task', 'assistant_response', 'subsession_divider']);
      const [start, , , end] = entries;
      assert.ok(start.type === 'subsession_divider' && end.type === 'subsession_divider');
      assert.deepStrictEqual([start.displayName, start.parentDisplayName], ['Planner', 'kodo_problem_solver']);
      assert.strictEqual(end.failed, true);
    });

    test('errors and nudges show as the feed shows them; holes are skipped', () => {
      const entries = activityEntries([
        undefined,
        ev('error', { message: 'Cannot reach llama-server', recoverable: true }),
        ev('nudge', { reasons: ['repeated_tool_call'], mode: 'auto', ui_text: '' }),
      ]);
      assert.deepStrictEqual(entries.map((e) => e.type), ['error_notice', 'nudge']);
      const nudge = entries[1];
      assert.ok(nudge.type === 'nudge');
      assert.ok(nudge.uiText.includes('repeated_tool_call'));
    });
  });
});
