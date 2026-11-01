import * as assert from 'assert';

import { AGENT_LABEL_MAX_CHARS, shortAgentLabel } from '../webview/agentLabel';

// The composer's agent button shows the agent's name alone, cut to
// AGENT_LABEL_MAX_CHARS characters plus "…".

suite('shortAgentLabel', () => {
  test('a label longer than the limit keeps the limit and gains an ellipsis', () => {
    assert.strictEqual(shortAgentLabel('Problem Solver 12345'), 'Problem Solver 1…');
  });

  test('a label exactly at the limit is shown in full', () => {
    const label = 'x'.repeat(AGENT_LABEL_MAX_CHARS);
    assert.strictEqual(shortAgentLabel(label), label);
  });

  test('a short label is shown in full', () => {
    assert.strictEqual(shortAgentLabel('Researcher'), 'Researcher');
  });

  test('characters outside the BMP count as one each and are never split', () => {
    const label = '🧠'.repeat(AGENT_LABEL_MAX_CHARS + 1);
    assert.strictEqual(shortAgentLabel(label), `${'🧠'.repeat(AGENT_LABEL_MAX_CHARS)}…`);
  });
});
