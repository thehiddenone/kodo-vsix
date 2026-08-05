/** Shared helpers for the "Local Inference" tab's add-LLM and manage-flavors
 *  modals — parsing form input into the wire shapes the host expects, and
 *  the local-registry name-clash check every add form validates against. */

import type { LlamaFlavorPlatform, LocalFlavor, LocalRegistryEntry, SamplingParamSpec } from './types';

export const DEFAULT_CONTEXT_WINDOW = 262144;
export const HF_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseLlamaArgs(text: string): Record<string, string> {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const result: Record<string, string> = {};
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    result[tokens[i]] = tokens[i + 1];
  }
  return result;
}

export function parseNonNegativeInt(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) { return 0; }
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function nameTaken(localRegistry: LocalRegistryEntry[], name: string): boolean {
  return localRegistry.some((e) => e.name === name);
}

export function llamaArgsToText(llamaArgs: Record<string, string> | undefined): string {
  return Object.entries(llamaArgs || {})
    .map(([flag, value]) => (value ? `${flag} ${value}` : flag))
    .join('\n');
}

// --- Flavor sampling shortcuts (kodo/doc/SAMPLING.md §9) --------------------
//
// A flavor carries no request-level sampling state of its own — only
// `llama_args`. FlavorModal.tsx's structured sampling form is a friendlier
// view of a subset of those same CLI flags, kept in sync live in both
// directions: editing a sampling field rewrites the corresponding `--flag`
// in `llama_args`, and editing `llama_args` re-derives the sampling fields.
// There is no separate stored sampling value to hold as React state — the
// helpers below read/write `llama_args` text directly. Duplicated from the
// chat webview's copies in `../llm-registry-types` on purpose — the settings
// webview keeps its own mirrors of every shared shape (see the header of
// ./types.ts).

/**
 * Parse the flavor editor's line-based llama-args textarea into `{flag: value}`.
 *
 * Mirrors `parse_llama_args_text` (kodo/llms/_local_registry.py): one flag per
 * line, a bare flag getting an empty value, blank and non-`-`-prefixed lines
 * skipped. Deliberately NOT `parseLlamaArgs` above — that one parses the
 * *Add-LLM* modals' space-separated single-line box and would mangle a bare
 * flag here. Only the keys matter for the conflict check, but the values come
 * along for free.
 */
export function parseLlamaArgsText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('-')) { continue; }
    const spaceAt = line.search(/\s/);
    if (spaceAt === -1) {
      result[line] = '';
    } else {
      result[line.slice(0, spaceAt)] = line.slice(spaceAt + 1).trim();
    }
  }
  return result;
}

/**
 * The CLI-argument list separator for a `str_list` parameter — llama.cpp
 * spells `samplers` semicolon-joined on the command line but everything else
 * comma-joined; the sampling field's own display text is always
 * comma-joined regardless (matches the session modal's convention). See
 * kodo/doc/SAMPLING.md §8b.
 */
function cliListSeparator(spec: SamplingParamSpec): string {
  return spec.name === 'samplers' ? ';' : ',';
}

/**
 * Derive the flavor editor's per-field sampling display text straight out of
 * the (possibly half-edited) `llama_args` textarea contents — there is no
 * separate stored sampling value to seed from. For each spec with at least
 * one CLI flag (excludes `min_keep`, session-override only, see
 * kodo/doc/SAMPLING.md §9), checks every alias in `cli_flags` order and uses
 * whichever is present.
 */
export function deriveSamplingTextFromLlamaArgsText(
  llamaArgsText: string,
  specs: SamplingParamSpec[],
): Record<string, string> {
  const llamaArgs = parseLlamaArgsText(llamaArgsText);
  const out: Record<string, string> = {};
  for (const spec of specs) {
    let text = '';
    for (const flag of spec.cli_flags) {
      const raw = llamaArgs[flag];
      if (raw !== undefined) {
        text = spec.kind === 'str_list'
          ? raw.split(cliListSeparator(spec)).map((s) => s.trim()).filter(Boolean).join(', ')
          : raw;
        break;
      }
    }
    out[spec.name] = text;
  }
  return out;
}

/**
 * Apply one sampling field's edited text back into the `llama_args` textarea
 * contents — the inverse of {@link deriveSamplingTextFromLlamaArgsText} for a
 * single field. Removes every one of `spec`'s CLI-flag aliases first (so
 * re-editing a field never leaves a stale `--temperature` behind a freshly
 * written `--temp`), then, if `fieldText` isn't blank, writes it back under
 * `cli_flags[0]` — the canonical spelling this editor always writes, even if
 * the flavor originally used an alias.
 */
export function applySamplingFieldToLlamaArgsText(
  llamaArgsText: string,
  spec: SamplingParamSpec,
  fieldText: string,
): string {
  const llamaArgs = parseLlamaArgsText(llamaArgsText);
  for (const flag of spec.cli_flags) {
    delete llamaArgs[flag];
  }
  const trimmed = fieldText.trim();
  if (trimmed && spec.cli_flags.length > 0) {
    llamaArgs[spec.cli_flags[0]] = spec.kind === 'str_list'
      ? trimmed.split(',').map((s) => s.trim()).filter(Boolean).join(cliListSeparator(spec))
      : trimmed;
  }
  return llamaArgsToText(llamaArgs);
}

/**
 * `spec`'s **recommended** band as display text ("0 to 2", "0.5 or above"), or
 * `null` when the spec ships no guidance at all (`seed`, `mirostat`, the
 * `str_list` parameters).
 *
 * Spelt with the word "to" rather than a hyphen because several bands start
 * negative (`repeat_last_n` is -1 to 2048, the penalties are -1 to 1), where a
 * hyphen would read as a minus sign. Feeds both the field label
 * ({@link samplingLabelText}) and the ⚠ tooltip
 * ({@link samplingRangeWarning}), so the two always quote the same numbers.
 */
export function sensibleRangeText(spec: SamplingParamSpec): string | null {
  // `?? null` rather than a plain read: an older kodo server's `sampling_specs`
  // omits these fields entirely, and `undefined` must degrade to "no guidance"
  // instead of being formatted into the label as literal "undefined".
  const low = spec.sensible_minimum ?? null;
  const high = spec.sensible_maximum ?? null;
  if (spec.kind === 'str_list' || (low === null && high === null)) {
    return null;
  }
  // A float bound that happens to be whole keeps its ".0" — JSON gave us `2`
  // for `2.0`, and "0 to 2" on a field whose values are decimals reads as if
  // only integers belong there. Ints stay bare.
  const show = (value: number): string =>
    spec.kind === 'float' && Number.isInteger(value) ? value.toFixed(1) : String(value);
  if (low !== null && high !== null) {
    return `${show(low)} to ${show(high)}`;
  }
  return low !== null ? `${show(low)} or above` : `${show(high as number)} or below`;
}

/**
 * One sampling field's label: the parameter name plus the guidance a user needs
 * *before* typing — the recommended band and, when the parameter has one, the
 * value that turns it off ("Temperature (0.0 to 2.0, 1.0 disables)"). A parameter
 * with neither (`seed`) is just its label.
 *
 * Both are advisory: the band clamps nothing (the server's hard
 * `minimum`/`maximum` do that), and "disables" names the sampler's neutral
 * value — a real value to write into `llama_args`, unlike leaving the field
 * blank, which writes no flag at all. Duplicated from the chat webview's copy
 * (../llm-registry-types) so both modals label their fields identically.
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
 * The tooltip for `spec`'s yellow ⚠ next to a flavor-editor sampling field, or
 * `null` when `fieldText` needs no warning.
 *
 * Advisory guidance against the spec's *recommended* band
 * (`sensible_minimum`/`sensible_maximum`, kodo/doc/SAMPLING.md §8d) — never
 * validation: the flagged value is still written into `llama_args` verbatim,
 * and the server's own hard `minimum`/`maximum` are what actually clamp.
 *
 * A blank field, a `str_list` parameter, a spec with no band, a half-typed
 * number and a value exactly equal to the spec's `neutral` (disable) value all
 * warn-free — see the chat webview's copy in ../llm-registry-types for why
 * each of those exemptions exists. Duplicated from that copy on purpose, same
 * as every other shared shape in this module (see its header).
 */
export function samplingRangeWarning(spec: SamplingParamSpec, fieldText: string): string | null {
  // Same source as the label's band, so the two can't quote different numbers;
  // `null` means the spec ships no guidance and nothing can be out of band.
  const range = sensibleRangeText(spec);
  if (range === null) {
    return null;
  }
  const low = spec.sensible_minimum ?? null;
  const high = spec.sensible_maximum ?? null;
  const trimmed = fieldText.trim();
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
 * The **hard**-error message for a flavor-editor sampling field, or `null` if
 * `fieldText` would write cleanly into `llama_args` (including blank, which
 * just writes no flag).
 *
 * Unlike {@link samplingRangeWarning}, this flags a value llama-server would
 * reject outright rather than merely one Kōdo discourages: an unknown
 * `samplers` stage name (checked against that spec's `valid_values`, only set
 * for `samplers`), or numeric text that doesn't parse. Purely a visual mark
 * here — the flavor editor has no per-field Apply to gate the way the session
 * sampling modal does, so an unfixed error still gets written into
 * `llama_args` and fails at the next llama-server launch instead of a request
 * silently dropping it. See kodo/doc/SAMPLING.md §8e. Duplicated from the
 * chat webview's copy (../llm-registry-types) on purpose, same as every other
 * shared shape in this module (see its header).
 */
export function samplingFieldError(spec: SamplingParamSpec, fieldText: string): string | null {
  const trimmed = fieldText.trim();
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
  // `Number(...)`, not `parseInt`/`parseFloat`: those parse a leading numeric
  // *prefix* and would wave "1.2.3" through as `1.2`.
  if (Number.isFinite(Number(trimmed)) || !/\d/.test(trimmed)) {
    return null;
  }
  return `"${trimmed}" is not a valid number.`;
}

/**
 * Whether a flavor-editor sampling field has *any* problem worth flagging —
 * a hard error ({@link samplingFieldError}) or an advisory out-of-band value
 * ({@link samplingRangeWarning}), whichever applies, hard error first. Both
 * render as the same yellow ⚠ (`.sampling-warn`) — the tooltip text is what
 * explains which one it is. Duplicated from the chat webview's copy
 * (../llm-registry-types) on purpose, same as every other shared shape in
 * this module (see its header).
 */
export function samplingFieldIssue(spec: SamplingParamSpec, fieldText: string): string | null {
  return samplingFieldError(spec, fieldText) ?? samplingRangeWarning(spec, fieldText);
}

// The "Manage flavors" modal's platform radio group — order matters (render
// order). `both` (no restriction) is the default for a brand-new flavor,
// mirroring the server's LlamaFlavorPlatform.BOTH default.
export const FLAVOR_PLATFORM_OPTIONS: { value: LlamaFlavorPlatform; label: string }[] = [
  { value: 'mac', label: 'Apple Silicon only' },
  { value: 'gpu', label: 'NVIDIA GPU only' },
  { value: 'both', label: 'Apple Silicon and NVIDIA GPU' },
];

// Short badge text for a flavor's platform restriction in the "Manage
// flavors" list — omitted (empty string) for 'both' since that's "no
// restriction," not something worth calling out next to every row.
export function flavorPlatformBadge(platform: LlamaFlavorPlatform | undefined): string {
  if (platform === 'mac') { return 'Apple Silicon only'; }
  if (platform === 'gpu') { return 'NVIDIA GPU only'; }
  return '';
}

export const DOWNLOADABLE = new Set(['hardcoded_hf', 'custom_hf']);
export const CUSTOM = new Set(['custom_hf', 'custom_file', 'custom_server_url']);
export const FLAVOR_CAPABLE = new Set(['hardcoded_hf', 'custom_hf', 'custom_file']);

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) { return ''; }
  const mb = n / (1024 * 1024);
  return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

// Auto-scales B/s -> KB/s -> MB/s -> GB/s (1024-based), unlike formatBytes
// above: a speed can legitimately sit well under 1 MB/s on a slow
// connection, where formatBytes' MB/GB-only scale would round to '0 MB'.
export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined || bytesPerSecond < 0) { return ''; }
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const formatted = unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export interface RamWarning {
  level: 'red' | 'yellow';
  text: string;
}

// Rules (per product spec): red if below the absolute minimum; yellow if
// below the recommended amount. When min_memory === memory, the red check
// already covers every case the yellow check would (vram >= min == memory
// implies vram >= memory), so only red can ever fire — no special-casing
// needed. A 0 value means "unknown — don't warn" for that threshold.
// vram/ram are summed into one "total memory available for a
// GPU+CPU-offloaded model" figure — on macOS ram is always null (vram
// already reports the full unified-memory pool), so the sum degrades to
// vram alone there. See doc/LLM_REGISTRY.md §4.4 in the kodo repo.
export function ramWarning(
  entry: LocalRegistryEntry,
  vram: number | null,
  ram: number | null,
): RamWarning | null {
  if (vram === null && ram === null) { return null; }
  const total = (vram || 0) + (ram || 0);
  const min = entry.min_memory || 0;
  const rec = entry.memory || 0;
  if (min > 0 && total < min) {
    return {
      level: 'red',
      text: `⛔ This LLM will likely not run on this machine — it needs at least ${min} GB of combined VRAM + RAM, but only ${total} GB was detected.`,
    };
  }
  if (rec > 0 && total < rec) {
    return {
      level: 'yellow',
      text: `⚠️ This LLM may not perform well with large contexts on this machine — ${rec} GB of combined VRAM + RAM is recommended, but only ${total} GB was detected.`,
    };
  }
  return null;
}

export interface LlamaCppVersionWarning {
  level: 'red';
  text: string;
}

// entry.llamacpp_version is a bare build number (0 = "any version works —
// don't warn"); the installed version is the "b<N>" string llama-server
// itself reports (see doc/WS_PROTOCOL.md §4.1, doc/LLM_REGISTRY.md §4.4).
// installedVersion is null until the first hello.ack/version_info reply —
// don't warn on unknown state, same convention as ramWarning's vram/ram nulls.
export function llamacppVersionWarning(
  entry: LocalRegistryEntry,
  installedVersion: string | null,
): LlamaCppVersionWarning | null {
  const required = entry.llamacpp_version || 0;
  if (required <= 0 || !installedVersion) { return null; }
  const installed = parseInt(installedVersion.replace(/^b/i, ''), 10);
  if (!Number.isFinite(installed) || installed >= required) { return null; }
  return {
    level: 'red',
    text: `⛔ The installed llama.cpp (b${installed}) does not support this LLM — it requires at least b${required}. Update llama.cpp to run it.`,
  };
}

export interface PlatformWarning {
  level: 'red';
  text: string;
}

// Mirrors flavorCompatibleWithHost (src/llm-registry-types.ts) and
// _flavor_compatible_with_host/current_host_platform (kodo/llms/
// _local_registry.py) — duplicated here since this module is webview-only
// (see this file's header comment). Keep in sync by hand.
function flavorCompatibleWithHost(flavor: LocalFlavor, isMac: boolean): boolean {
  if (!flavor.platform || flavor.platform === 'both') { return true; }
  return isMac ? flavor.platform === 'mac' : flavor.platform === 'gpu';
}

// entry has zero flavors compatible with this host (kodo/doc/
// LLM_REGISTRY.md §4.6b) — a static fact about entry.flavors, not a
// hardware-detection question like ramWarning/llamacppVersionWarning above,
// so there's no "unknown — don't warn" case: an entry with no flavors at
// all is never platform-restricted (nothing to be incompatible about).
export function platformWarning(entry: LocalRegistryEntry, isMac: boolean): PlatformWarning | null {
  const flavors = entry.flavors || [];
  if (flavors.length === 0 || flavors.some((f) => flavorCompatibleWithHost(f, isMac))) {
    return null;
  }
  return {
    level: 'red',
    text: `⛔ This LLM is not compatible with this platform (${isMac ? 'Apple Silicon' : 'Windows/Linux GPU'}) — none of its flavors support running here.`,
  };
}
