/**
 * A session's own LLM (kodo doc/SESSION_LLM_BINDING.md): the wire shapes of
 * `state.llm`, and the pure rules the extension applies to them — whether a
 * bound session's LLM is still available (D11), which card the sidebar falls
 * back to when it is not (D12), and the `settings.json` patch that puts a
 * session's card into the sidebar (§5).
 *
 * Pure (no `vscode`, no window state), so every rule here is unit-tested.
 */

import type { CloudRegistry, LocalRegistryEntry } from './llm-registry-types';

/** A local card: a registry entry with its own profile and knob values. */
export interface LocalLlmSelection {
  kind: 'local';
  entry: string;
  profileId: string;
  knobs: Record<string, string>;
}

/** A cloud card: a vendor with a snapshot of its tier models. */
export interface CloudLlmSelection {
  kind: 'cloud';
  vendor: string;
  tiers: Record<string, string>;
  uniformEnabled: boolean;
  uniformModel: string;
  openrouterAuto: boolean;
}

export type LlmSelection = LocalLlmSelection | CloudLlmSelection;

/** `state.llm`: what the session ran on, and what its next prompt binds to. */
export interface SessionLlm {
  bound: boolean;
  binding: LlmSelection | null;
  selection: LlmSelection | null;
  /** The bound LLM's display name (`''` while unbound). */
  label: string;
  /** The pending LLM's display name when it differs from the bound one, else `''`. */
  nextLabel: string;
}

export const UNBOUND_LLM: SessionLlm = {
  bound: false,
  binding: null,
  selection: null,
  label: '',
  nextLabel: '',
};

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function stringMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(raw))) {
    if (v !== null && v !== undefined) {
      out[k] = String(v);
    }
  }
  return out;
}

/** Parse one selection off the wire (`LlmSelection.to_json`); `null` if it is not one. */
export function parseLlmSelection(raw: unknown): LlmSelection | null {
  const data = record(raw);
  if (data.kind === 'local') {
    return {
      kind: 'local',
      entry: String(data.entry ?? ''),
      profileId: String(data.profile_id ?? ''),
      knobs: stringMap(data.knobs),
    };
  }
  if (data.kind === 'cloud') {
    const uniform = record(data.uniform);
    return {
      kind: 'cloud',
      vendor: String(data.vendor ?? ''),
      tiers: stringMap(data.tiers),
      uniformEnabled: uniform.enabled === true,
      uniformModel: uniform.model_id ? String(uniform.model_id) : '',
      openrouterAuto: data.openrouter_auto === true,
    };
  }
  return null;
}

/** Parse `state.llm`; an absent or malformed field reads as unbound. */
export function parseSessionLlm(raw: unknown): SessionLlm {
  const data = record(raw);
  const binding = parseLlmSelection(data.binding);
  return {
    bound: data.bound === true && binding !== null,
    binding,
    selection: parseLlmSelection(data.selection),
    label: String(data.label ?? ''),
    nextLabel: String(data.next_label ?? ''),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Whether two selections name the same card with the same settings (key order ignored). */
export function sameLlmSelection(a: LlmSelection | null, b: LlmSelection | null): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** The thinking-family key of *selection*: a local entry's `base_llm`, or the cloud vendor. */
export function selectionBaseLlm(selection: LlmSelection, registry: readonly LocalRegistryEntry[]): string {
  if (selection.kind === 'cloud') {
    return selection.vendor;
  }
  return registry.find((e) => e.name === selection.entry)?.base_llm ?? '';
}

/** What the availability check needs from the window (§5, D11). */
export interface AvailabilityFacts {
  registry: readonly LocalRegistryEntry[];
  cloudRegistry: CloudRegistry;
  /** Whether a key for *vendor* is stored. */
  hasKey: (vendor: string) => boolean;
  /** Whether *modelId* is in *vendor*'s catalog; `null` when that catalog is unknown (not fetched). */
  cloudModelKnown: (vendor: string, modelId: string) => boolean | null;
}

/**
 * Why *selection* cannot be bound again, or `null` when it can (D11): its
 * local GGUF or self-hosted entry is gone, its cloud vendor has no key, or a
 * model id in its snapshot is no longer in the vendor's catalog. Profile and
 * flag drift never count.
 */
export function unavailableReason(selection: LlmSelection, facts: AvailabilityFacts): string | null {
  if (selection.kind === 'local') {
    const entry = facts.registry.find((e) => e.name === selection.entry);
    if (!entry || (entry.kind !== 'custom_server_url' && !entry.installed)) {
      return `the local LLM "${selection.entry}" is no longer installed`;
    }
    return null;
  }
  const vendorName = facts.cloudRegistry[selection.vendor]?.display_name ?? selection.vendor;
  if (!facts.hasKey(selection.vendor)) {
    return `no ${vendorName} API key is stored`;
  }
  const ids = new Set(Object.values(selection.tiers));
  if (selection.uniformEnabled && selection.uniformModel) {
    ids.add(selection.uniformModel);
  }
  for (const id of ids) {
    if (id === 'openrouter/auto') {
      continue;
    }
    if (facts.cloudModelKnown(selection.vendor, id) === false) {
      return `${vendorName} no longer offers "${id}"`;
    }
  }
  return null;
}

/**
 * The card the sidebar falls back to (D12): the topmost card of its Local
 * list — pinned cards first, in pin order, then the rest in registry order;
 * self-hosted cards count. `null` when there is no local card at all.
 */
export function topmostLocalCard(
  registry: readonly LocalRegistryEntry[],
  pinned: readonly string[],
): LocalRegistryEntry | null {
  const installed = registry.filter((e) => e.installed);
  for (const name of pinned) {
    const entry = installed.find((e) => e.name === name);
    if (entry) {
      return entry;
    }
  }
  return installed[0] ?? null;
}

/**
 * The `settings.json` patch that makes the sidebar show *selection* (§5).
 * Only the keys a card owns change; *models* is the current `models` map,
 * which the patch carries over untouched for every other vendor.
 */
export function settingsPatchFor(
  selection: LlmSelection,
  models: Record<string, unknown>,
): Record<string, unknown> {
  const nextModels: Record<string, unknown> = { ...models };
  if (selection.kind === 'local') {
    nextModels.local = selection.entry;
    return { mode: 'local', models: nextModels };
  }
  nextModels.cloud = { ...record(models.cloud), [selection.vendor]: { ...selection.tiers } };
  nextModels.cloud_uniform = {
    ...record(models.cloud_uniform),
    [selection.vendor]: {
      enabled: selection.uniformEnabled,
      model_id: selection.uniformModel || null,
    },
  };
  const patch: Record<string, unknown> = {
    mode: 'cloud',
    active_cloud_vendor: selection.vendor,
    models: nextModels,
  };
  if (selection.vendor === 'openrouter') {
    patch.openrouter_auto_mode = selection.openrouterAuto;
  }
  return patch;
}
