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

/**
 * A named llama-server launch config for one local registry entry — the
 * *only* source of its launch args (a local registry entry carries none of
 * its own). E.g. a "1M context" variant (YaRN rope-scaling + a much larger
 * `--ctx-size`) or a "VRAM-tight" variant (`--n-cpu-moe`/`--override-tensor`
 * tuned for a smaller GPU). Switching the active flavor **fully replaces**
 * the previously-active one's `llama_args` — flavors are never merged
 * together (kodo/doc/LLM_REGISTRY.md §4.6). There is no `context_window`
 * field here any more — the effective context size is deduced server-side
 * from `llama_args`' own `-c`/`--ctx-size` value (falling back to the
 * entry's own `context_window`), so it's never sent over the wire.
 */
export interface LlamaFlavorInfo {
  id: string;
  name: string;
  description: string;
  llama_args: Record<string, string>;
  /**
   * `true` when `id` is one of the entry's built-in predefined flavors —
   * stays `true` even after the user edits it (which stores a same-id
   * *override* rather than changing the predefined definition itself, see
   * LLM_REGISTRY.md §4.6). Drives the "Manage flavors" modal's "Remove"
   * button, which stays disabled for these ids.
   */
  predefined: boolean;
  /**
   * Minimum system RAM (GB) this flavor needs, or the minimum *unified
   * memory* on Apple Silicon (there, compare against `detectedVramGb` —
   * `detectedRamGb` is always `null` on macOS, see `detect_ram_gb` in
   * kodo/llms/_hardware.py). `0` = unknown/no requirement.
   */
  min_ram: number;
  /**
   * Minimum discrete GPU VRAM (GB) this flavor needs, for a Windows/Linux
   * GPU setup (always `0` on an Apple Silicon-oriented flavor — see
   * `min_ram`). `0` = unknown/no requirement. When both `min_ram` and
   * `min_vram` are `0` the hardware-fit check is inactive — the flavor is
   * treated as runnable everywhere (see `hardwareFitWarningForFlavor` in
   * extension.ts).
   */
  min_vram: number;
}

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
  /**
   * Maximum input-context size in tokens, as configured on the
   * `LocalLLMEntry` itself (kodo/llms/_local_registry.py) — the fallback
   * used when the active flavor's own `-c`/`--ctx-size` is absent/`0`, see
   * {@link resolveContextSize}. Not the effective, flavor-resolved figure —
   * that's never sent as its own field, since it depends on which flavor is
   * active (which kodo-vsix already knows via `active_flavor`/`flavors`).
   */
  context_window: number;
  /**
   * Predefined + custom flavors, predefined first. Empty for
   * `custom_server_url`; every other kind normally has at least one (a
   * built-in "default" for `hardcoded_hf`, or one seeded at creation time
   * for `custom_hf`/`custom_file` — see LLM_REGISTRY.md §4.6).
   */
  flavors: LlamaFlavorInfo[];
  /** Active flavor id, or "" for unset — falls back to `flavors[0]`. */
  active_flavor: string;
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
  /** Trailing ~10s transfer rate in bytes/sec, computed server-side
   * (kodo/doc/LOCAL_MODEL_MANAGER.md §11a). `null` whenever not actively
   * downloading, including the first instant of a (re)started transfer. */
  bytes_per_second: number | null;
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

/**
 * The context size (tokens) `flavor`'s own `llama_args` declare, mirroring
 * `LlamaFlavor.get_context_size()` (kodo/llms/_local_registry.py): scans for
 * `--ctx-size` (checked first) or `-c`, parsed as an integer. `0` if neither
 * key is present or the value doesn't parse — including the `--ctx-size: "0"`
 * "use the GGUF's own trained context length" sentinel every built-in flavor
 * sets by default.
 */
export function flavorContextSize(flavor: LlamaFlavorInfo): number {
  const raw = flavor.llama_args['--ctx-size'] ?? flavor.llama_args['-c'];
  if (raw === undefined) {
    return 0;
  }
  const value = parseInt(String(raw).trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * The effective context window (tokens) for `entry` given its currently
 * selected `flavor`, mirroring `resolve_context_window` (kodo/llms/
 * _local_registry.py): `flavor`'s own declared size wins when positive,
 * otherwise falls back to `entry.context_window`.
 */
export function resolveContextSize(
  entry: LocalRegistryEntry,
  flavor: LlamaFlavorInfo | undefined,
): number {
  if (flavor) {
    const size = flavorContextSize(flavor);
    if (size > 0) {
      return size;
    }
  }
  return entry.context_window;
}

/**
 * `null` if `flavor` is fine to launch given the detected hardware (or the
 * check is inactive/inconclusive); otherwise a human-readable explanation
 * — with real detected numbers — suitable for a confirmation dialog's
 * detail text (see `hardwareFitConfirm` in extension.ts, which gates the
 * sidebar's flavor `<select>` behind a native "I understand the risk,
 * proceed" / "Cancel" modal using this).
 *
 * `min_ram`/`min_vram` are independent thresholds, never summed — unlike
 * the entry-level `min_memory`/`memory` combined-pool warning rendered in
 * the Local Inference Settings panel (kodo/doc/LLM_REGISTRY.md §4.4), this
 * checks discrete GPU VRAM and system RAM as two separate pools, since a
 * flavor's launch args (e.g. `--n-gpu-layers -1`, fully on GPU) can have a
 * real per-pool minimum.
 *
 * On Apple Silicon there is one unified memory pool, reported in full via
 * `detectedVramGb` — `detectedRamGb` is always `null` there (see
 * `detect_ram_gb` in kodo/llms/_hardware.py). A Mac-oriented flavor
 * expresses its unified-memory requirement via `min_ram` by convention
 * (leaving `min_vram` at `0`), so on Mac this checks `min_ram` against
 * `detectedVramGb` instead of the always-null `detectedRamGb`.
 *
 * A `null` detected figure is treated as `0` once at least one of
 * VRAM/RAM is known; if *both* are `null` (nothing could be detected at
 * all) the check is skipped entirely rather than blocking on a guess.
 */
export function hardwareFitWarningForFlavor(
  flavor: LlamaFlavorInfo,
  detectedVramGb: number | null,
  detectedRamGb: number | null,
  isMac: boolean,
): string | null {
  if (flavor.min_ram <= 0 && flavor.min_vram <= 0) {
    return null;
  }
  const effectiveRamGb = isMac ? detectedVramGb : detectedRamGb;
  if (detectedVramGb === null && effectiveRamGb === null) {
    return null;
  }
  const vram = detectedVramGb ?? 0;
  const ram = effectiveRamGb ?? 0;
  const vramShort = flavor.min_vram > 0 && vram < flavor.min_vram;
  const ramShort = flavor.min_ram > 0 && ram < flavor.min_ram;
  if (!vramShort && !ramShort) {
    return null;
  }

  const ramLabel = isMac ? 'unified memory' : 'RAM';
  const needs: string[] = [];
  const has: string[] = [];
  if (flavor.min_vram > 0) {
    needs.push(flavor.min_vram + ' GB VRAM');
    has.push(vram + ' GB VRAM');
  }
  if (flavor.min_ram > 0) {
    needs.push(flavor.min_ram + ' GB ' + ramLabel);
    has.push(ram + ' GB ' + ramLabel);
  }
  return 'The "' + flavor.name + '" flavor needs at least ' + needs.join(' and ') +
    ', but this system has ' + has.join(' and ') + ' detected. Proceeding may cause ' +
    'llama.cpp to crash from running out of memory.';
}

/** Which llama.cpp reasoning-tiering mechanism a `base_llm` uses — see
 * kodo/doc/LLM_REGISTRY.md §4.5. `qwen_reasoning_budget` rides a 6-tier
 * `--reasoning-budget`/`thinking_budget_tokens` scale; `gpt_oss_reasoning_effort`
 * rides GPT-OSS's built-in 3-tier `reasoning_effort`. */
export type ThinkingFamily = 'qwen_reasoning_budget' | 'gpt_oss_reasoning_effort';

export interface ThinkingFamilyInfo {
  family: ThinkingFamily;
  /** Ordered tier slugs, lowest intensity first, e.g. ["minimal", ..., "unlimited"]. */
  tiers: string[];
  /** Default tier slug when the user hasn't chosen one for this base_llm yet. */
  default: string;
}

/** `base_llm` -> thinking-family metadata, mirroring the server's
 * `thinking_families` payload (kodo/doc/WS_PROTOCOL.md §5.12a). A `base_llm`
 * absent from this map has no thinking-tier control. */
export type ThinkingFamilies = Record<string, ThinkingFamilyInfo>;

/** Tier slugs are already display-ready words ("minimal" -> "Minimal"). */
export function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/**
 * The thinking-tier shape a session's Thinking Level toggle (ModeControls.tsx)
 * needs, derived window-wide from `activeLocalModelState`/`modeState`/
 * `thinkingFamiliesState` in extension.ts and pushed to every open session tab
 * (`SessionController.updateThinkingContext`) whenever any of those three
 * change — the active model is a machine-global selection, not per-session,
 * so every open tab shares one `ThinkingContext` at a time. `family: null`
 * (cloud mode, or a local model/custom entry with no thinking mechanism)
 * means the toggle is disabled; `tiers`/`defaultTier` are `[]`/`""` in that case.
 */
export interface ThinkingContext {
  family: ThinkingFamily | null;
  tiers: string[];
  defaultTier: string;
}
