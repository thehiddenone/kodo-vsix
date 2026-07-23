// Small formatting helpers shared across WebView components.
import type { UiSettings } from './types';

/**
 * Rough characters-per-token divisor used to estimate token counts from a plain
 * text length. Real tokenization is model-specific and only exists server-side
 * per whole turn (thinking + text + tool args lumped together), never broken
 * down per block — so for these per-block streaming indicators we approximate
 * from character count instead. ~4 chars/token is the standard rule of thumb for
 * mixed English + code; the number is deliberately labelled approximate in the
 * UI (leading "~" + a tooltip) so it is never mistaken for an exact count.
 */
const CHARS_PER_TOKEN = 4;

/** Approximate a token count from a character count (see {@link CHARS_PER_TOKEN}). */
export function approxTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

/**
 * Tooltip text attached to every approximate-token readout so users understand
 * the number is an estimate, not the model's real tokenization.
 */
export const APPROX_TOKENS_TITLE =
  'Approximate number of tokens, estimated from text length (~4 characters per token). Not the model’s exact tokenization.';

/**
 * "<prefix> in Xs, ~N tokens, ~R tok/s" — the completion summary shown once a
 * thinking block or tool-arg generation finishes. Token counts are approximate
 * (see {@link approxTokens}); pair this label with {@link APPROX_TOKENS_TITLE}
 * so the estimate is honest. Falls back to "<prefix>, ~N tokens" when the
 * duration is unknown (e.g. rehydrated history) so we never divide by zero or
 * render a bogus rate.
 */
export function completionLabel(prefix: string, chars: number, durationMs: number | null): string {
  const tokens = approxTokens(chars);
  if (durationMs === null || durationMs <= 0) {
    return `${prefix}, ~${tokens.toLocaleString()} tokens`;
  }
  const secs = durationMs / 1000;
  const rate = (tokens / secs).toFixed(1);
  return `${prefix} in ${Math.round(secs)}s, ~${tokens.toLocaleString()} tokens, ~${rate} tok/s`;
}
/** Compact a token count for the header: 1234 → "1,234", 25600 → "25.6K". */
export function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
  }
  return n.toLocaleString();
}

/** `settings.timezone === 'system'` resolves to the runtime's local IANA zone;
 *  anything else (`'UTC'` or a curated zone id — see kodo-settings-panel.ts's
 *  `TIMEZONE_OPTIONS`) is a real IANA id already, passed straight to `Intl`. */
function resolveTimeZone(timezone: string): string {
  return timezone === 'system' || !timezone
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : timezone;
}

/** Pull year/month/day/hour/minute/AM-PM out of an `Intl.DateTimeFormat` pass
 *  over `ms`, so {@link formatTimestamp} can assemble field order itself
 *  (`formatToParts`' token *values* don't depend on locale — only its
 *  `.format()` string's order/separators do) instead of fighting locale
 *  quirks (a comma after the date, "at", non-Western digits, …). */
function timestampParts(ms: number, timeZone: string, hour12: boolean) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    dayPeriod: get('dayPeriod').toUpperCase(),
  };
}

/**
 * Render a `SessionEntry.ts` epoch-ms timestamp per the user's "Show
 * Timestamps" preferences (kodo-vsix-only, never reaches the kodo server —
 * see `UiSettings`). `clockFormat`'s `ymd`/`mdy`/`dmy` prefix picks the date
 * field order, its `_12h`/`_24h` suffix the clock style; e.g. `ymd_24h` →
 * "2026-07-23 14:41", `mdy_12h` → "07/23/2026 2:41 PM".
 */
export function formatTimestamp(ms: number, settings: UiSettings): string {
  const timeZone = resolveTimeZone(settings.timezone);
  const hour12 = settings.clockFormat.endsWith('_12h');
  const { year, month, day, hour, minute, dayPeriod } = timestampParts(ms, timeZone, hour12);
  const clock = hour12 ? `${hour}:${minute} ${dayPeriod}` : `${hour}:${minute}`;
  const date = settings.clockFormat.startsWith('ymd')
    ? `${year}-${month}-${day}`
    : settings.clockFormat.startsWith('mdy')
      ? `${month}/${day}/${year}`
      : `${day}/${month}/${year}`;
  return `${date} ${clock}`;
}
