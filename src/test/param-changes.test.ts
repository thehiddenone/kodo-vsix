import * as assert from 'assert';

import {
  coerceParamChanges,
  describeParamChange,
  paramChangesView,
  sessionParamsLine,
} from '../webview/paramChanges';
import { reducer, initial } from '../webview/reducer';

// The change element and the header line (kodo/doc/SESSION_LLM_BINDING.md
// §4, D13): display only — which rows exist is the server's decision.

const FAMILIES = { qwen36: 'qwen_reasoning_budget', deepseek: 'deepseek_reasoning_effort' } as const;

suite('paramChanges — rows', () => {
  test('wire rows keep their from_/to_ context', () => {
    const [row] = coerceParamChanges([
      { param: 'thinking', label: 'Thinking', from: 'unlimited', to: 'high', from_base_llm: 'qwen36', to_base_llm: 'deepseek' },
    ]);
    assert.deepStrictEqual(row.fromExtra, { base_llm: 'qwen36' });
    assert.deepStrictEqual(row.toExtra, { base_llm: 'deepseek' });
  });

  test('malformed input yields no rows', () => {
    assert.deepStrictEqual(coerceParamChanges('nope'), []);
    assert.deepStrictEqual(coerceParamChanges([null, 3]), []);
  });

  test("thinking tiers are named by each side's own family", () => {
    const [change] = coerceParamChanges([
      { param: 'thinking', label: 'Thinking', from: 'unlimited', to: 'max', from_base_llm: 'qwen36', to_base_llm: 'deepseek' },
    ]);
    const row = describeParamChange(change, FAMILIES, false);
    assert.strictEqual(row.label, 'Thinking');
    assert.match(row.from, /Unlimited$/);
    // DeepSeek's `max` slug is the top of its own ladder, which reads "High".
    assert.match(row.to, /High$/);
  });

  test('modes and controls read with their popup names', () => {
    const changes = coerceParamChanges([
      { param: 'mode', label: 'Mode', from: 'interactive', to: 'autonomous' },
      { param: 'command_control', label: 'Tool Control', from: 'smart', to: 'permissive' },
    ]);
    const [mode, tools] = changes.map((c) => describeParamChange(c, {}, false));
    assert.match(mode.to, /Autonomous$/);
    assert.strictEqual(tools.label, 'Tool Control');
    assert.match(tools.to, /Permissive$/);
  });

  test('an unset value reads "not set" and a display name wins over the raw value', () => {
    const [sampling, agent] = coerceParamChanges([
      { param: 'sampling:temperature', label: 'Temperature', from: '0.8', to: null },
      { param: 'agent', label: 'Agent', from: 'kodo_guide', to: 'kodo_problem_solver', from_display: 'Guide', to_display: 'Problem Solver' },
    ]);
    assert.strictEqual(describeParamChange(sampling, {}, false).to, 'not set');
    assert.deepStrictEqual(describeParamChange(agent, {}, false), { label: 'Agent', from: 'Guide', to: 'Problem Solver' });
  });

  test('a first element is titled by its LLM and lists the rest without old values', () => {
    const changes = coerceParamChanges([
      { param: 'llm', label: 'LLM', from: null, to: 'Qwen 27B' },
      { param: 'mode', label: 'Mode', from: null, to: 'autonomous' },
    ]);
    const view = paramChangesView(changes, {}, true);
    assert.strictEqual(view.title, 'Started on Qwen 27B');
    assert.strictEqual(view.rows.length, 1);
    assert.strictEqual(view.rows[0].from, '');
  });

  test('a later element lists every change, the LLM included', () => {
    const changes = coerceParamChanges([{ param: 'llm', label: 'LLM', from: 'A', to: 'B' }]);
    const view = paramChangesView(changes, {}, false);
    assert.strictEqual(view.title, 'Session parameters changed');
    assert.deepStrictEqual(view.rows, [{ label: 'LLM', from: 'A', to: 'B' }]);
  });
});

suite('paramChanges — header line (D13)', () => {
  const base = {
    bound: true,
    label: 'Qwen 27B',
    nextLabel: '',
    autonomous: false,
    editControl: 'smart' as const,
    commandControl: 'defensive' as const,
    thinkingLevel: 'high',
    thinkingFamily: 'qwen_reasoning_budget' as const,
  };

  test('names the LLM and the four Session Parameters', () => {
    const line = sessionParamsLine(base);
    assert.match(line, /^LLM: Qwen 27B · /);
    assert.match(line, /Interactive · Edit: .* Smart · Tools: .* Defensive · Thinking: .* High$/);
  });

  test('an unbound session says so', () => {
    assert.match(sessionParamsLine({ ...base, bound: false }), /^LLM: not bound yet · /);
  });

  test('a pending switch shows where the next prompt goes', () => {
    assert.match(sessionParamsLine({ ...base, nextLabel: 'Granite' }), /^LLM: Qwen 27B → Granite \(next prompt\) · /);
  });

  test('a model without thinking reads Off', () => {
    assert.match(sessionParamsLine({ ...base, thinkingLevel: '', thinkingFamily: null }), /Thinking: Off$/);
  });
});

suite('reducer — the change element', () => {
  const changes = coerceParamChanges([{ param: 'llm', label: 'LLM', from: 'A', to: 'B' }]);

  test('goes right before the prompt the webview already echoed', () => {
    let state = reducer(initial, { type: 'prompt_sent', text: 'go' });
    state = reducer(state, { type: 'session_params', first: false, changes });
    assert.deepStrictEqual(state.session.map((e) => e.type), ['session_params', 'user_message']);
  });

  test('lands last when the turn has no typed prompt (a nudge)', () => {
    let state = reducer(initial, { type: 'greeting', text: 'hi' });
    state = reducer(state, { type: 'session_params', first: false, changes });
    assert.deepStrictEqual(state.session.map((e) => e.type), ['greeting', 'session_params']);
  });

  test('replays from history as the same entry', () => {
    const state = reducer(initial, {
      type: 'session_history',
      entries: [{ type: 'session_params', first: true, changes: [{ param: 'llm', label: 'LLM', from: null, to: 'B' }] }],
      subsessions: {},
    });
    const [entry] = state.session;
    assert.ok(entry.type === 'session_params');
    assert.strictEqual(entry.first, true);
    assert.strictEqual(entry.changes[0].to, 'B');
  });

  test('llm_state feeds the header line', () => {
    const state = reducer(initial, { type: 'llm_state', bound: true, label: 'Q', nextLabel: 'R', families: { q: 'qwen_reasoning_budget' } });
    assert.strictEqual(state.llmBound, true);
    assert.strictEqual(state.llmNextLabel, 'R');
    assert.deepStrictEqual(state.thinkingFamilies, { q: 'qwen_reasoning_budget' });
  });
});
