/**
 * Display names, glyphs and descriptions of the Session Parameters values —
 * Mode, Edit Control, Tool Control and each thinking family's tiers — shared by
 * the Session Parameters popup (ModeControls.tsx), the session header line
 * (UsagePanel.tsx) and the change element (paramChanges.ts), so the three can
 * never name a value differently. Pure data: no `vscode` API, so it is
 * importable from unit tests.
 */

import type { ThinkingFamily } from '../llm-registry-types';
import type { EditControl, CommandControl } from './types';

/**
 * Description of what each Mode choice does. These are *prefix-free*: the
 * popup already prints the group name as a heading and the choice name as the
 * row's label, so a string here starts straight at the explanation. (They used
 * to read "Mode: Interactive — agents work alongside you…" because they were
 * the whole of a toggle's tooltip, with no heading above them.)
 */
export const MODE_DESC = {
  interactive: 'Agents work alongside you, asking questions before key decisions.',
  autonomous: 'Agents work on their own, making reasonable assumptions instead of pausing.',
};

/** Description of each Edit Control posture (prefix-free — see {@link MODE_DESC}). */
export const EDIT_DESC: Record<EditControl, string> = {
  smart: 'Kōdo decides per edit whether to pause for your sign-off or apply it automatically.',
  review_all: 'Kōdo pauses for your sign-off on every edit.',
  allow_all: 'Kōdo applies edits without pausing.',
};

/** Description of each Tool Control posture (prefix-free — see {@link MODE_DESC}). */
export const TOOL_DESC: Record<CommandControl, string> = {
  smart: 'Kōdo decides per tool action or shell command whether to ask for your approval or proceed automatically.',
  defensive: 'Kōdo asks you to review and approve all potentially unsafe tool actions and shell commands.',
  permissive: 'Kōdo allows tool actions and shell commands without asking.',
};

/** Display name of each Edit Control posture, as the popup rows label them. */
export const EDIT_NAME: Record<EditControl, string> = {
  smart: 'Smart',
  review_all: 'Review All',
  allow_all: 'Allow All',
};

/** Display name of each Tool Control posture, as the popup rows label them. */
export const COMMAND_NAME: Record<CommandControl, string> = {
  smart: 'Smart',
  defensive: 'Defensive',
  permissive: 'Permissive',
};

/** Glyph shown before each Mode row's name. */
export const MODE_GLYPH = {
  interactive: '💬',
  autonomous: '⚡',
};

/** Glyph shown before each Edit Control row's name. Smart shares 🧠 with Tool
 *  Control's Smart on purpose — it is the same "Kōdo decides" posture in both
 *  groups; every other glyph in the popup is unique. */
export const EDIT_GLYPH: Record<EditControl, string> = {
  smart: '🧠',
  review_all: '🔍',
  allow_all: '✅',
};

/** Glyph shown before each Tool Control row's name (Smart: see {@link EDIT_GLYPH}). */
export const COMMAND_GLYPH: Record<CommandControl, string> = {
  smart: '🧠',
  defensive: '🛡️',
  permissive: '🔓',
};

/** Row order within each single-choice group — default first, as before. */
export const EDIT_ORDER: EditControl[] = ['smart', 'review_all', 'allow_all'];
export const COMMAND_ORDER: CommandControl[] = ['smart', 'defensive', 'permissive'];

/**
 * Per-tier tooltip text, one dictionary per thinking family (kodo/doc/
 * LLM_REGISTRY.md §4.5) — the same tier slug can appear in both families
 * (e.g. "high") with a different token-budget/effort meaning, so the family
 * is needed to pick the right description, not just the tier name.
 */
const _QWEN_THINKING_DESC: Record<string, string> = {
  minimal: 'Thinking: Minimal. The smallest reasoning budget — fastest replies, most likely to miss subtlety on hard problems.',
  low: 'Thinking: Low. A small reasoning budget — quick replies with a bit of deliberation.',
  medium: 'Thinking: Medium. A moderate reasoning budget — balances speed and depth for everyday tasks.',
  high: 'Thinking: High. A large reasoning budget — more careful deliberation on demanding problems, at the cost of speed.',
  huge: 'Thinking: Extra high. A very large reasoning budget — reserved for the hardest problems, where speed matters least.',
  unlimited: 'Thinking: Unlimited. No cap on reasoning — Kōdo thinks for as long as it judges necessary.',
};

const _GPT_OSS_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. Minimal reasoning effort — fastest replies.',
  medium: "Thinking: Medium. The model's default reasoning effort — balances speed and depth.",
  high: 'Thinking: High. Maximum reasoning effort — the most careful deliberation, at the cost of speed.',
};

const _QWEN4EXP_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. Brief, focused reasoning that moves straight to the conclusion — fastest replies.',
  medium: 'Thinking: Medium. A moderate reasoning effort — balances speed and depth for everyday tasks.',
  xhigh: "Thinking: High. Qwen3.8-Flash-Next's own default — careful reasoning that validates assumptions and weighs alternatives, at the cost of speed.",
};

const _MUSE_GLIMMER_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. The lightest reasoning Muse Glimmer offers — fastest replies, for simple, scoped tasks.',
  medium: 'Thinking: Medium. A moderate reasoning strength — balances speed and depth for everyday tasks.',
  high: "Thinking: High. Muse Glimmer's own default — careful reasoning, one of the two levels Meta recommends for coding and agentic work.",
  xhigh: 'Thinking: Extra high. The strongest reasoning Muse Glimmer offers — for the hardest coding and agentic problems, at the cost of speed.',
};

const _OPENROUTER_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. The smallest reasoning effort — fastest and cheapest replies.',
  medium: "Thinking: Medium. OpenRouter's own default reasoning effort — balances speed and depth.",
  high: 'Thinking: High. A large reasoning effort — more careful deliberation on demanding problems, at the cost of speed and tokens.',
  max: 'Thinking: Max. The largest reasoning effort — reserved for the hardest problems, where speed and cost matter least.',
};

const _ANTHROPIC_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. Most efficient — significant token savings, fewer tool calls, some capability reduction. Best for simple, scoped tasks.',
  medium: 'Thinking: Medium. A balanced step down from the default — solid results at moderate token spend.',
  high: "Thinking: High. Claude's own default — complex reasoning and difficult coding, where quality matters more than speed or cost.",
  xhigh: 'Thinking: Extra high. Extended capability for long-horizon coding and agentic work — expect meaningfully higher token usage than High.',
  max: 'Thinking: Max. Absolute maximum capability, no constraints on token spending. Reserve for genuinely frontier problems.',
};

const _OPENAI_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. Minimal reasoning before answering — fastest and cheapest replies.',
  medium: "Thinking: Medium. GPT-5.6's own default reasoning effort — balances speed and depth.",
  high: 'Thinking: High. More careful deliberation on demanding problems, at the cost of speed.',
  xhigh: 'Thinking: Extra high. Extended reasoning for long-running coding and agentic tasks.',
  max: 'Thinking: Max. The largest reasoning effort — for the hardest problems, where speed and cost matter least.',
};

const _META_THINKING_DESC: Record<string, string> = {
  minimal: 'Thinking: Minimal. The smallest reasoning effort Muse Spark accepts — fastest replies, most likely to miss subtlety.',
  low: 'Thinking: Low. A small reasoning effort — quick replies with a bit of deliberation.',
  medium: 'Thinking: Medium. A moderate reasoning effort — balances speed and depth for everyday tasks.',
  high: 'Thinking: High. More careful deliberation on demanding problems, at the cost of speed.',
  xhigh: 'Thinking: Extra high. The largest reasoning effort Muse Spark accepts — for long-horizon agentic work.',
};

const _GOOGLE_THINKING_DESC: Record<string, string> = {
  minimal: "Thinking: Minimal. The least thinking Gemini will do — fastest replies. (Gemini's reasoning cannot be switched off entirely.)",
  low: 'Thinking: Low. A small thinking budget — quick replies with a bit of deliberation.',
  medium: "Thinking: Medium. Gemini's own default thinking level — balances speed and depth.",
  high: 'Thinking: High. The deepest thinking Gemini offers — more careful deliberation, at the cost of speed and tokens.',
};

const _ALIBABA_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. A small reasoning effort — fastest and cheapest replies.',
  medium: 'Thinking: Medium. A moderate reasoning effort — balances speed and depth for everyday tasks.',
  xhigh: "Thinking: High. Qwen's own default — thorough analysis for demanding problems, at the cost of speed and tokens.",
};

const _DEEPSEEK_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. A small reasoning effort — fastest and cheapest replies.',
  high: "Thinking: Medium. DeepSeek's own default reasoning effort — thorough deliberation on demanding problems.",
  max: 'Thinking: High. A distinct extended thinking mode, not just more of the same — DeepSeek recommends it for demanding agent work, at a real cost in tokens.',
};

const _KIMI_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. A small reasoning effort — the one to pick when K3 is reasoning for too long.',
  high: 'Thinking: Medium. A large reasoning effort — careful deliberation on demanding problems, at the cost of speed.',
  max: "Thinking: High. Kimi's own default — the deepest reasoning, for the hardest problems.",
};

const _BEDROCK_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. Minimal reasoning — skips thinking on simple tasks where speed matters most.',
  medium: 'Thinking: Medium. Moderate reasoning — may skip thinking for very simple queries.',
  high: "Thinking: High. Claude on Bedrock's own default — deep reasoning on complex tasks.",
  xhigh: 'Thinking: Extra high. Extended reasoning depth, on the Claude models that offer it.',
  max: 'Thinking: Max. No constraints on thinking depth — for genuinely frontier problems.',
};

/** Appended to every OpenRouter tier tooltip: unlike the two local families
 *  (where the family *is* the model's own mechanism), this one setting rides
 *  every model OpenRouter can route to, and the ones that don't support
 *  reasoning are documented to ignore the parameter silently — which is also
 *  why the control stays enabled for the whole vendor rather than tracking a
 *  per-model capability (kodo/doc/LLM_REGISTRY.md §3a). Especially relevant
 *  under Auto mode, where the routed model isn't known until the request. */
const _OPENROUTER_THINKING_CAVEAT = "\nModels that don't support reasoning ignore this.";

/** Appended to every Kimi tier tooltip. Kimi K3 takes a graded reasoning
 *  effort; Kimi K2.7 Code accepts no effort parameter at all (its thinking is
 *  permanently on at one fixed level), so on that model the tier is silently
 *  dropped. The tier set is vendor-scoped, not per-model — a session talks to
 *  both models in one turn, one per capability tier — so the caveat lives in
 *  the tooltip rather than in a disabled control (kodo/doc/LLM_REGISTRY.md
 *  §4.5a). */
const _KIMI_THINKING_CAVEAT = '\nKimi K2.7 Code always thinks at its own fixed level and ignores this.';

/** Appended to every AWS Bedrock tier tooltip. Bedrock has no unified
 *  reasoning parameter of its own: per-model settings are passthrough and
 *  Bedrock rejects a field the target model doesn't define, so Kōdo only
 *  sends an effort to the Claude models documented to accept one and sends
 *  nothing at all for the rest (kodo/doc/LLM_REGISTRY.md §3b). Saying so is
 *  the honest counterpart to keeping one vendor-wide control. */
const _BEDROCK_THINKING_CAVEAT = '\nOnly Claude models on Bedrock use this; other models ignore it.';

/** Family -> the caveat appended to every one of its tier tooltips, for the
 *  families where the selected tier does not reach every model the vendor
 *  serves. Absent means no caveat. */
export const THINKING_CAVEAT: Partial<Record<ThinkingFamily, string>> = {
  openrouter_reasoning_effort: _OPENROUTER_THINKING_CAVEAT,
  kimi_reasoning_effort: _KIMI_THINKING_CAVEAT,
  bedrock_effort: _BEDROCK_THINKING_CAVEAT,
};

const _THINKING_DESC: Record<ThinkingFamily, Record<string, string>> = {
  qwen_reasoning_budget: _QWEN_THINKING_DESC,
  gpt_oss_reasoning_effort: _GPT_OSS_THINKING_DESC,
  qwen4exp_reasoning_effort: _QWEN4EXP_THINKING_DESC,
  muse_glimmer_reasoning_strength: _MUSE_GLIMMER_THINKING_DESC,
  anthropic_effort: _ANTHROPIC_THINKING_DESC,
  openai_reasoning_effort: _OPENAI_THINKING_DESC,
  meta_reasoning_effort: _META_THINKING_DESC,
  google_thinking_level: _GOOGLE_THINKING_DESC,
  alibaba_reasoning_effort: _ALIBABA_THINKING_DESC,
  deepseek_reasoning_effort: _DEEPSEEK_THINKING_DESC,
  kimi_reasoning_effort: _KIMI_THINKING_DESC,
  openrouter_reasoning_effort: _OPENROUTER_THINKING_DESC,
  bedrock_effort: _BEDROCK_THINKING_DESC,
};

/** The short display label for a tier, as the Thinking button shows it
 *  ("Thinking: High") — taken from the *head* of that family's tooltip in
 *  {@link _THINKING_DESC}, everything up to its first full stop, so the button
 *  and its tooltip can never disagree.
 *
 *  It has to be read off the table rather than title-cased from the slug,
 *  because several vendors' slugs are not their own ladder's names: a tier
 *  Kōdo calls `xhigh` is the *top* of Qwen3.8-Flash-Next's three-tier ladder
 *  and reads "Thinking: High", and DeepSeek's `high`/`max` present as
 *  "Medium"/"High". Hence the family argument — the same slug labels
 *  differently per family.
 *
 *  Falls back to title-casing the slug for a tier (or family) this build's
 *  table doesn't know; see `_thinkingTierDesc` on why that shouldn't happen. */
export function tierLabel(family: ThinkingFamily | null, tier: string): string {
  const desc = family === null ? undefined : _THINKING_DESC[family][tier];
  if (desc !== undefined) {
    const dot = desc.indexOf('.');
    return dot === -1 ? desc : desc.slice(0, dot);
  }
  return `Thinking: ${tier.charAt(0).toUpperCase() + tier.slice(1)}`;
}

/** The display name of a thinking tier as the popup's row label shows it
 *  ("High") — {@link tierLabel} minus its "Thinking: " prefix, so the popup's
 *  rows and the tooltip tables can never disagree about a tier's name. */
export function tierName(family: ThinkingFamily, tier: string): string {
  const label = tierLabel(family, tier);
  return label.startsWith('Thinking: ') ? label.slice('Thinking: '.length) : label;
}

/** Glyph per thinking tier, a rising-energy ladder. Keyed by the tier's
 *  *display name* ({@link tierName}), not its slug: slugs mean different rungs
 *  in different families (DeepSeek's `max` reads "High"), and the glyph has to
 *  agree with the name printed beside it. */
export const THINKING_GLYPH: Record<string, string> = {
  Minimal: '🪶',
  Low: '🕯️',
  Medium: '💡',
  High: '🔥',
  'Extra high': '☄️',
  Max: '🌋',
  Unlimited: '♾️',
};

/** The prefix-free description of a thinking tier, for the popup row under its
 *  name: the family's tooltip text minus the leading "Thinking: <tier>." that
 *  {@link tierLabel} consumes. Unlike the other four groups' description
 *  tables (which were rewritten prefix-free), these strings stay
 *  tooltip-shaped because their heads are also the tier *names* — so the
 *  prefix is stripped here instead.
 *
 *  The per-family caveat is deliberately NOT appended: it is identical for
 *  every tier of a family, so the popup prints it once under the Thinking
 *  heading (see `_thinkingNote`) rather than on all four rows. */
export function tierDesc(family: ThinkingFamily, tier: string): string {
  const desc = _THINKING_DESC[family][tier];
  if (desc === undefined) {
    return '';
  }
  const dot = desc.indexOf('.');
  return dot === -1 ? desc : desc.slice(dot + 1).trim();
}
