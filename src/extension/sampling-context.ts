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
import type { LlmSelection } from '../session-llm';
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
 * Derive the `SamplingContext` for *selection* — a bound session's own pending
 * LLM (kodo/doc/SESSION_LLM_BINDING.md) — or, when `null`, for the sidebar's
 * card. `model: ''` (no footer button) whenever that is a cloud model or a
 * local entry the registry doesn't have — these are llama-server parameters
 * with no Anthropic equivalent.
 *
 * `defaults` resolves through the same rule the server uses
 * (`resolve_effective_llama_config`, via `effectiveLlamaArgs`): the active
 * user-defined profile's args if one is selected, otherwise the Default
 * profile's knob-resolved args — then read back out of those launch args
 * (sampling has no separate stored state, see `launchSamplingValues`).
 */
export function currentSamplingContext(selection: LlmSelection | null = null): SamplingContext {
  const name =
    selection === null
      ? state.modeState === 'local' ? state.activeLocalModelState : ''
      : selection.kind === 'local' ? selection.entry : '';
  const entry = name ? state.localRegistryState.find((e) => e.name === name) : undefined;
  if (!entry) {
    return { model: '', defaults: {}, specs: state.samplingSpecsState };
  }
  // A bound session's own user-defined profile launches with that profile's
  // args; its Default profile with knob values the registry payload does not
  // resolve per session, so those read the Default profile as the sidebar has it.
  const profile =
    selection?.kind === 'local' && selection.profileId
      ? entry.profiles.find((p) => p.id === selection.profileId)
      : undefined;
  const args = profile ? profile.llama_args : selection?.kind === 'local' ? entry.default_profile_args : effectiveLlamaArgs(entry);
  const defaults = launchSamplingValues(args, state.samplingSpecsState);
  return { model: entry.name, defaults, specs: state.samplingSpecsState };
}

/** Re-derive every open tab's sampling context — the same per-tab refresh as
 * `broadcastThinkingContext`, which recomputes both. */
export function broadcastSamplingContext(): void {
  for (const s of state.sessions.values()) {
    s.refreshLlmContexts();
  }
}
