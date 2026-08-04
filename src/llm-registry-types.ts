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
 * Which host platform(s) a flavor may be launched on (kodo/llms/
 * _local_registry.py's `LlamaFlavorPlatform`) — `'mac'`/`'gpu'` restrict a
 * flavor to Apple Silicon or a Windows/Linux discrete-GPU PC respectively
 * (e.g. a huge YaRN-extended-context flavor that only fits in Apple
 * Silicon's unified memory), `'both'` (the default for a new custom flavor)
 * means no restriction.
 */
export type LlamaFlavorPlatform = 'mac' | 'gpu' | 'both';

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
  /** Which host platform(s) this flavor may be launched on — see
   * {@link LlamaFlavorPlatform}. Purely informational client-side today
   * (shown as a badge in the "Manage flavors" modal); the platform-aware
   * *default*-flavor selection this drives happens server-side, in
   * `get_effective_flavor_id` (kodo/llms/_local_registry.py). */
  platform: LlamaFlavorPlatform;
}

/**
 * A sparse set of request-level sampling parameters — `{parameterName: value}`
 * holding **only** what is actually set. Used for all three layers the feature
 * has: a flavor's defaults, a session's per-quant overrides, and the resolved
 * set. Deleting a key is a real operation (it stops the field being sent),
 * never "reset to a default". See kodo/doc/SAMPLING.md §1.
 */
export type SamplingValues = Record<string, number | string[]>;

/**
 * Static description of one tunable request-level sampling parameter, mirroring
 * the server's `sampling_specs` payload (one entry per
 * `SAMPLING_PARAM_SPECS` row in kodo/llms/_sampling.py). Pushed by the server
 * rather than hardcoded here for the same reason `thinking_families` is: the
 * table already exists server-side as the single source of truth for
 * validation, and a client-side duplicate would drift.
 */
export interface SamplingParamSpec {
  /** Request-body key, spelled as llama-server expects it (e.g. `top_k`). */
  name: string;
  /** `float`/`int` render a number input, `str_list` a comma-separated text field. */
  kind: 'float' | 'int' | 'str_list';
  label: string;
  /** `false` = the curated set shown up front; `true` = behind "Advanced". */
  advanced: boolean;
  minimum: number | null;
  maximum: number | null;
  step: number | null;
  /** The value that *disables* this sampler, as a display string — `""` when
   * it has none. Distinct from leaving the field empty, which instead means
   * "don't send it and inherit the launch-time value". */
  neutral: string;
  /** Equivalent llama-server CLI flags. `cli_flags[0]` is what the flavor
   * editor's structured sampling form writes into `llama_args` when a field
   * is set (see {@link flavorSamplingDefaults}) — every alias is checked when
   * reading a value back out. Empty only for `min_keep`, which has no CLI
   * flag and is therefore session-override only. */
  cli_flags: string[];
  help: string;
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
  /** Org/company that produced the original (unquantized) model, e.g. "Alibaba Cloud". `hardcoded_hf` only — "" otherwise. */
  llm_author: string;
  /** Minimum llama.cpp build number (matching the `b<N>` scheme reported by the installed build) this LLM needs; 0 = any version works. */
  llamacpp_version: number;
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
 * Whether `flavor` may be launched on this host, mirroring
 * `_flavor_compatible_with_host`/`current_host_platform` (kodo/llms/
 * _local_registry.py): `'both'` is always compatible; `'mac'`/`'gpu'` must
 * match `isMac`. `platform` is normally always one of the three
 * `LlamaFlavorPlatform` values, but a payload that somehow omits it (e.g. an
 * older cached state) is treated as `'both'`, same as the server's own
 * `_parse_flavor_platform` fallback.
 */
export function flavorCompatibleWithHost(flavor: LlamaFlavorInfo, isMac: boolean): boolean {
  if (!flavor.platform || flavor.platform === 'both') {
    return true;
  }
  return isMac ? flavor.platform === 'mac' : flavor.platform === 'gpu';
}

/**
 * Whether `entry` has at least one flavor launchable on this host, mirroring
 * `has_compatible_flavor` (kodo/llms/_local_registry.py) — `true` when
 * `entry` has no flavors at all (nothing to be incompatible about) or when
 * {@link flavorCompatibleWithHost} passes for at least one of them. `false`
 * only when every flavor targets the other platform, the case
 * {@link localLaunchWarnings}' `'platform'` warning and
 * `confirmLocalLlamaLaunch` (extension/local-llm-registry.ts) treat as a
 * hard "can't run here" — see kodo/doc/LLM_REGISTRY.md §4.6b.
 */
export function entryHasCompatibleFlavor(entry: LocalRegistryEntry, isMac: boolean): boolean {
  if (entry.flavors.length === 0) {
    return true;
  }
  return entry.flavors.some((f) => flavorCompatibleWithHost(f, isMac));
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

export interface LocalLaunchWarning {
  kind: 'memory' | 'version' | 'platform';
  level: 'red' | 'yellow';
  text: string;
}

/**
 * Outstanding memory/llama.cpp-version/platform warnings for `entry` given
 * the currently detected hardware, installed llama.cpp build, and host
 * platform — the memory/version rules mirror `ramWarning`/
 * `llamacppVersionWarning` in settings-webview/localLlmUtils.ts, duplicated
 * here (not imported) because that module belongs to the webview bundle
 * while this one is extension-host-importable (see
 * `hardwareFitWarningForFlavor` above for the same reasoning). Used to gate
 * an actual llama-server launch (`confirmLocalLlamaLaunch` in
 * extension/local-llm-registry.ts) rather than just render inline text —
 * keep both copies of these rules in sync if either changes.
 *
 * Unlike the other two, the `'platform'` warning (kodo/doc/LLM_REGISTRY.md
 * §4.6b) is not a "proceed anyway" risk — `confirmLocalLlamaLaunch` treats
 * it as an unconditional block, since there is genuinely no flavor of
 * `entry` that can launch on this host. It fires whenever
 * `entryHasCompatibleFlavor` is `false`, independent of `detectedVramGb`/
 * `detectedRamGb`/`installedLlamaCppVersion` — a platform mismatch is a
 * static fact about `entry.flavors`, never a detection question.
 */
export function localLaunchWarnings(
  entry: LocalRegistryEntry,
  detectedVramGb: number | null,
  detectedRamGb: number | null,
  installedLlamaCppVersion: string | null,
  isMac: boolean,
): LocalLaunchWarning[] {
  const warnings: LocalLaunchWarning[] = [];
  if (!entryHasCompatibleFlavor(entry, isMac)) {
    warnings.push({
      kind: 'platform',
      level: 'red',
      text: `⛔ This LLM is not compatible with this platform (${isMac ? 'Apple Silicon' : 'Windows/Linux GPU'}) — none of its flavors support running here.`,
    });
  }
  if (detectedVramGb !== null || detectedRamGb !== null) {
    const total = (detectedVramGb || 0) + (detectedRamGb || 0);
    const min = entry.min_memory || 0;
    const rec = entry.memory || 0;
    if (min > 0 && total < min) {
      warnings.push({
        kind: 'memory',
        level: 'red',
        text: `⛔ This LLM will likely not run on this machine — it needs at least ${min} GB of combined VRAM + RAM, but only ${total} GB was detected.`,
      });
    } else if (rec > 0 && total < rec) {
      warnings.push({
        kind: 'memory',
        level: 'yellow',
        text: `⚠️ This LLM may not perform well with large contexts on this machine — ${rec} GB of combined VRAM + RAM is recommended, but only ${total} GB was detected.`,
      });
    }
  }
  const required = entry.llamacpp_version || 0;
  if (required > 0 && installedLlamaCppVersion) {
    const installed = parseInt(installedLlamaCppVersion.replace(/^b/i, ''), 10);
    if (Number.isFinite(installed) && installed < required) {
      warnings.push({
        kind: 'version',
        level: 'red',
        text: `⛔ The installed llama.cpp (b${installed}) does not support this LLM — it requires at least b${required}. Update llama.cpp to run it.`,
      });
    }
  }
  return warnings;
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

/**
 * What the footer's sampling button and its modal (SamplingModal.tsx) need,
 * derived window-wide from `modeState`/`activeLocalModelState`/
 * `localRegistryState`/`samplingSpecsState` and pushed to every open session
 * tab (`SessionController.updateSamplingContext`) whenever any of those
 * change — the active model is a machine-global selection, so every tab shares
 * one context, exactly like {@link ThinkingContext}.
 *
 * `model: ''` means the session is on a cloud model (or the active local entry
 * is unknown), and the footer button is **not rendered at all** — these are
 * llama-server parameters with no Anthropic equivalent.
 *
 * The session's own overrides are NOT here: those are per-session server state
 * arriving on `state.sampling`, whereas everything in this interface is
 * window-global.
 */
export interface SamplingContext {
  /** Active local registry entry ("quant") name, or `''` when not applicable. */
  model: string;
  /** What `model`'s active flavor will launch llama-server with for each
   *  sampling parameter, parsed out of its `llama_args` (see
   *  {@link flavorSamplingDefaults}) — shown as the inherited value in the
   *  session sampling modal's placeholders. Not a separately stored value:
   *  a flavor has no request-level sampling state of its own any more. */
  defaults: SamplingValues;
  /** The server's parameter table, in display order. */
  specs: SamplingParamSpec[];
}

/** Parse a `sampling`/override map off a wire payload; `{}` if absent or
 * malformed. Values are trusted as-is — the server validates and clamps them
 * (`SamplingParams.from_json`), and re-checking here would just duplicate the
 * bounds table this deliberately does not carry. */
export function parseSamplingValues(raw: unknown): SamplingValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as SamplingValues;
}

/**
 * Format one sampling value for a text/number input. `str_list` parameters
 * render as a comma-separated list; numbers render verbatim. An absent value
 * yields `''` — the empty field that means "not set".
 */
export function samplingValueToText(value: number | string[] | undefined): string {
  if (value === undefined) {
    return '';
  }
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/**
 * Parse one field's text back into a sampling value, or `undefined` for "unset".
 *
 * An empty (or whitespace-only) field is always `undefined`, never `0` — the
 * distinction is load-bearing: omitting a parameter inherits whatever the
 * flavor's CLI args launched llama-server with, while `0` actively sets it
 * (and for several samplers `0` is the *disable* value). A number that fails
 * to parse is treated as unset rather than as `NaN`.
 */
export function samplingTextToValue(
  spec: SamplingParamSpec,
  text: string,
): number | string[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (spec.kind === 'str_list') {
    const items = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  const parsed = spec.kind === 'int' ? parseInt(trimmed, 10) : parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// --- Flavor sampling shortcuts: llama_args <-> structured sampling values --
//
// A flavor carries no request-level sampling state of its own (kodo/doc/
// SAMPLING.md §9) — the flavor editor's structured sampling form is a
// friendlier view of a subset of `llama_args` itself, kept in sync live in
// both directions (settings-webview/FlavorModal.tsx does the two-way sync
// using its own copy of these helpers, settings-webview/localLlmUtils.ts).
// The functions here are for reading that same relationship out of an
// already-launched flavor, for the session sampling modal's "inherited
// value" placeholder (`SamplingContext.defaults`).

/**
 * The CLI-argument list separator for a `str_list` parameter — llama.cpp
 * spells `samplers` semicolon-joined on the command line but everything
 * else (`dry_sequence_breakers`) comma-joined, matching the request-body
 * JSON-array-as-comma-list convention {@link samplingValueToText} already
 * uses for display. See doc/SAMPLING.md §8b.
 */
function cliListSeparator(spec: SamplingParamSpec): string {
  return spec.name === 'samplers' ? ';' : ',';
}

/**
 * Parse one flavor `llama_args` string value into a typed sampling value, or
 * `undefined` if it doesn't parse — mirrors {@link samplingTextToValue} but
 * reads a raw CLI argument value (already-typed for `llama_args`, not a
 * text-box string) and applies {@link cliListSeparator} for `str_list` kinds.
 */
export function cliArgValueToSamplingValue(
  spec: SamplingParamSpec,
  raw: string,
): number | string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (spec.kind === 'str_list') {
    const items = trimmed.split(cliListSeparator(spec)).map((s) => s.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  const parsed = spec.kind === 'int' ? parseInt(trimmed, 10) : parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Inverse of {@link cliArgValueToSamplingValue} — a typed sampling value as
 *  the `llama_args` string it should be written as. */
export function samplingValueToCliArgValue(
  spec: SamplingParamSpec,
  value: number | string[],
): string {
  return Array.isArray(value) ? value.join(cliListSeparator(spec)) : String(value);
}

/**
 * `flavor`'s effective sampling parameters, read out of its own `llama_args`
 * rather than a separate stored field (there isn't one — see the module
 * header above). For each spec with at least one CLI flag (excludes
 * `min_keep`, session-override only), checks every alias in `cli_flags`
 * order and uses whichever is present in `llama_args`.
 */
export function flavorSamplingDefaults(
  flavor: LlamaFlavorInfo,
  specs: SamplingParamSpec[],
): SamplingValues {
  const defaults: SamplingValues = {};
  for (const spec of specs) {
    for (const flag of spec.cli_flags) {
      const raw = flavor.llama_args[flag];
      if (raw !== undefined) {
        const value = cliArgValueToSamplingValue(spec, raw);
        if (value !== undefined) {
          defaults[spec.name] = value;
        }
        break;
      }
    }
  }
  return defaults;
}
