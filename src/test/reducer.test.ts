import * as assert from 'assert';

import { reducer, initial } from '../webview/reducer';
import type { State } from '../webview/types';

// The mid-stream cyclic-thinking detector (doc/STUCK_DETECTION.md §2.7) --
// no VS Code window / WS / server needed, reducer.ts only ever imports types
// (erased at compile time), so this runs as pure state-transition logic.
suite('reducer — cyclic-thinking', () => {
  function streamingState(): State {
    return {
      ...initial,
      streamingThinking: 'the same three lines over and over',
      streamingTokens: '',
      thinkingActive: true,
      thinkingStartedAt: 1000,
      awaitingLlm: true,
      streaming: false,
      llmWaiting: null,
    };
  }

  suite('live: cyclic_thinking_notice (strike 1)', () => {
    test('commits streamingThinking into a thinking_block and clears the buffers', () => {
      const state = streamingState();

      const next = reducer(state, { type: 'cyclic_thinking_notice', message: 'reconsidering' });

      assert.strictEqual(next.streamingThinking, '');
      assert.strictEqual(next.streamingTokens, '');
      assert.strictEqual(next.thinkingActive, false);
      assert.strictEqual(next.thinkingStartedAt, null);

      const types = next.session.map((e) => e.type);
      assert.deepStrictEqual(types, ['thinking_block', 'cyclic_thinking_notice']);
      const notice = next.session[1];
      assert.ok(notice.type === 'cyclic_thinking_notice');
      assert.strictEqual(notice.message, 'reconsidering');
      assert.strictEqual(notice.exclude_from_context, true);
    });

    test('does NOT clear awaitingLlm/streaming/llmWaiting -- round 2 starts right after', () => {
      // The turn is not ending: _run_agent_turn immediately begins round 2,
      // whose own llm_turn_start will set these correctly. Clearing them
      // here too would just flicker the "awaiting response" indicator.
      const state = streamingState();

      const next = reducer(state, { type: 'cyclic_thinking_notice', message: 'reconsidering' });

      assert.strictEqual(next.awaitingLlm, state.awaitingLlm);
      assert.strictEqual(next.streaming, state.streaming);
      assert.strictEqual(next.llmWaiting, state.llmWaiting);
    });
  });

  suite('live: agent_cyclic_thinking_critical (strike 2)', () => {
    test('commits streamingThinking and clears every waiting indicator -- the turn ends here', () => {
      const state: State = {
        ...streamingState(),
        streamingToolgen: 'still generating',
        toolgenActive: true,
        toolgenToolName: 'run_command',
        toolgenStartedAt: 2000,
      };

      const next = reducer(state, {
        type: 'agent_cyclic_thinking_critical',
        message: 'gave up after a second loop',
      });

      assert.strictEqual(next.streamingThinking, '');
      assert.strictEqual(next.streamingTokens, '');
      assert.strictEqual(next.thinkingActive, false);
      assert.strictEqual(next.thinkingStartedAt, null);
      assert.strictEqual(next.awaitingLlm, false);
      assert.strictEqual(next.streaming, false);
      assert.strictEqual(next.llmWaiting, null);
      assert.strictEqual(next.streamingToolgen, '');
      assert.strictEqual(next.toolgenActive, false);
      assert.strictEqual(next.toolgenToolName, '');
      assert.strictEqual(next.toolgenStartedAt, null);

      const types = next.session.map((e) => e.type);
      assert.deepStrictEqual(types, ['thinking_block', 'agent_cyclic_thinking_critical']);
      const critical = next.session[1];
      assert.ok(critical.type === 'agent_cyclic_thinking_critical');
      assert.strictEqual(critical.message, 'gave up after a second loop');
      assert.strictEqual(critical.exclude_from_context, true);
    });
  });

  suite('replay: session_history', () => {
    test('rebuilds both new entry types from persisted wire entries', () => {
      const next = reducer(initial, {
        type: 'session_history',
        entries: [
          { type: 'cyclic_thinking_notice', message: 'reconsidering' },
          { type: 'agent_cyclic_thinking_critical', message: 'gave up after a second loop' },
        ],
        subsessions: {},
      });

      assert.deepStrictEqual(next.session, [
        { type: 'cyclic_thinking_notice', message: 'reconsidering', exclude_from_context: true },
        {
          type: 'agent_cyclic_thinking_critical',
          message: 'gave up after a second loop',
          exclude_from_context: true,
        },
      ]);
    });
  });
});
