/**
 * Shared shapes for the cloud/local LLM registries — mirrors the
 * `cloud_registry`/`local_registry` fields of the server's `hello.ack`
 * payload (kodo/doc/LLM_REGISTRY.md, WS_PROTOCOL.md §4.1) and the
 * `local_llm.registry_state` event. Used by the sidebar and both new
 * settings webviews so all three agree on one shape.
 */

export interface CloudModelInfo {
  model_id: string;
  name: string;
  description: string;
  context_window: number;
}

export interface CloudVendorInfo {
  display_name: string;
  models: CloudModelInfo[];
}

/** Vendor key (e.g. "anthropic") -> that vendor's hardcoded models. */
export type CloudRegistry = Record<string, CloudVendorInfo>;

export type LocalEntryKind = 'hardcoded_hf' | 'custom_hf' | 'custom_file' | 'custom_server_url';

export interface LocalRegistryEntry {
  name: string;
  kind: LocalEntryKind;
  description: string;
  repo_id: string;
  filename: string;
  path: string;
  url: string;
  installed: boolean;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max'];

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
  max: 'Max effort',
};

/** True for entry kinds the "Add local LLM" flows can add/remove (never `hardcoded_hf`). */
export function isCustomLocalEntry(kind: LocalEntryKind): boolean {
  return kind !== 'hardcoded_hf';
}

/** True for entry kinds that go through the HF download/install pipeline. */
export function isDownloadableLocalEntry(kind: LocalEntryKind): boolean {
  return kind === 'hardcoded_hf' || kind === 'custom_hf';
}
