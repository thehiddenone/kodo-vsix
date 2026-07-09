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
  /** One-line "when to pick this" blurb shown in Cloud AI Settings. */
  recommendation: string;
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
  /** Absolute path to the installed file(s) on disk, or `null` if not installed. */
  installed_path: string | null;
  /** Original (unquantized) model slug, e.g. "qwen36-27b". `hardcoded_hf` only — "" otherwise. */
  base_llm: string;
  /** Team/person who produced the quant, e.g. "Unsloth". `hardcoded_hf` only — "" otherwise. */
  quant_author: string;
  /** Quant spec, e.g. "UD_Q4_K_XL". `hardcoded_hf` only — "" otherwise. */
  quant_type: string;
  /** Human-readable GGUF size, e.g. "28.6 GB". `hardcoded_hf` only — "" otherwise. */
  size_hint: string;
  /** Discrete-GPU hardware recommendation. `hardcoded_hf` only — "" otherwise. */
  gpu_tip: string;
  /** MacBook Pro (Apple Silicon) hardware recommendation. `hardcoded_hf` only — "" otherwise. */
  mac_tip: string;
  /** Absolute minimum VRAM (GB) to load at all; 0 = no known minimum. */
  min_memory: number;
  /** Recommended VRAM (GB) for large contexts; 0 = no known recommendation. */
  memory: number;
}

export type DownloadStatus = 'downloading' | 'paused' | 'failed';

/** One entry's live download state, read by kodo-vsix straight off
 * `manager-state.json` (see kodo/doc/LOCAL_MODEL_MANAGER.md §11) — never
 * pushed over the WS wire. Keyed by registry entry name (== model_id). */
export interface LocalDownloadState {
  name: string;
  repo_id: string;
  status: DownloadStatus;
  bytes_downloaded: number;
  bytes_total: number | null;
  error: string;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max'];

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low effort subagents for easy tasks',
  medium: 'Medium effort subagents for everyday work',
  high: 'High effort subagents for demanding tasks',
  max: 'Max effort subagents for the hardest problems',
};

/** True for entry kinds the "Add local LLM" flows can add/remove (never `hardcoded_hf`). */
export function isCustomLocalEntry(kind: LocalEntryKind): boolean {
  return kind !== 'hardcoded_hf';
}

/** True for entry kinds that go through the HF download/install pipeline. */
export function isDownloadableLocalEntry(kind: LocalEntryKind): boolean {
  return kind === 'hardcoded_hf' || kind === 'custom_hf';
}
