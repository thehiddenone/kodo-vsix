import * as assert from 'assert';

import type { CloudRegistry, LocalRegistryEntry } from '../llm-registry-types';
import {
  parseSessionLlm,
  sameLlmSelection,
  selectionBaseLlm,
  settingsPatchFor,
  topmostLocalCard,
  unavailableReason,
} from '../session-llm';
import type { AvailabilityFacts, LlmSelection } from '../session-llm';

// A session's own LLM (kodo/doc/SESSION_LLM_BINDING.md): the pure rules the
// extension applies when a bound session's tab comes to the front.

function entry(name: string, overrides: Partial<LocalRegistryEntry> = {}): LocalRegistryEntry {
  return {
    name,
    kind: 'hardcoded_hf',
    description: `${name} description`,
    installed: true,
    base_llm: `${name}-base`,
    knob_selections: {},
    profiles: [],
    active_profile: '',
    default_profile_args: {},
    ...overrides,
  } as LocalRegistryEntry;
}

const CLOUD: CloudRegistry = {
  anthropic: {
    display_name: 'Anthropic',
    models: [{ model_id: 'claude-opus-5', name: 'Claude Opus 5', description: '', context_window: 0, recommendation: '' }],
  },
};

const LOCAL: LlmSelection = { kind: 'local', entry: 'q', profileId: '', knobs: {} };
const ANTHROPIC: LlmSelection = {
  kind: 'cloud',
  vendor: 'anthropic',
  tiers: { high: 'claude-opus-5' },
  uniformEnabled: false,
  uniformModel: '',
  openrouterAuto: false,
};

function facts(overrides: Partial<AvailabilityFacts> = {}): AvailabilityFacts {
  return {
    registry: [entry('q')],
    cloudRegistry: CLOUD,
    hasKey: () => true,
    cloudModelKnown: (vendor, id) => CLOUD[vendor]?.models.some((m) => m.model_id === id) ?? null,
    ...overrides,
  };
}

suite('session-llm — parsing state.llm', () => {
  test('a missing or malformed field reads as unbound', () => {
    assert.strictEqual(parseSessionLlm(undefined).bound, false);
    assert.strictEqual(parseSessionLlm({ bound: true, binding: 'nope' }).bound, false);
  });

  test('a bound local session keeps its profile and knobs', () => {
    const llm = parseSessionLlm({
      bound: true,
      binding: { kind: 'local', entry: 'q', profile_id: 'tight', knobs: { ctx: '64k' }, command: ['x'] },
      selection: { kind: 'local', entry: 'q', profile_id: 'tight', knobs: { ctx: '64k' } },
      label: 'Q',
      next_label: '',
    });
    assert.strictEqual(llm.bound, true);
    assert.deepStrictEqual(llm.selection, { kind: 'local', entry: 'q', profileId: 'tight', knobs: { ctx: '64k' } });
    assert.strictEqual(llm.label, 'Q');
  });

  test('a cloud selection carries its tier snapshot', () => {
    const llm = parseSessionLlm({
      bound: true,
      binding: { kind: 'cloud', vendor: 'anthropic', tiers: { high: 'claude-opus-5' }, uniform: { enabled: true, model_id: 'm' }, openrouter_auto: false },
      selection: null,
    });
    assert.deepStrictEqual(llm.binding, {
      kind: 'cloud',
      vendor: 'anthropic',
      tiers: { high: 'claude-opus-5' },
      uniformEnabled: true,
      uniformModel: 'm',
      openrouterAuto: false,
    });
  });
});

suite('session-llm — same card', () => {
  test('key order does not matter', () => {
    const a: LlmSelection = { kind: 'local', entry: 'q', profileId: '', knobs: { a: '1', b: '2' } };
    const b: LlmSelection = { kind: 'local', entry: 'q', profileId: '', knobs: { b: '2', a: '1' } };
    assert.ok(sameLlmSelection(a, b));
  });

  test('a knob value does', () => {
    const a: LlmSelection = { kind: 'local', entry: 'q', profileId: '', knobs: { a: '1' } };
    const b: LlmSelection = { kind: 'local', entry: 'q', profileId: '', knobs: { a: '2' } };
    assert.ok(!sameLlmSelection(a, b));
  });
});

suite('session-llm — availability (D11)', () => {
  test('an installed local card is available', () => {
    assert.strictEqual(unavailableReason(LOCAL, facts()), null);
  });

  test('a removed or uninstalled local card is not', () => {
    assert.match(unavailableReason(LOCAL, facts({ registry: [] })) ?? '', /no longer installed/);
    assert.match(unavailableReason(LOCAL, facts({ registry: [entry('q', { installed: false })] })) ?? '', /no longer installed/);
  });

  test('a self-hosted card counts as present while its entry exists', () => {
    const registry = [entry('q', { kind: 'custom_server_url', installed: false })];
    assert.strictEqual(unavailableReason(LOCAL, facts({ registry })), null);
  });

  test('a cloud card without a stored key is not available', () => {
    assert.match(unavailableReason(ANTHROPIC, facts({ hasKey: () => false })) ?? '', /no Anthropic API key/);
  });

  test('a model that left the catalog is not available', () => {
    const retired: LlmSelection = { ...ANTHROPIC, tiers: { high: 'claude-gone' } } as LlmSelection;
    assert.match(unavailableReason(retired, facts()) ?? '', /no longer offers "claude-gone"/);
  });

  test('an unknown catalog (not fetched yet) is not held against a card', () => {
    const openrouter: LlmSelection = { ...ANTHROPIC, vendor: 'openrouter', tiers: { high: 'x/y' } } as LlmSelection;
    assert.strictEqual(unavailableReason(openrouter, facts({ cloudModelKnown: () => null })), null);
  });

  test('profile and flag drift never count', () => {
    const drifted: LlmSelection = { kind: 'local', entry: 'q', profileId: 'deleted', knobs: { gone: 'x' } };
    assert.strictEqual(unavailableReason(drifted, facts()), null);
  });
});

suite('session-llm — fallback card (D12)', () => {
  test('the first pinned card wins, in pin order', () => {
    const registry = [entry('a'), entry('b'), entry('c')];
    assert.strictEqual(topmostLocalCard(registry, ['c', 'b'])?.name, 'c');
  });

  test('without pins it is the first installed card', () => {
    const registry = [entry('a', { installed: false }), entry('b')];
    assert.strictEqual(topmostLocalCard(registry, [])?.name, 'b');
  });

  test('a self-hosted card can be the topmost one', () => {
    const registry = [entry('remote', { kind: 'custom_server_url' }), entry('b')];
    assert.strictEqual(topmostLocalCard(registry, [])?.name, 'remote');
  });

  test('no installed card means none', () => {
    assert.strictEqual(topmostLocalCard([entry('a', { installed: false })], ['a']), null);
  });
});

suite('session-llm — sidebar patch', () => {
  test('a local card sets the mode and the local entry only', () => {
    const patch = settingsPatchFor(LOCAL, { local: 'old', cloud: { openai: { high: 'gpt' } } });
    assert.deepStrictEqual(patch, { mode: 'local', models: { local: 'q', cloud: { openai: { high: 'gpt' } } } });
  });

  test("a cloud card replaces its vendor's tiers and keeps the others", () => {
    const patch = settingsPatchFor(ANTHROPIC, { cloud: { openai: { high: 'gpt' }, anthropic: { low: 'x' } } });
    assert.strictEqual(patch.mode, 'cloud');
    assert.strictEqual(patch.active_cloud_vendor, 'anthropic');
    const models = patch.models as Record<string, Record<string, unknown>>;
    assert.deepStrictEqual(models.cloud, { openai: { high: 'gpt' }, anthropic: { high: 'claude-opus-5' } });
    assert.deepStrictEqual(models.cloud_uniform, { anthropic: { enabled: false, model_id: null } });
    assert.ok(!('openrouter_auto_mode' in patch));
  });

  test("only OpenRouter's card writes its Auto mode", () => {
    const openrouter = { ...ANTHROPIC, vendor: 'openrouter', openrouterAuto: true } as LlmSelection;
    assert.strictEqual(settingsPatchFor(openrouter, {}).openrouter_auto_mode, true);
  });
});

suite('session-llm — thinking family key', () => {
  test("a local card's base_llm, or the cloud vendor", () => {
    assert.strictEqual(selectionBaseLlm(LOCAL, [entry('q')]), 'q-base');
    assert.strictEqual(selectionBaseLlm(ANTHROPIC, []), 'anthropic');
  });
});
