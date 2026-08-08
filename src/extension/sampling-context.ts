/**
 * Derives the current `SamplingContext` (which local quant the session's
 * request-level sampling parameters apply to, the values its active launch
 * configuration will start llama-server with, and the server's parameter
 * table) from window-global state, and broadcasts it to every open session tab.
 *
 * A pure leaf module, exactly like `thinking-context.ts` — reads only `state`,
 * so both `settings-io.ts` (mode/model switches) and `local-llm-registry.ts`
 * (registry/profile/knob changes) can trigger a broadcast without an import cycle.
 *
 * Deliberately carries no override *values*: those are per-session server
 * state (`state.sampling`, kodo/doc/SAMPLING.md §9), while everything here is
 * window-global — the active model and its launch configuration are one
 * machine-wide selection shared by every tab.
 */

import type { KnobDefs, LlamaArgSpec, SamplingContext, SamplingParamSpec } from '../llm-registry-types';
import { effectiveLlamaArgs, launchSamplingValues } from '../llm-registry-types';
import { state } from './state';

/** Parse the `sampling_specs` table off a `hello.ack`/`local_llm.registry_state`
 * payload (kodo/doc/WS_PROTOCOL.md §5.12a); `[]` if absent/malformed. */
export function parseSamplingSpecs(raw: unknown): SamplingParamSpec[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as SamplingParamSpec[];
}

/** Parse the `knob_defs` table off a `hello.ack`/`local_llm.registry_state`
 * payload (kodo/doc/LLM_REGISTRY.md §4.6); `{}` if absent/malformed. Lives
 * here beside `parseSamplingSpecs` because both are static tables riding the
 * same registry push, and this module is the leaf every other one can import. */
export function parseKnobDefs(raw: unknown): KnobDefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as KnobDefs;
}

/** Parse the `llama_arg_catalog` table off the same payload
 * (kodo/doc/LLM_REGISTRY.md §4.7); `[]` if absent/malformed — which simply
 * leaves the profile editor's raw text box as the only way to add args. */
export function parseLlamaArgCatalog(raw: unknown): LlamaArgSpec[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as LlamaArgSpec[];
}

/**
 * Derive the current `SamplingContext`. `model: ''` (no footer button) whenever
 * the session is on a cloud model or the active local entry isn't in the
 * registry — these are llama-server parameters with no Anthropic equivalent.
 *
 * `defaults` resolves through the same rule the server uses
 * (`resolve_effective_llama_config`, via `effectiveLlamaArgs`): the active
 * user-defined profile's args if one is selected, otherwise the Default
 * profile's knob-resolved args — then read back out of those launch args
 * (sampling has no separate stored state, see `launchSamplingValues`).
 */
export function currentSamplingContext(): SamplingContext {
  const entry = state.localRegistryState.find((e) => e.name === state.activeLocalModelState);
  if (state.modeState !== 'local' || !entry) {
    return { model: '', defaults: {}, specs: state.samplingSpecsState };
  }
  const defaults = launchSamplingValues(effectiveLlamaArgs(entry), state.samplingSpecsState);
  return { model: entry.name, defaults, specs: state.samplingSpecsState };
}

/** Push the current `SamplingContext` to every open session tab. Called
 * whenever any of its inputs change (hello.ack, local_llm.registry_state, a
 * model/mode switch, a profile or knob change) — same trigger set as
 * `broadcastThinkingContext`. */
export function broadcastSamplingContext(): void {
  const ctx = currentSamplingContext();
  for (const s of state.sessions.values()) {
    s.updateSamplingContext(ctx);
  }
}
