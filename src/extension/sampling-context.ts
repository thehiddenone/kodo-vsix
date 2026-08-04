/**
 * Derives the current `SamplingContext` (which local quant the session's
 * request-level sampling parameters apply to, that quant's active flavor's
 * defaults, and the server's parameter table) from window-global state, and
 * broadcasts it to every open session tab.
 *
 * A pure leaf module, exactly like `thinking-context.ts` — reads only `state`,
 * so both `settings-io.ts` (mode/model switches) and `local-llm-registry.ts`
 * (registry/flavor changes) can trigger a broadcast without an import cycle.
 *
 * Deliberately carries no override *values*: those are per-session server
 * state (`state.sampling`, kodo/doc/SAMPLING.md §9), while everything here is
 * window-global — the active model and its flavors are one machine-wide
 * selection shared by every tab.
 */

import type { SamplingContext, SamplingParamSpec } from '../llm-registry-types';
import { flavorSamplingDefaults } from '../llm-registry-types';
import { state } from './state';

/** Parse the `sampling_specs` table off a `hello.ack`/`local_llm.registry_state`
 * payload (kodo/doc/WS_PROTOCOL.md §5.12a); `[]` if absent/malformed. */
export function parseSamplingSpecs(raw: unknown): SamplingParamSpec[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as SamplingParamSpec[];
}

/**
 * Derive the current `SamplingContext`. `model: ''` (no footer button) whenever
 * the session is on a cloud model or the active local entry isn't in the
 * registry — these are llama-server parameters with no Anthropic equivalent.
 *
 * `defaults` resolves through the same effective-flavor rule the server uses
 * (`get_effective_flavor_id`): the explicitly active flavor if it still
 * exists, otherwise the first one listed — then parsed out of that flavor's
 * own `llama_args` (a flavor has no separate sampling state, see
 * `flavorSamplingDefaults`).
 */
export function currentSamplingContext(): SamplingContext {
  const entry = state.localRegistryState.find((e) => e.name === state.activeLocalModelState);
  if (state.modeState !== 'local' || !entry) {
    return { model: '', defaults: {}, specs: state.samplingSpecsState };
  }
  const flavors = entry.flavors || [];
  const active = flavors.find((f) => f.id === entry.active_flavor) || flavors[0];
  const defaults = active ? flavorSamplingDefaults(active, state.samplingSpecsState) : {};
  return { model: entry.name, defaults, specs: state.samplingSpecsState };
}

/** Push the current `SamplingContext` to every open session tab. Called
 * whenever any of its inputs change (hello.ack, local_llm.registry_state, a
 * model/mode switch, a flavor edit) — same trigger set as
 * `broadcastThinkingContext`. */
export function broadcastSamplingContext(): void {
  const ctx = currentSamplingContext();
  for (const s of state.sessions.values()) {
    s.updateSamplingContext(ctx);
  }
}
