import * as assert from 'assert';

import { reducer, initial } from '../webview/reducer';
import { groupSessionEntries } from '../webview/groupSubsessions';
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

  suite('live: nudge, mid-stream source (strike 1)', () => {
    test('commits streamingThinking into a thinking_block and clears the buffers', () => {
      const state = streamingState();

      const next = reducer(state, {
        type: 'nudge',
        uiText: 'reconsidering',
        reasons: ['cyclic_thinking'],
        mode: 'auto',
        source: 'cyclic_thinking',
      });

      assert.strictEqual(next.streamingThinking, '');
      assert.strictEqual(next.streamingTokens, '');
      assert.strictEqual(next.thinkingActive, false);
      assert.strictEqual(next.thinkingStartedAt, null);

      const types = next.session.map((e) => e.type);
      assert.deepStrictEqual(types, ['thinking_block', 'nudge']);
      const notice = next.session[1];
      assert.ok(notice.type === 'nudge');
      assert.strictEqual(notice.uiText, 'reconsidering');
      assert.strictEqual(notice.source, 'cyclic_thinking');
      assert.strictEqual(notice.exclude_from_context, true);
    });

    test('also clears the toolgen buffer (think-in-tool-call/tool-call-cyclic sources)', () => {
      const state: State = {
        ...streamingState(),
        streamingToolgen: 'still generating',
        toolgenActive: true,
        toolgenToolName: 'run_subagent',
        toolgenStartedAt: 2000,
      };

      const next = reducer(state, {
        type: 'nudge',
        uiText: 'stopped a stray <think> tag',
        reasons: ['think_in_tool_call'],
        mode: 'auto',
        source: 'think_in_tool_call',
      });

      assert.strictEqual(next.streamingToolgen, '');
      assert.strictEqual(next.toolgenActive, false);
      assert.strictEqual(next.toolgenToolName, '');
      assert.strictEqual(next.toolgenStartedAt, null);
    });

    test('does NOT clear awaitingLlm/streaming/llmWaiting -- round 2 starts right after', () => {
      // The turn is not ending: _run_agent_turn immediately begins round 2,
      // whose own llm_turn_start will set these correctly. Clearing them
      // here too would just flicker the "awaiting response" indicator.
      const state = streamingState();

      const next = reducer(state, {
        type: 'nudge',
        uiText: 'reconsidering',
        reasons: ['cyclic_thinking'],
        mode: 'auto',
        source: 'cyclic_thinking',
      });

      assert.strictEqual(next.awaitingLlm, state.awaitingLlm);
      assert.strictEqual(next.streaming, state.streaming);
      assert.strictEqual(next.llmWaiting, state.llmWaiting);
    });
  });

  suite('live: nudge, non-mid-stream source (stall / missing_return_result)', () => {
    test('plain-appends without touching any streaming buffer', () => {
      const state = streamingState();

      const next = reducer(state, {
        type: 'nudge',
        uiText: 'continued automatically',
        reasons: ['empty_final_turn'],
        mode: 'auto',
        source: 'stall',
      });

      // Unlike the mid-stream case, streamingThinking is left exactly as-is
      // -- an ordinary stall nudge only ever fires after a round already
      // ended cleanly, so there is nothing live to commit.
      assert.strictEqual(next.streamingThinking, state.streamingThinking);
      assert.deepStrictEqual(
        next.session.map((e) => e.type),
        ['nudge'],
      );
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
    test('rebuilds both entry types from persisted wire entries', () => {
      const next = reducer(initial, {
        type: 'session_history',
        entries: [
          {
            type: 'nudge',
            uiText: 'reconsidering',
            reasons: ['cyclic_thinking'],
            mode: 'auto',
            source: 'cyclic_thinking',
          },
          { type: 'agent_cyclic_thinking_critical', message: 'gave up after a second loop' },
        ],
        subsessions: {},
      });

      assert.deepStrictEqual(next.session, [
        {
          type: 'nudge',
          uiText: 'reconsidering',
          reasons: ['cyclic_thinking'],
          mode: 'auto',
          source: 'cyclic_thinking',
          exclude_from_context: true,
        },
        {
          type: 'agent_cyclic_thinking_critical',
          message: 'gave up after a second loop',
          exclude_from_context: true,
        },
      ]);
    });
  });
});

// Stopping the agent while a subsession is running must close out the
// collapsible block instead of leaving it open forever: the server now sends
// a subsession_ended event (marked failed) before the state event that
// produces the 'interrupted' action (see kodo's stop()/_abort_active_subsession
// in _subagents.py) -- this only exercises the client's existing reducer/
// grouping logic against that same live-event order, no reducer.ts changes
// were needed for this half of the fix.
suite('reducer + groupSessionEntries -- Stop mid-subsession', () => {
  test('subsession_ended(failed) then interrupted closes the block and places the callout outside it', () => {
    let state = initial;
    state = reducer(state, { type: 'subsession_started', displayName: 'Investigator', task: 'look into it' });
    state = reducer(state, { type: 'token', text: 'partial findings so far' });
    state = reducer(state, {
      type: 'subsession_ended',
      displayName: 'Investigator',
      parentDisplayName: 'Guide',
      failed: true,
    });
    state = reducer(state, { type: 'interrupted' });

    const blocks = groupSessionEntries(state.session);
    assert.strictEqual(blocks.length, 2);

    const [group, callout] = blocks;
    assert.strictEqual(group.kind, 'subsession_group');
    assert.ok(group.kind === 'subsession_group');
    assert.notStrictEqual(group.endEntry, null);
    assert.strictEqual(group.endEntry?.failed, true);
    // The in-flight assistant text streamed inside the subsession stays part
    // of its collapsible block...
    assert.deepStrictEqual(
      group.inner.map((e) => e.type),
      ['assistant_response'],
    );

    // ...while the interrupted callout lands as its own top-level block,
    // outside the (now closed) subsession group.
    assert.strictEqual(callout.kind, 'entry');
    assert.ok(callout.kind === 'entry');
    assert.strictEqual(callout.entry.type, 'interrupted');
  });

  test('a message sent after Stop is a new top-level block, not swallowed into the closed group', () => {
    let state = initial;
    state = reducer(state, { type: 'subsession_started', displayName: 'Investigator', task: 'look into it' });
    state = reducer(state, {
      type: 'subsession_ended',
      displayName: 'Investigator',
      parentDisplayName: 'Guide',
      failed: true,
    });
    state = reducer(state, { type: 'interrupted' });
    state = reducer(state, {
      type: 'prompt_sent',
      text: 'continue',
    });

    const blocks = groupSessionEntries(state.session);
    const last = blocks[blocks.length - 1];
    assert.strictEqual(last.kind, 'entry');
    assert.ok(last.kind === 'entry');
    assert.strictEqual(last.entry.type, 'user_message');
  });
});
