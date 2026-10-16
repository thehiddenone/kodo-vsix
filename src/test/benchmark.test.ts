import * as assert from 'assert';

import {
  benchmarkArgs,
  benchmarkJobName,
  credentialEnv,
  quoteCommandLine,
} from '../extension/benchmark';

// The panel's Benchmark / Basics test (kodo/doc/AGENT_BUILDER.md §8) is only a
// command line run in a terminal, so what it must get right is that line and
// the environment the terminal gets — above all, that a stored key reaches
// kodo-harbor without overriding one the user's own environment sets (D37).
suite('benchmark', () => {
  const basics = {
    agent: 'acme_guide', model: 'qwen-9b', suite: 'agent-basics', attempts: 1,
    thinkingLevel: '', control: false,
  };

  test('a basics test runs the suite once, with no control and the default thinking tier', () => {
    assert.deepStrictEqual(benchmarkArgs(basics, '/h/.kodo/harbor/jobs', 'job', 'terminus-2'), [
      'run', '--agent', 'acme_guide', '--model', 'qwen-9b', '--suite', 'agent-basics',
      '--attempts', '1', '--jobs-dir', '/h/.kodo/harbor/jobs', '--job-name', 'job',
    ]);
  });

  test('a benchmark passes the control arm and the thinking level only when chosen', () => {
    const args = benchmarkArgs(
      { ...basics, suite: 'terminal-bench-sample', attempts: 3, thinkingLevel: 'high', control: true },
      '/jobs', 'job', 'terminus-2',
    );
    assert.deepStrictEqual(args, [
      'run', '--agent', 'acme_guide', '--model', 'qwen-9b', '--suite', 'terminal-bench-sample',
      '--attempts', '3', '--control', 'terminus-2', '--thinking-level', 'high',
      '--jobs-dir', '/jobs', '--job-name', 'job',
    ]);
  });

  test('the job name is the agent and a local timestamp', () => {
    assert.strictEqual(
      benchmarkJobName('acme_guide', new Date(2026, 9, 6, 7, 8, 9)),
      'acme_guide-2026-10-06_07-08-09',
    );
  });

  suite('credentialEnv', () => {
    const names = ['ANTHROPIC_API_KEY'];

    test('a stored key goes in under the preferred variable when none is set', () => {
      assert.deepStrictEqual(credentialEnv(names, 'sk-1', {}, null), { ANTHROPIC_API_KEY: 'sk-1' });
    });

    test('a key the environment already holds is left alone', () => {
      assert.deepStrictEqual(credentialEnv(names, 'sk-1', { ANTHROPIC_API_KEY: 'sk-env' }, null), {});
    });

    test('nothing is set without a stored key, or for a local model', () => {
      assert.deepStrictEqual(credentialEnv(names, undefined, {}, null), {});
      assert.deepStrictEqual(credentialEnv([], 'sk-1', {}, null), {});
    });

    test('Bedrock also gets its region, unless the environment names one', () => {
      const bedrock = ['BEDROCK_API_KEY', 'AWS_ACCESS_KEY_ID'];
      assert.deepStrictEqual(credentialEnv(bedrock, '{"k":1}', {}, 'eu-west-1'), {
        BEDROCK_API_KEY: '{"k":1}', AWS_REGION: 'eu-west-1',
      });
      assert.deepStrictEqual(
        credentialEnv(bedrock, '{"k":1}', { AWS_DEFAULT_REGION: 'us-east-2' }, 'eu-west-1'),
        { BEDROCK_API_KEY: '{"k":1}' },
      );
    });
  });

  suite('quoteCommandLine', () => {
    test('POSIX shells: plain words stay bare, anything else is single-quoted', () => {
      assert.strictEqual(
        quoteCommandLine('/home/me/.kodo/venv/bin/kodo-harbor', ['--jobs-dir', "/a b/it's"], 'darwin'),
        "/home/me/.kodo/venv/bin/kodo-harbor --jobs-dir '/a b/it'\\''s'",
      );
    });

    test('Windows: PowerShell call operator with single quotes doubled', () => {
      assert.strictEqual(
        quoteCommandLine('C:\\Users\\me\\kodo-harbor.exe', ["it's"], 'win32'),
        "& 'C:\\Users\\me\\kodo-harbor.exe' 'it''s'",
      );
    });
  });
});
