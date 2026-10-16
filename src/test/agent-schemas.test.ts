import * as assert from 'assert';

import { agentSchemaEntries, mergeAgentSchemaEntries } from '../extension/agent-schemas';
import type { JsonSchemaEntry } from '../extension/agent-schemas';

// The user's `json.schemas` is shared with every other extension and with the
// user's own entries (AGENT_BUILDER.md §4, D25): activation may only ever add
// or rewrite the two entries it owns, identified by their url.
suite('agent-schemas', () => {
  const ours = agentSchemaEntries('/home/me');
  const theirs: JsonSchemaEntry = { url: 'https://example.com/x.json', fileMatch: ['x.json'] };

  test('the entries point at the server-written schemas and the two agent globs', () => {
    assert.deepStrictEqual(
      ours.map((entry) => [entry.url, entry.fileMatch]),
      [
        ['file:///home/me/.kodo/etc/agent_schemas/top_agent.schema.json', ['/home/me/.kodo/agents/*/*.json']],
        [
          'file:///home/me/.kodo/etc/agent_schemas/subagent_spec.schema.json',
          ['/home/me/.kodo/agents/subagents/*/*.json'],
        ],
      ],
    );
  });

  test('a first activation appends both entries after the user\'s own', () => {
    assert.deepStrictEqual(mergeAgentSchemaEntries([theirs], ours), [theirs, ...ours]);
  });

  test('an activation with nothing to change asks for no write', () => {
    assert.strictEqual(mergeAgentSchemaEntries([theirs, ...ours], ours), undefined);
  });

  test('a stale entry of ours is rewritten in place, and others keep their position', () => {
    const stale = { ...ours[0], fileMatch: ['/old/*.json'] };
    assert.deepStrictEqual(mergeAgentSchemaEntries([stale, theirs], ours), [ours[0], theirs, ours[1]]);
  });

  test('duplicates of one of our entries collapse into one', () => {
    assert.deepStrictEqual(mergeAgentSchemaEntries([ours[1], theirs, ours[1]], ours), [
      ours[1],
      theirs,
      ours[0],
    ]);
  });
});
