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
 * How a knob is rendered and what its selection string means (mirrors
 * `KnobKind` in kodo/llms/local_registry/_knobs.py).
 *
 * - `checkbox` — exactly two options, ids `"off"`/`"on"`.
 * - `dropdown` — two or more options; selection is an option id.
 * - `number` — no options; a single `flag` whose numeric value the user types.
 *   Selection is the value as text, `''` meaning "don't pass the flag at all"
 *   (which is NOT the same as zero).
 */
export type KnobKind = 'checkbox' | 'dropdown' | 'number';

/** One selectable state of a checkbox/dropdown knob. `llama_args` is what
 *  picking it contributes to the Default profile's launch args. */
export interface KnobOptionInfo {
  id: string;
  name: string;
  description: string;
  llama_args: Record<string, string>;
}

/**
 * One configurable control on an LLM's **Default profile** — the hardcoded
 * checkbox/dropdown/number knobs kodo ships (kodo/doc/LLM_REGISTRY.md §4.6).
 *
 * Definitions arrive **once** per payload, in the top-level `knob_defs` table,
 * because they are overwhelmingly shared: every built-in entry offers the same
 * six, and only the YaRN context knobs are per-family. A `LocalRegistryEntry`
 * lists the ids it offers in `knobs` and looks them up here.
 *
 * Two knobs on one entry can never own the same CLI flag — the server rejects
 * that at import time — which is why the client can compose their args with a
 * plain merge and never needs precedence rules.
 */
export interface KnobDefInfo {
  id: string;
  name: string;
  description: string;
  kind: KnobKind;
  /** `false` = shown in the Configure modal's main body; `true` = behind its
   *  "Advanced" section, collapsed when the modal opens. */
  advanced: boolean;
  /** The selection used when the user hasn't chosen one — already resolved
   *  server-side against the entry's own `knob_defaults`. */
  default: string;
  /** Selectable states, in display order. `[]` for a `number` knob. */
  options: KnobOptionInfo[];
  /** `number` knobs only — the single CLI flag this knob writes. */
  flag: string;
  /** `number` knobs only — advisory input bounds/step. Nothing clamps. */
  minimum: number | null;
  maximum: number | null;
  step: number | null;
  /** `number` knobs only — what an empty value means, as placeholder text
   *  (e.g. `"off"`). The flag is genuinely not emitted; not a synonym for 0. */
  unset_label: string;
}

/** `knob_id` -> definition, shipped once per registry payload. */
export type KnobDefs = Record<string, KnobDefInfo>;

/**
 * A **user-defined** llama-server launch config for one local registry entry
 * — a raw arg set the user built in the "Manage profiles" editor.
 *
 * Selecting a profile **fully replaces** the Default profile's args; the two
 * are never merged (kodo/doc/LLM_REGISTRY.md §4.6). Every profile is
 * user-defined: there is no predefined/read-only variant, because everything
 * that used to be a predefined *flavor* is a knob on the Default profile now.
 */
export interface LlmProfileInfo {
  id: string;
  name: string;
  description: string;
  llama_args: Record<string, string>;
}

/**
 * One `llama-server` flag offered in the user-defined profile editor's "Add
 * argument" picker, mirroring the server's `llama_arg_catalog` payload (one
 * entry per `LLAMA_ARG_CATALOG` row in kodo/llms/_arg_catalog.py).
 *
 * Curated, not exhaustive — anything absent is still reachable through the
 * editor's raw "one flag per line" box. Nothing here is enforced server-side;
 * the bounds drive input widgets and the advisory ⚠, same posture as
 * {@link SamplingParamSpec.sensible_minimum}.
 */
export interface LlamaArgSpec {
  /** The flag as it appears on the command line, long form (`"--ctx-size"`).
   *  This is the key written into a profile's `llama_args`. */
  flag: string;
  label: string;
  /** `bool` is a bare flag (present with an empty value, no input at all);
   *  `enum` renders a `<select>` over `choices`; `str_list` is a
   *  delimiter-joined list (only `samplers`). */
  kind: 'str' | 'int' | 'float' | 'bool' | 'enum' | 'str_list';
  /** Grouping header in the picker, e.g. `"Context & memory"`. Group by exact
   *  string in first-seen order. */
  category: string;
  help: string;
  advanced: boolean;
  minimum: number | null;
  maximum: number | null;
  step: number | null;
  /** Accepted values for an `enum` flag, in display order; `[]` otherwise. */
  choices: string[];
  /** Hint text for a free-form `str` input; `''` when there's nothing useful. */
  placeholder: string;
  /** What llama.cpp does when the flag is absent, as display text; `''` when
   *  there's no meaningful default to name. Informational only. */
  default: string;
  /** The recommended band, carried through from the sampling spec table for
   *  the flags that mirror a sampling parameter — so the profile editor raises
   *  the same yellow ⚠ as the session sampling modal
   *  ({@link samplingRangeWarning}). `null` for every non-sampling flag. */
  sensible_minimum: number | null;
  sensible_maximum: number | null;
  /** Hard whitelist for a `str_list` flag (only `samplers`); an entry outside
   *  it is a hard error, not advice. `null` otherwise. */
  valid_values: string[] | null;
}

/**
 * A sparse set of request-level sampling parameters — `{parameterName: value}`
 * holding **only** what is actually set. Used for all three layers the feature
 * has: the launch args' values, a session's per-quant overrides, and the
 * resolved set. Deleting a key is a real operation (it stops the field being sent),
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
  /** Hard validation bounds — what llama-server/`SamplingParams.from_json`
   *  will accept (a value outside is clamped server-side). Deliberately
   *  generous; the *advisory* band is `sensible_minimum`/`sensible_maximum`. */
  minimum: number | null;
  maximum: number | null;
  /** The **recommended** band, always inside `[minimum, maximum]` and usually
   * far narrower — see kodo/doc/SAMPLING.md §8d for each parameter's exact
   * endpoints and why they were picked. The server never clamps or rejects
   * against it — {@link samplingRangeWarning} just produces the yellow ⚠ both
   * modals render — but the session sampling modal treats an out-of-band
   * value as reason enough to disable Apply, same as a hard error
   * ({@link samplingFieldIssue}). `null` (both together) = no guidance for
   * this parameter, because no accepted value is unreasonable (`seed`,
   * `mirostat`) or it isn't numeric. */
  sensible_minimum: number | null;
  sensible_maximum: number | null;
  step: number | null;
  /** The value that *disables* this sampler, as a display string — `""` when
   * it has none. Distinct from leaving the field empty, which instead means
   * "don't send it and inherit the launch-time value". Also exempt from the
   * sensible-range warning — see {@link samplingRangeWarning}. */
  neutral: string;
  /** Equivalent llama-server CLI flags. `cli_flags[0]` is the flag this
   * parameter contributes to the profile editor's argument catalog — every
   * alias is checked when reading a value back out (see
   * {@link launchSamplingValues}). Empty only for `min_keep`, which has no CLI
   * flag and is therefore session-override only. */
  cli_flags: string[];
  help: string;
  /** The exact accepted strings for a `str_list` parameter, or `null` when
   * any string is acceptable (every numeric parameter, and
   * `dry_sequence_breakers`). Only `samplers` sets this. Unlike
   * `sensible_minimum`/`sensible_maximum`, an entry outside this set is a
   * **hard** error — the server drops it rather than clamping, because one
   * bad stage name makes llama-server reject the whole request. Reported by
   * {@link samplingFieldError}, which renders identically to an out-of-band
   * warning (see {@link samplingFieldIssue}) — both are reason enough to
   * disable Apply in the session sampling modal. */
  valid_values: string[] | null;
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
  /** Human-readable name of the original model's license, e.g. "Apache License 2.0" or "OpenMDW-1.1". `hardcoded_hf` only — "" otherwise. */
  license_name: string;
  /** Link to the license text named by `license_name`. `hardcoded_hf` only — "" otherwise. */
  license_url: string;
  /** Minimum llama.cpp build number (matching the `b<N>` scheme reported by the installed build) this LLM needs; 0 = any version works. */
  llamacpp_version: number;
  /**
   * Maximum input-context size in tokens, as configured on the
   * `LocalLLMEntry` itself (kodo/llms/_local_registry.py) — the fallback
   * used when the launch args' own `-c`/`--ctx-size` is absent/`0`, see
   * {@link resolveContextSize}. Not the effective figure — that's never sent
   * as its own field, since it depends on which profile/knobs are selected
   * (which kodo-vsix already knows via `default_profile_args`/`profiles`).
   */
  context_window: number;
  /**
   * Ids of the knobs this entry's Default profile offers, in display order —
   * look each up in the payload-level {@link KnobDefs} table. `[]` for
   * `custom_server_url` (not a process kodo launches); every other kind gets
   * at least the shared knobs, user-added entries included.
   */
  knobs: string[];
  /**
   * The current selection for every knob in `knobs` — **resolved, never
   * sparse**, so a `<select>`/input can bind straight to it without the
   * client re-deriving defaults. An option id for a checkbox/dropdown knob,
   * the value as text (`''` = unset) for a number knob.
   */
  knob_selections: Record<string, string>;
  /**
   * What `knob_selections` currently resolves to: the entry's base args with
   * its knob args layered on top. Sent so the client can show the effective
   * context size — and the exact flags a knob produced — without
   * re-implementing knob composition or making a round trip. `{}` for
   * `custom_server_url`.
   */
  default_profile_args: Record<string, string>;
  /** The entry's user-defined profiles, in the order they were added. Does
   *  NOT include the Default profile, which has no stored args at all. */
  profiles: LlmProfileInfo[];
  /** Active profile id, or `""` for the Default profile. A stale id is
   *  resolved back to `""` server-side, so this always names something real. */
  active_profile: string;
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
 * The context size (tokens) `llamaArgs` declares, mirroring
 * `LlmProfile.get_context_size()` (kodo/llms/local_registry/_types.py): scans
 * for `--ctx-size` (checked first) or `-c`, parsed as an integer. `0` if
 * neither key is present or the value doesn't parse — including the
 * `--ctx-size: "0"` "use the GGUF's own trained context length" sentinel the
 * base args set.
 */
export function llamaArgsContextSize(llamaArgs: Record<string, string>): number {
  const raw = llamaArgs['--ctx-size'] ?? llamaArgs['-c'];
  if (raw === undefined) {
    return 0;
  }
  const value = parseInt(String(raw).trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * The launch args `entry` would actually start llama-server with, mirroring
 * `resolve_effective_llama_config` (kodo/llms/local_registry/_profiles.py):
 * the active user-defined profile's args verbatim if one is selected — a
 * profile fully replaces the Default profile, never merges with it —
 * otherwise the server-computed `default_profile_args`.
 */
export function effectiveLlamaArgs(entry: LocalRegistryEntry): Record<string, string> {
  if (entry.active_profile) {
    const profile = entry.profiles.find((p) => p.id === entry.active_profile);
    if (profile) {
      return profile.llama_args;
    }
  }
  return entry.default_profile_args;
}

/**
 * The effective context window (tokens) for `entry` under `llamaArgs`,
 * mirroring `resolve_context_window` (kodo/llms/local_registry/_profiles.py):
 * the declared size wins when positive, otherwise falls back to
 * `entry.context_window`.
 *
 * Callers that just want "what would launch right now" pass
 * {@link effectiveLlamaArgs}; the sidebar passes a *pending* profile's args
 * instead, so its Context line updates the moment the picker changes, before
 * any server round trip.
 */
export function resolveContextSize(
  entry: LocalRegistryEntry,
  llamaArgs: Record<string, string>,
): number {
  const size = llamaArgsContextSize(llamaArgs);
  return size > 0 ? size : entry.context_window;
}

export interface LocalLaunchWarning {
  kind: 'memory' | 'version';
  level: 'red' | 'yellow';
  text: string;
}

/**
 * Outstanding memory/llama.cpp-version warnings for `entry` given the
 * currently detected hardware and installed llama.cpp build. These rules
 * mirror `ramWarning`/`llamacppVersionWarning` in
 * settings-webview/localLlmUtils.ts, duplicated here (not imported) because
 * that module belongs to the webview bundle while this one is
 * extension-host-importable. Used to gate an actual llama-server launch
 * (`confirmLocalLlamaLaunch` in extension/local-llm-registry.ts) rather than
 * just render inline text — keep both copies in sync if either changes.
 *
 * The entry-level `min_memory`/`memory` figures are now the **only** hardware
 * check: the per-configuration `min_ram`/`min_vram` gate and the
 * platform-compatibility block both went away with flavors (a knob option
 * carries no hardware or platform restriction, so every option is offered on
 * every host — a large YaRN context option says so in its own description
 * instead). See kodo/doc/LLM_REGISTRY.md §4.6.
 */
export function localLaunchWarnings(
  entry: LocalRegistryEntry,
  detectedVramGb: number | null,
  detectedRamGb: number | null,
  installedLlamaCppVersion: string | null,
): LocalLaunchWarning[] {
  const warnings: LocalLaunchWarning[] = [];
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
  /** What `model`'s active launch configuration will start llama-server with
   *  for each sampling parameter, parsed out of its resolved `llama_args` (see
   *  {@link launchSamplingValues}) — shown as the inherited value in the
   *  session sampling modal's placeholders. Not a separately stored value:
   *  sampling reaches llama-server only as a launch arg or a session override
   *  (kodo/doc/SAMPLING.md §9). */
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
 * launch args started llama-server with, while `0` actively sets it
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

/**
 * `spec`'s **recommended** band as display text ("0 to 2", "0.5 or above"), or
 * `null` when the spec ships no guidance at all (`seed`, `mirostat`, the
 * `str_list` parameters — see {@link SamplingParamSpec.sensible_minimum}).
 *
 * Spelt with the word "to" rather than a hyphen because several bands start
 * negative (`repeat_last_n` is -1 to 2048, the penalties are -1 to 1), where a
 * hyphen would read as a minus sign.
 *
 * Feeds both places the band surfaces: every field's label
 * ({@link samplingLabelText}) and the out-of-band ⚠ tooltip
 * ({@link samplingRangeWarning}), so the two can never quote different numbers.
 */
export function sensibleRangeText(spec: SamplingParamSpec): string | null {
  // `?? null` rather than a plain read: an older kodo server's `sampling_specs`
  // has no such field at all, and `undefined` must degrade to "no guidance"
  // instead of being formatted into the label as literal "undefined".
  const low = spec.sensible_minimum ?? null;
  const high = spec.sensible_maximum ?? null;
  if (spec.kind === 'str_list' || (low === null && high === null)) {
    return null;
  }
  // A float bound that happens to be whole keeps its ".0" — JSON gave us `2`
  // for `2.0`, and "0 to 2" on a field whose values are decimals reads as if
  // only integers belong there. Ints stay bare. Matches how SAMPLING.md §8d
  // and the specs' own `neutral` strings spell the same numbers.
  const show = (value: number): string =>
    spec.kind === 'float' && Number.isInteger(value) ? value.toFixed(1) : String(value);
  if (low !== null && high !== null) {
    return `${show(low)} to ${show(high)}`;
  }
  return low !== null ? `${show(low)} or above` : `${show(high as number)} or below`;
}

/**
 * One sampling field's label: the parameter name followed by the guidance a
 * user needs *before* typing — the recommended band and, when the parameter
 * has one, the value that turns it off ("Temperature (0.0 to 2.0, 1.0 disables)").
 *
 * Both are advisory: nothing clamps to the band (the server's own hard
 * `minimum`/`maximum` do that), and "disables" is the sampler's neutral value,
 * which is a real value to send — quite different from leaving the field blank,
 * which sends nothing and inherits the launch args (kodo/doc/SAMPLING.md §1).
 *
 * A parameter with neither (`seed`) is just its label, unadorned.
 *
 * Used by the session sampling modal (webview/SamplingModal.tsx); the settings
 * webview renders the same text in the profile editor from its own copy
 * (settings-webview/localLlmUtils.ts).
 */
export function samplingLabelText(spec: SamplingParamSpec): string {
  const parts: string[] = [];
  const range = sensibleRangeText(spec);
  if (range !== null) {
    parts.push(range);
  }
  if (spec.neutral !== '') {
    parts.push(`${spec.neutral} disables`);
  }
  return parts.length === 0 ? spec.label : `${spec.label} (${parts.join(', ')})`;
}

/**
 * The tooltip for `spec`'s yellow ⚠, or `null` when `text` needs no warning.
 *
 * Guidance against the spec's *recommended* band (`sensible_minimum`/
 * `sensible_maximum`, kodo/doc/SAMPLING.md §8d), not the server's own
 * validation — the server's hard `minimum`/`maximum` still clamp on their
 * own regardless of this function, and a value it flags is submitted
 * unchanged if it ever reaches the server; this only says a value llama.cpp
 * accepts will probably make output worse. That said, the session sampling
 * modal does gate on it client-side: it disables Apply while any field is
 * flagged, same as a hard error ({@link samplingFieldIssue}) — the profile
 * editor shows and gates on the identical mark. Merge point for both severities, and the doc comment for the
 * severity split, live on {@link samplingFieldIssue}.
 *
 * Four things deliberately do NOT warn:
 *  - **A blank field.** Unset means "inherit the launch args" (§1), not zero.
 *  - **A `str_list` parameter**, or one with no band — nothing to compare.
 *  - **A half-typed number** (`"0."`, `"-"`). The warning is recomputed on
 *    every keystroke, so flagging an intermediate parse would make the mark
 *    flicker while typing a perfectly good value.
 *  - **Exactly the spec's `neutral` value.** Several samplers disable at a
 *    value outside their useful active band (`min_p` is useful at 0.02–0.2 but
 *    off at 0.0), and marking a deliberate "off" as suspicious is pure noise.
 *
 * The settings webview keeps its own copy of this (settings-webview/
 * localLlmUtils.ts), same as it does for every other shared shape.
 */
export function samplingRangeWarning(spec: SamplingParamSpec, text: string): string | null {
  // Same source as the label's band, so the two can't quote different numbers;
  // `null` means the spec ships no guidance and nothing can be out of band.
  const range = sensibleRangeText(spec);
  if (range === null) {
    return null;
  }
  const low = spec.sensible_minimum ?? null;
  const high = spec.sensible_maximum ?? null;
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const value = spec.kind === 'int' ? parseInt(trimmed, 10) : parseFloat(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (spec.neutral !== '' && value === parseFloat(spec.neutral)) {
    return null;
  }
  if ((low === null || value >= low) && (high === null || value <= high)) {
    return null;
  }

  const off = spec.neutral === '' ? '' : ` Set it to ${spec.neutral} to turn ${spec.label} off.`;
  return `${trimmed} is outside the recommended range for ${spec.label} (${range}). ` +
    `Values outside that range are accepted but usually degrade output quality.${off}`;
}

/**
 * The **hard**-error message for `spec`'s field given `text`, or `null` if it
 * would parse cleanly (including blank, which just means "unset").
 *
 * Unlike {@link samplingRangeWarning} (a value the server accepts but
 * probably shouldn't be used), this flags a value the server would silently
 * *drop* — the exact failure mode that made it look like sampler-order edits
 * were vanishing into nowhere: a typoed stage name never reaches
 * `transient.jsonl` because `SamplingParams.from_json` filters unknown
 * `samplers` entries and logs a warning nobody sees client-side
 * (kodo/doc/SAMPLING.md §8e). The session sampling modal disables Apply
 * whenever any field has one of these.
 *
 * Two shapes of "would be dropped":
 *  - **A `str_list` parameter with `valid_values`** (only `samplers` today)
 *    containing a name outside that set.
 *  - **A numeric field** whose text contains a digit but still fails to
 *    parse (`"1.2.3"`, `"12x"`). Checked with `Number(...)` rather than
 *    `parseInt`/`parseFloat` — those parse a leading numeric *prefix* and
 *    would wave "1.2.3" through as `1.2`. A bare sign/decimal-point prefix
 *    (`"-"`, `"."`, `"-."`) is a legitimate mid-typing state for a negative
 *    or fractional value, not an error — same reasoning as
 *    {@link samplingRangeWarning}'s half-typed-number exemption, just
 *    narrowed to digitless text so it doesn't also swallow real garbage.
 */
export function samplingFieldError(spec: SamplingParamSpec, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (spec.kind === 'str_list') {
    if (!spec.valid_values) {
      return null;
    }
    const items = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = items.filter((item) => !spec.valid_values!.includes(item));
    if (unknown.length === 0) {
      return null;
    }
    return `Unknown ${spec.label.toLowerCase()} name(s): ${unknown.join(', ')}. ` +
      `Valid names: ${spec.valid_values.join(', ')}.`;
  }
  if (Number.isFinite(Number(trimmed)) || !/\d/.test(trimmed)) {
    return null;
  }
  return `"${trimmed}" is not a valid number.`;
}

/**
 * Whether `spec`'s field has *any* problem worth flagging — a hard error
 * ({@link samplingFieldError}, a value the server would silently drop) or an
 * advisory out-of-band value ({@link samplingFieldError}'s cousin
 * {@link samplingRangeWarning}, a value the server accepts but is probably a
 * bad idea) — whichever applies, hard error first. Deliberately the single
 * function both editors call to decide what to render and (session modal
 * only) what to gate Apply on: asking a user to distinguish "this would
 * vanish" from "this is unwise" via icon color alone isn't a distinction
 * worth making at a glance, so both render as the same yellow ⚠ and the
 * tooltip text is what actually explains which one it is.
 */
export function samplingFieldIssue(spec: SamplingParamSpec, text: string): string | null {
  return samplingFieldError(spec, text) ?? samplingRangeWarning(spec, text);
}

// --- Launch args <-> structured sampling values -----------------------------
//
// Sampling has no state of its own at the launch layer (kodo/doc/SAMPLING.md
// §9): it reaches llama-server either through the shared Tail culling /
// Temperature knobs on the Default profile, or as an ordinary flag on a
// user-defined profile. The functions here read that relationship back out of
// already-resolved launch args, for the session sampling modal's "inherited
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
 * Parse one `llama_args` string value into a typed sampling value, or
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
 * The sampling parameters `llamaArgs` sets, read out of the resolved launch
 * args rather than a separate stored field (there isn't one — see the module
 * header above). For each spec with at least one CLI flag (excludes
 * `min_keep`, session-override only), checks every alias in `cli_flags`
 * order and uses whichever is present.
 */
export function launchSamplingValues(
  llamaArgs: Record<string, string>,
  specs: SamplingParamSpec[],
): SamplingValues {
  const defaults: SamplingValues = {};
  for (const spec of specs) {
    for (const flag of spec.cli_flags) {
      const raw = llamaArgs[flag];
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
