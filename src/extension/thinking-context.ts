/**
 * Derives the current `ThinkingContext` (which thinking-tier family, if any,
 * the session's active *local* model belongs to) from window-global state,
 * and broadcasts it to every open session tab. A pure leaf module — reads
 * only `state`, so both `settings-io.ts` (mode switches) and
 * `local-llm-registry.ts` (model/registry changes) can trigger a broadcast
 * without an import cycle between them.
 */

import type { ThinkingContext, ThinkingFamilies } from '../llm-registry-types';
import { state } from './state';

/** Parse the `thinking_families` map off a `hello.ack`/`local_llm.registry_state`
 * payload (doc/WS_PROTOCOL.md §5.12a); `{}` if absent/malformed. */
export function parseThinkingFamilies(raw: unknown): ThinkingFamilies {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return raw as ThinkingFamilies;
}

/** Derive the current `ThinkingContext` from the window-global pieces that
 * determine it: `modeState`, `activeLocalModelState`/`localRegistryState`
 * (to resolve a local entry's `base_llm`), `activeCloudVendorState` (in cloud
 * mode the vendor key *is* the synthetic `base_llm` — every vendor has a
 * thinking family of its own, doc/LLM_REGISTRY.md §4.5a/§3a), and
 * `thinkingFamiliesState`. `family: null` whenever the session's active
 * model has no thinking-tier mechanism (a local entry outside both local
 * families, or a vendor the server sent no family for — the lookup below is
 * what decides that, never a hardcoded vendor list here). */
export function currentThinkingContext(): ThinkingContext {
  const activeEntry = state.localRegistryState.find((e) => e.name === state.activeLocalModelState);
  let baseLlm = '';
  if (state.modeState === 'local' && activeEntry) {
    baseLlm = activeEntry.base_llm;
  } else if (state.modeState === 'cloud') {
    baseLlm = state.activeCloudVendorState;
  }
  const info = baseLlm ? state.thinkingFamiliesState[baseLlm] : undefined;
  return info
    ? { family: info.family, tiers: info.tiers, defaultTier: info.default }
    : { family: null, tiers: [], defaultTier: '' };
}

/** Push the current `ThinkingContext` to every open session tab. The active
 * local/cloud model is a machine-global selection, not per-session, so every
 * tab shares one context — called whenever any of `currentThinkingContext`'s
 * inputs change (hello.ack, local_llm.registry_state, a model/mode switch). */
export function broadcastThinkingContext(): void {
  const ctx = currentThinkingContext();
  for (const s of state.sessions.values()) {
    s.updateThinkingContext(ctx);
  }
}
