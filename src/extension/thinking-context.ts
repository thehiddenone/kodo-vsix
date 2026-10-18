/**
 * Derives the current `ThinkingContext` (which thinking-tier family, if any,
 * the session's active *local* model belongs to) from window-global state,
 * and broadcasts it to every open session tab. A pure leaf module — reads
 * only `state`, so both `settings-io.ts` (mode switches) and
 * `local-llm-registry.ts` (model/registry changes) can trigger a broadcast
 * without an import cycle between them.
 */

import type { ThinkingContext, ThinkingFamilies, ThinkingFamily } from '../llm-registry-types';
import { selectionBaseLlm } from '../session-llm';
import type { LlmSelection } from '../session-llm';
import { state } from './state';

/** Parse the `thinking_families` map off a `hello.ack`/`local_llm.registry_state`
 * payload (doc/WS_PROTOCOL.md §5.12a); `{}` if absent/malformed. */
export function parseThinkingFamilies(raw: unknown): ThinkingFamilies {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return raw as ThinkingFamilies;
}

/** Derive the `ThinkingContext` for *selection* — a bound session's own pending
 * LLM (kodo/doc/SESSION_LLM_BINDING.md) — or, when `null`, for the sidebar's
 * card: `modeState`, `activeLocalModelState`/`localRegistryState` (to resolve a
 * local entry's `base_llm`) and `activeCloudVendorState` (in cloud mode the
 * vendor key *is* the synthetic `base_llm` — every vendor has a thinking family
 * of its own, doc/LLM_REGISTRY.md §4.5a/§3a), looked up in
 * `thinkingFamiliesState`. `family: null` whenever the model has no
 * thinking-tier mechanism (a local entry outside every local family, or a
 * vendor the server sent no family for — the lookup below is what decides
 * that, never a hardcoded vendor list here). */
export function currentThinkingContext(selection: LlmSelection | null = null): ThinkingContext {
  let baseLlm = '';
  if (selection !== null) {
    baseLlm = selectionBaseLlm(selection, state.localRegistryState);
  } else if (state.modeState === 'local') {
    baseLlm = state.localRegistryState.find((e) => e.name === state.activeLocalModelState)?.base_llm ?? '';
  } else if (state.modeState === 'cloud') {
    baseLlm = state.activeCloudVendorState;
  }
  const info = baseLlm ? state.thinkingFamiliesState[baseLlm] : undefined;
  return info
    ? { family: info.family, tiers: info.tiers, defaultTier: info.default }
    : { family: null, tiers: [], defaultTier: '' };
}

/** `base_llm` → thinking family, for naming tiers in a session's change element. */
export function currentThinkingFamilies(): Record<string, ThinkingFamily> {
  const out: Record<string, ThinkingFamily> = {};
  for (const [baseLlm, info] of Object.entries(state.thinkingFamiliesState)) {
    out[baseLlm] = info.family;
  }
  return out;
}

/** Re-derive every open tab's thinking and sampling contexts. Each bound tab
 * describes its own pending LLM and every unbound tab the sidebar's card, so
 * this runs whenever any input changes (hello.ack, local_llm.registry_state, a
 * sidebar pick) — one entry point for both contexts. */
export function broadcastThinkingContext(): void {
  for (const s of state.sessions.values()) {
    s.refreshLlmContexts();
  }
}
