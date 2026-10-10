import * as assert from 'assert';

import { llmFilterNeedle, matchesLlmFilter } from '../settings-webview/localLlmUtils';
import type { LocalRegistryEntry } from '../settings-webview/types';

// The Kōdo Settings panel's "Installed" and "Available local LLM quants"
// filter boxes. Pure string logic — no VS Code window, no webview, no server.
function entry(overrides: Partial<LocalRegistryEntry>): LocalRegistryEntry {
  return {
    name: 'bartowski-ling-3-0-flash-q4-k-m',
    kind: 'hardcoded_hf',
    description: 'Ling 3.0 Flash Q4_K_M by bartowski',
    repo_id: 'bartowski/Ling-3.0-flash-GGUF',
    installed: false,
    knobs: [],
    knob_selections: {},
    default_profile_args: {},
    profiles: [],
    ...overrides,
  };
}

suite('llmFilterNeedle', () => {
  test('stays inactive below three characters', () => {
    assert.strictEqual(llmFilterNeedle(''), null);
    assert.strictEqual(llmFilterNeedle('q4'), null);
    assert.strictEqual(llmFilterNeedle('  q4  '), null);
  });

  test('activates at three characters, trimmed and lower-cased', () => {
    assert.strictEqual(llmFilterNeedle(' Q4_ '), 'q4_');
  });
});

suite('matchesLlmFilter', () => {
  test('an inactive filter matches everything', () => {
    assert.strictEqual(matchesLlmFilter(entry({}), null), true);
  });

  test('matches the displayed quant name, case-insensitively', () => {
    assert.strictEqual(matchesLlmFilter(entry({}), llmFilterNeedle('flash q4_k')), true);
  });

  test('matches the Hugging Face repo id', () => {
    const e = entry({ description: 'Something else' });
    assert.strictEqual(matchesLlmFilter(e, llmFilterNeedle('bartowski/ling')), true);
  });

  test('falls back to the name when there is no description', () => {
    const e = entry({ kind: 'custom_file', name: 'my-local-model', description: undefined, repo_id: undefined });
    assert.strictEqual(matchesLlmFilter(e, llmFilterNeedle('local')), true);
  });

  test('matches the base LLM name, so every quant of a matching family survives', () => {
    const needle = llmFilterNeedle('gemma4');
    const quants = ['Q4_K_M', 'Q8_0'].map((q) => entry({
      base_llm: 'Gemma4-26B-A4B', description: `Gemma 4 26B ${q} by unsloth`, repo_id: 'unsloth/gemma-4-26b-GGUF',
    }));
    const other = entry({ base_llm: 'Ling-3.0-Flash' });
    assert.deepStrictEqual(quants.map((e) => matchesLlmFilter(e, needle)), [true, true]);
    assert.strictEqual(matchesLlmFilter(other, needle), false);
  });

  test('rejects an entry no field matches', () => {
    assert.strictEqual(matchesLlmFilter(entry({}), llmFilterNeedle('gemma')), false);
  });
});
