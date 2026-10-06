import * as assert from 'assert';

import type { Envelope } from '../envelope';
import { ModeToggleController } from '../session/mode-toggle-controller';

// A session started by `agent.run` (kodo/doc/WS_PROTOCOL.md §7.4h) — the
// Model Importer — runs one prompt and takes no further input. These check the
// host half of that contract: what goes on the wire, what the webview is told,
// and that the locked session never sends what the server would refuse.
suite('ModeToggleController — agent.run sessions', () => {
  function harness(): { toggle: ModeToggleController; sent: Envelope[]; posted: Record<string, unknown>[] } {
    const sent: Envelope[] = [];
    const posted: Record<string, unknown>[] = [];
    const toggle = new ModeToggleController(
      { family: null, tiers: [], defaultTier: '' },
      (msg) => posted.push(msg),
      (env) => sent.push(env),
    );
    return { toggle, sent, posted };
  }

  function lastModeState(posted: Record<string, unknown>[]): Record<string, unknown> {
    const states = posted.filter((m) => m.type === 'mode_state');
    return states[states.length - 1];
  }

  test('startAgentRun sends agent.run with the agent and its one prompt', () => {
    const { toggle, sent } = harness();
    toggle.startAgentRun('kodo_model_importer', 'acme/Model-GGUF');
    const run = sent.find((env) => env.payload.type === 'agent.run');
    assert.ok(run, 'agent.run was not sent');
    assert.deepStrictEqual(
      { name: run.payload.name, prompt: run.payload.prompt },
      { name: 'kodo_model_importer', prompt: 'acme/Model-GGUF' },
    );
    // Not the ordinary new-session bootstrap.
    assert.strictEqual(sent.some((env) => env.payload.type === 'agent.set'), false);
  });

  test('the webview is told the session is locked and autonomous before the server answers', () => {
    const { toggle, posted } = harness();
    toggle.startAgentRun('kodo_model_importer', 'acme/Model-GGUF');
    const state = lastModeState(posted);
    assert.strictEqual(state.interactive, false);
    assert.strictEqual(state.autonomous, true);
    assert.strictEqual(toggle.interactive, false);
  });

  test('a locked session sends no agent or mode change', () => {
    const { toggle, sent } = harness();
    toggle.startAgentRun('kodo_model_importer', 'acme/Model-GGUF');
    sent.length = 0;
    toggle.setTopAgent('kodo_problem_solver');
    toggle.setAutonomous(false);
    assert.deepStrictEqual(sent, []);
  });

  test('the lock follows the server: a state event decides it either way', () => {
    const { toggle, posted } = harness();
    toggle.applyStateEvent({ phase: 'running', interactive: false, top_agent: 'kodo_model_importer' });
    assert.strictEqual(toggle.interactive, false);
    assert.strictEqual(lastModeState(posted).interactive, false);
    // An older server sends no `interactive` field: every session takes input.
    toggle.applyStateEvent({ phase: 'idle', top_agent: 'kodo_problem_solver' });
    assert.strictEqual(toggle.interactive, true);
  });

  test('a resumed agent.run session comes back locked', () => {
    const { toggle } = harness();
    toggle.applyResumedState({ interactive: false, autonomous: true, top_agent: 'kodo_model_importer' });
    assert.strictEqual(toggle.interactive, false);
  });

  test('isRunning tracks the server phase, which is how a finished run is noticed', () => {
    const { toggle } = harness();
    toggle.applyStateEvent({ phase: 'running', interactive: false });
    assert.strictEqual(toggle.isRunning, true);
    toggle.applyStateEvent({ phase: 'done', interactive: false });
    assert.strictEqual(toggle.isRunning, false);
  });
});
