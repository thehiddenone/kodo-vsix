// Small formatting helpers shared across WebView components.
/**
 * "<prefix> in Xs, N chars, R chars/s" — the completion summary shown once a
 * thinking block or tool-arg generation finishes. Falls back to "<prefix>, N
 * chars" when the duration is unknown (e.g. rehydrated history) so we never
 * divide by zero or render a bogus rate.
 */
export function completionLabel(prefix: string, chars: number, durationMs: number | null): string {
  if (durationMs === null || durationMs <= 0) {
    return `${prefix}, ${chars.toLocaleString()} chars`;
  }
  const secs = durationMs / 1000;
  const rate = (chars / secs).toFixed(1);
  return `${prefix} in ${Math.round(secs)}s, ${chars.toLocaleString()} chars, ${rate} chars/s`;
}
/** Compact a token count for the header: 1234 → "1,234", 25600 → "25.6K". */
export function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
  }
  return n.toLocaleString();
}
