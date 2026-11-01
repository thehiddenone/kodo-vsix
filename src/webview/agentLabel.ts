/**
 * The composer's agent button label (AgentButton.tsx). Pure, so unit-tested.
 */

/** Longest agent label the button shows in full; a longer one keeps this many
 *  characters and gains a "…". Sized with `COMPOSER_SIDE_WIDTH` (styles.ts),
 *  which is 150px so that 16 characters plus the ellipsis fit at 14px. */
export const AGENT_LABEL_MAX_CHARS = 16;

/** `label` cut to AGENT_LABEL_MAX_CHARS characters plus "…" when longer
 *  ("Problem Solver 12345" → "Problem Solver 1…"). Counts code points, not
 *  UTF-16 units, so a cut can't split a surrogate pair. */
export function shortAgentLabel(label: string): string {
  const chars = Array.from(label);
  return chars.length > AGENT_LABEL_MAX_CHARS ? `${chars.slice(0, AGENT_LABEL_MAX_CHARS).join('')}…` : label;
}
