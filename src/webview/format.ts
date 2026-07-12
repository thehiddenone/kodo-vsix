// Small formatting helpers shared across WebView components.

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
