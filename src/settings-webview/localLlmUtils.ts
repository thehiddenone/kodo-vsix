/** Shared helpers for the "Local Inference" tab's add-LLM, Configure (knobs)
 *  and Manage-profiles modals — parsing form input into the wire shapes the
 *  host expects, and the local-registry name-clash check every add form
 *  validates against. */

import type { KnobDef, LlamaArgSpec, LocalRegistryEntry, SamplingParamSpec } from './types';

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

// --- Profile argument rows: llama_args text <-> structured rows -------------
//
// A user-defined profile is a raw `{flag: value}` arg set. `ProfileModal.tsx`
// offers two views of exactly the same text: an "Add argument" picker over
// the server's curated catalog (`LlamaArgSpec`, kodo/doc/LLM_REGISTRY.md
// §4.7), which renders one typed row per flag, and a raw "one flag per line"
// box for anything the catalog doesn't cover. Neither is separate state —
// both read and write the one `llama_args_text` string, so they can never
// disagree. The helpers below do that reading and writing.

/**
 * Parse the profile editor's line-based llama-args text into `{flag: value}`.
 *
 * Mirrors `parse_llama_args_text` (kodo/llms/local_registry/_io.py): one flag
 * per line, a bare flag getting an empty value, blank and non-`-`-prefixed
 * lines skipped. Deliberately NOT `parseLlamaArgs` above — that one parses the
 * *Add-LLM* modals' space-separated single-line box and would mangle a bare
 * flag here.
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

/** One `{flag, value}` pair from the profile's args, in text order. A bare
 *  flag (e.g. `--jinja`) has `value: ''`. */
export interface ArgRow {
  flag: string;
  value: string;
}

/** The profile's args as ordered rows — insertion order is what the picker
 *  renders, so a freshly added argument appears at the bottom rather than
 *  jumping into some sorted position. */
export function llamaArgRows(text: string): ArgRow[] {
  return Object.entries(parseLlamaArgsText(text)).map(([flag, value]) => ({ flag, value }));
}

/** Set (or add) one flag's value, returning the new args text. Adding keeps
 *  the flag at the end; editing leaves its position alone. */
export function setLlamaArg(text: string, flag: string, value: string): string {
  const args = parseLlamaArgsText(text);
  args[flag] = value;
  return llamaArgsToText(args);
}

/** Remove one flag entirely, returning the new args text. */
export function removeLlamaArg(text: string, flag: string): string {
  const args = parseLlamaArgsText(text);
  delete args[flag];
  return llamaArgsToText(args);
}

/**
 * The catalog entries **not** already present in `text` — what the "Add
 * argument" dropdown offers. A flag can only be set once, so offering one
 * that's already a row would just overwrite it silently.
 */
export function availableArgSpecs(catalog: LlamaArgSpec[], text: string): LlamaArgSpec[] {
  const present = new Set(Object.keys(parseLlamaArgsText(text)));
  return catalog.filter((spec) => !present.has(spec.flag));
}

/**
 * `spec`'s **recommended** band as display text ("0 to 2", "0.5 or above"), or
 * `null` when it ships no guidance — every non-sampling flag, plus the
 * sampling ones with no meaningful band (`seed`, `mirostat`) and the
 * `str_list` ones.
 *
 * Spelt with the word "to" rather than a hyphen because several bands start
 * negative (the penalties are -1 to 1), where a hyphen would read as a minus
 * sign. Mirrors `sensibleRangeText` in ../llm-registry-types (the chat
 * webview's copy) — the settings webview keeps its own mirror of every shared
 * shape, see the header of ./types.ts.
 */
export function argRangeText(spec: LlamaArgSpec): string | null {
  const low = spec.sensible_minimum ?? null;
  const high = spec.sensible_maximum ?? null;
  if (spec.kind === 'str_list' || (low === null && high === null)) {
    return null;
  }
  const show = (value: number): string =>
    spec.kind === 'float' && Number.isInteger(value) ? value.toFixed(1) : String(value);
  if (low !== null && high !== null) {
    return `${show(low)} to ${show(high)}`;
  }
  return low !== null ? `${show(low)} or above` : `${show(high as number)} or below`;
}

/**
 * The **hard**-error message for one argument row's value, or `null` if it
 * would be accepted.
 *
 * Two shapes of "the server would silently drop this":
 *  - a `str_list` flag with `valid_values` (only `--samplers`) containing a
 *    name outside that set — one bad stage name makes llama-server reject the
 *    whole request (kodo/doc/SAMPLING.md §8e);
 *  - a numeric field whose text contains a digit but still fails to parse
 *    (`"1.2.3"`, `"12x"`). Checked with `Number(...)` rather than
 *    `parseInt`/`parseFloat`, which would wave "1.2.3" through as `1.2`. A
 *    bare sign/decimal-point prefix (`"-"`, `"."`) is a legitimate mid-typing
 *    state, not an error.
 *
 * A blank value is never an error: for a `bool` flag it is the only correct
 * value (a bare flag), and for anything else the raw text box is free to hold
 * a half-typed line.
 */
export function argFieldError(spec: LlamaArgSpec, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) { return null; }
  if (spec.kind === 'str_list') {
    if (!spec.valid_values) { return null; }
    const items = trimmed.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const unknown = items.filter((item) => !spec.valid_values!.includes(item));
    if (unknown.length === 0) { return null; }
    return `Unknown ${spec.label.toLowerCase()} name(s): ${unknown.join(', ')}. ` +
      `Valid names: ${spec.valid_values.join(', ')}.`;
  }
  if (spec.kind !== 'int' && spec.kind !== 'float') { return null; }
  if (Number.isFinite(Number(trimmed)) || !/\d/.test(trimmed)) { return null; }
  return `"${trimmed}" is not a valid number.`;
}

/**
 * The advisory out-of-band message for one argument row's value, or `null`.
 *
 * Guidance against the flag's *recommended* band, which only the sampling
 * flags carry (kodo/doc/SAMPLING.md §8d) — the server never clamps or rejects
 * against it. A half-typed number never warns, since the check reruns on every
 * keystroke and would otherwise flicker while a perfectly good value is being
 * typed.
 */
export function argRangeWarning(spec: LlamaArgSpec, value: string): string | null {
  const range = argRangeText(spec);
  if (range === null) { return null; }
  const trimmed = value.trim();
  if (!trimmed) { return null; }
  const parsed = spec.kind === 'int' ? parseInt(trimmed, 10) : parseFloat(trimmed);
  if (!Number.isFinite(parsed)) { return null; }
  const low = spec.sensible_minimum ?? null;
  const high = spec.sensible_maximum ?? null;
  if ((low === null || parsed >= low) && (high === null || parsed <= high)) { return null; }
  return `${trimmed} is outside the recommended range for ${spec.label} (${range}). ` +
    'Values outside that range are accepted but usually degrade output quality.';
}

/**
 * Whether one argument row has *any* problem worth flagging — a hard error
 * (a value the server would drop) or an out-of-band value (one it accepts but
 * that is probably a bad idea) — whichever applies, hard error first.
 *
 * The single function ProfileModal calls both to render the yellow ⚠ and to
 * gate Save: asking a user to tell "this would vanish" from "this is unwise"
 * apart by icon colour isn't a distinction worth making at a glance, so both
 * render identically and the tooltip explains which it is.
 */
export function argIssue(spec: LlamaArgSpec, value: string): string | null {
  return argFieldError(spec, value) ?? argRangeWarning(spec, value);
}

/**
 * Which sampling spec (if any) a catalog flag mirrors — used only to keep the
 * profile editor's ⚠ text in step with the session sampling modal's when the
 * server ships an older catalog with no band on a sampling flag. Returns the
 * spec whose `cli_flags` include `flag`.
 */
export function samplingSpecForFlag(
  specs: SamplingParamSpec[],
  flag: string,
): SamplingParamSpec | undefined {
  return specs.find((spec) => spec.cli_flags.includes(flag));
}

// --- Knobs (the Default profile) --------------------------------------------

/**
 * The resolved current selection for `knob`, falling back to the knob's own
 * default when `selections` has nothing usable for it.
 *
 * The server already sends `knob_selections` fully resolved, so this normally
 * just reads it back — it exists for the modal's *local* (unsaved) state,
 * where a knob the user hasn't touched yet has no entry.
 */
export function knobSelection(knob: KnobDef, selections: Record<string, string>): string {
  const stored = selections[knob.id];
  if (stored !== undefined) { return stored; }
  return knob.default ?? knob.options?.[0]?.id ?? '';
}

/**
 * The llama-server flags `knob` contributes at `selection` — what the
 * Configure modal shows under each control so the effect of a choice is
 * visible without launching anything. Mirrors `LlamaKnob.llama_args_for`
 * (kodo/llms/local_registry/_knobs.py).
 */
export function knobLlamaArgs(knob: KnobDef, selection: string): Record<string, string> {
  if (knob.kind === 'number') {
    const value = selection.trim();
    return value && knob.flag ? { [knob.flag]: value } : {};
  }
  const chosen = (knob.options || []).find((o) => o.id === selection);
  return chosen?.llama_args ?? {};
}

/** `"--min-p 0.08, --top-k 0"`, or `''` when the state contributes no flags —
 *  the one-line "what this does" summary under a knob's control. */
export function formatLlamaArgs(args: Record<string, string>): string {
  return Object.entries(args)
    .map(([flag, value]) => (value ? `${flag} ${value}` : flag))
    .join(', ');
}

export const DOWNLOADABLE = new Set(['hardcoded_hf', 'custom_hf']);
export const CUSTOM = new Set(['custom_hf', 'custom_file', 'custom_server_url']);
/** Entry kinds that have a launch configuration at all — everything except
 *  `custom_server_url`, whose process kodo does not start. Gates both the
 *  Configure and Manage-profiles buttons. */
export const PROFILE_CAPABLE = new Set(['hardcoded_hf', 'custom_hf', 'custom_file']);

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

/**
 * Parse a `"bN"` llama.cpp version string into its bare build number, or
 * `null` if it isn't one.
 *
 * Exists so build numbers are never compared as *strings*: `"b9876" > "b10000"`
 * is `true` lexicographically and wrong, which would silently misjudge every
 * comparison once llama.cpp crossed a digit boundary.
 */
export function llamaCppBuildNumber(version: string | null): number | null {
  if (!version) { return null; }
  const parsed = parseInt(version.replace(/^b/i, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * True when the installed llama.cpp build is at least the latest one GitHub
 * reports — i.e. `llamacpp.update` would decline to do anything.
 *
 * Mirrors the server's own short-circuit condition (`installed.build >=
 * version` in `_handle_llamacpp_update`, kodo doc/WS_PROTOCOL.md §7.6), `>=`
 * included: a build *ahead* of the published latest (a manually pinned
 * newer/nightly one) is equally "nothing to update to".
 *
 * Returns `false` whenever either side is unknown — not installed at all, or
 * no `latestVersion` yet because the panel hasn't fetched one or GitHub was
 * unreachable. "Can't tell" must never present as "up to date", since that
 * would disable the button precisely when the user most needs it.
 */
export function llamaCppIsUpToDate(
  installedVersion: string | null,
  latestVersion: string | null,
): boolean {
  const installed = llamaCppBuildNumber(installedVersion);
  const latest = llamaCppBuildNumber(latestVersion);
  if (installed === null || latest === null) { return false; }
  return installed >= latest;
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
  const installed = llamaCppBuildNumber(installedVersion);
  if (installed === null || installed >= required) { return null; }
  return {
    level: 'red',
    text: `⛔ The installed llama.cpp (b${installed}) does not support this LLM — it requires at least b${required}. Update llama.cpp to run it.`,
  };
}
