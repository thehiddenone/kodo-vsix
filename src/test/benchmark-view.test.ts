import * as assert from 'assert';

import {
  BenchmarkProgress,
  benchmarkActive,
  benchmarkStatusLine,
  benchmarkStopNotice,
  formatReward,
  formatSeconds,
  parseBenchmarkJob,
} from '../benchmark-view';
import type { BenchmarkView } from '../benchmark-view';
import { initial, reducer } from '../webview/reducer';

// A benchmark session's tab (kodo doc/BENCHMARK_SESSIONS.md §5) is folded from
// four server messages: `state.job`, `harbor.trial`, `harbor.finished` and,
// on every (re)connect, `session.history`. What must hold: each trial shows
// once, history is authoritative without dropping trials pushed after it, and
// the status line says where the run is.
const JOB = {
  status: 'running', kind: 'basics', agent: 'kodo_problem_solver', model: 'qwen-9b',
  suite: 'agent-basics', attempts: 1, control: false, thinking_level: null,
  job_dir: '/h/.kodo/harbor/jobs/j', log_path: '/h/.kodo/sessions/s/harbor-output.log',
  started_at: '2026-10-18T10:00:00+00:00',
};

function trial(name: string, reward: number | null, total: number | null = 3): Record<string, unknown> {
  return {
    trial: name, task: `org/${name}`, arm: 'kodo[kodo_problem_solver] @ local/qwen-9b',
    reward, seconds: 61.4, exceptions: [], finished: 1, total,
  };
}

suite('benchmark view', () => {
  test('a session with no job is no benchmark session', () => {
    const progress = new BenchmarkProgress();
    assert.strictEqual(progress.adoptJob(null), false);
    assert.strictEqual(progress.snapshot(), null);
    assert.strictEqual(parseBenchmarkJob(undefined), null);
  });

  test('the job record is adopted, and an unchanged one changes nothing', () => {
    const progress = new BenchmarkProgress();
    assert.strictEqual(progress.adoptJob(JOB), true);
    assert.strictEqual(progress.adoptJob({ ...JOB }), false);
    const view = progress.snapshot()!;
    assert.strictEqual(view.job.kind, 'basics');
    assert.strictEqual(view.job.thinkingLevel, null);
    assert.strictEqual(view.job.logPath, JOB.log_path);
    assert.strictEqual(benchmarkActive(view.job), true);
    assert.strictEqual(benchmarkActive({ ...view.job, status: 'stopped' }), false);
  });

  test('each trial shows once, in arrival order, with the run\'s total', () => {
    const progress = new BenchmarkProgress();
    progress.adoptJob(JOB);
    assert.strictEqual(progress.addTrial(trial('t1', 1)), true);
    assert.strictEqual(progress.addTrial(trial('t1', 1)), false);
    assert.strictEqual(progress.addTrial(trial('t2', null)), true);
    const view = progress.snapshot()!;
    assert.deepStrictEqual(view.trials.map((t) => [t.trial, t.reward]), [['t1', 1], ['t2', null]]);
    assert.strictEqual(view.total, 3);
  });

  test('history is authoritative, and trials pushed after it stay after it', () => {
    const progress = new BenchmarkProgress();
    progress.adoptJob(JOB);
    progress.addTrial(trial('t3', 0));
    const held = progress.adoptHistory([
      { type: 'harbor_job', agent: 'kodo_problem_solver' },
      { type: 'harbor_trial', ...trial('t1', 1) },
      { type: 'harbor_trial', ...trial('t2', 0.5) },
    ]);
    assert.strictEqual(held, true);
    assert.deepStrictEqual(progress.snapshot()!.trials.map((t) => t.trial), ['t1', 't2', 't3']);
  });

  test('a Stop the user pressed shows a red callout; a shutdown\'s stop shows none', () => {
    assert.strictEqual(benchmarkStopNotice(parseBenchmarkJob(JOB)!), null);
    const byUser = benchmarkStopNotice(parseBenchmarkJob({ ...JOB, status: 'stopping', stopped_by: 'user' })!);
    assert.ok(byUser !== null);
    assert.ok(byUser.startsWith('<kodo_crit>') && byUser.endsWith('</kodo_crit>'), byUser);
    assert.ok(byUser.includes('stopped by user'));
    assert.strictEqual(benchmarkStopNotice(parseBenchmarkJob({ ...JOB, status: 'stopped', stopped_by: 'server' })!), null);
  });

  test('history without a run changes nothing', () => {
    const progress = new BenchmarkProgress();
    assert.strictEqual(progress.adoptHistory([{ type: 'user_message', content: 'hi' }]), false);
  });

  test('the end is kept, from the live event or from history', () => {
    const progress = new BenchmarkProgress();
    progress.adoptJob({ ...JOB, status: 'failed' });
    progress.adoptHistory([
      { type: 'harbor_finished', outcome: 'failed', exit_code: 2, summary_markdown: '',
        detail: 'Docker is required', job_dir: '/j', log_path: '/l' },
    ]);
    const finished = progress.snapshot()!.finished!;
    assert.strictEqual(finished.outcome, 'failed');
    assert.strictEqual(finished.exitCode, 2);
    assert.strictEqual(finished.detail, 'Docker is required');
  });

  suite('status line', () => {
    function view(status: string, trials: number, total: number | null): BenchmarkView {
      const progress = new BenchmarkProgress();
      progress.adoptJob({ ...JOB, status });
      for (let i = 0; i < trials; i++) {
        progress.addTrial(trial(`t${i}`, 1, total));
      }
      return progress.snapshot()!;
    }

    test('says what a starting run waits for', () => {
      assert.match(benchmarkStatusLine(view('waiting', 0, null)), /^Starting: waiting for llama\.cpp/);
      assert.match(benchmarkStatusLine(view('running', 0, null)), /Harbor is starting/);
    });

    test('counts finished trials against the total once Harbor has written it', () => {
      assert.strictEqual(benchmarkStatusLine(view('running', 2, 7)), 'Running: 2 of 7 trials finished');
      assert.match(benchmarkStatusLine(view('stopping', 2, 7)), /winding down .*\(2 of 7 finished\)/);
      assert.strictEqual(benchmarkStatusLine(view('stopped', 2, 7)), 'Stopped: 2 of 7 trials finished');
      assert.strictEqual(benchmarkStatusLine(view('completed', 1, 1)), 'Finished: 1 trial');
      assert.match(benchmarkStatusLine(view('interrupted', 0, null)), /Kōdo server stopped/);
    });
  });

  test('rewards and agent time read as numbers people scan', () => {
    assert.strictEqual(formatReward(null), '—');
    assert.strictEqual(formatReward(1), '1');
    assert.strictEqual(formatReward(0.7142857), '0.714');
    assert.strictEqual(formatSeconds(null), '—');
    assert.strictEqual(formatSeconds(42.4), '42s');
    assert.strictEqual(formatSeconds(185), '3m 05s');
  });

  test('the webview keeps the host\'s view, and history entries never reach the chat feed', () => {
    const progress = new BenchmarkProgress();
    progress.adoptJob(JOB);
    let state = reducer(initial, { type: 'benchmark', view: progress.snapshot() });
    assert.strictEqual(state.benchmark?.job.model, 'qwen-9b');
    state = reducer(state, {
      type: 'session_history',
      entries: [{ type: 'harbor_job' }, { type: 'harbor_trial', ...trial('t1', 1) }],
      subsessions: {},
    });
    assert.deepStrictEqual(state.session, []);
    assert.strictEqual(reducer(state, { type: 'benchmark', view: null }).benchmark, null);
  });

  test('a wait for a benchmark carries its session\'s title', () => {
    const state = reducer(initial, {
      type: 'llm_waiting', waiting: true, reason: 'benchmark', retryIn: null, title: 'Basics test: a · m',
    });
    assert.deepStrictEqual(state.llmWaiting, { reason: 'benchmark', retryIn: null, title: 'Basics test: a · m' });
  });
});
