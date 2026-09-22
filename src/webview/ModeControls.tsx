import type { ThinkingFamily } from '../llm-registry-types';
import { styles } from './styles';
import { vscode } from './vscode';
import type { EditControl, CommandControl } from './types';
import { MenuGroup, MenuOption, frozenNote, useMenuPopup } from './MenuPrimitives';

/**
 * Description of what each Mode choice does. These are *prefix-free*: the
 * popup already prints the group name as a heading and the choice name as the
 * row's label, so a string here starts straight at the explanation. (They used
 * to read "Mode: Interactive — agents work alongside you…" because they were
 * the whole of a toggle's tooltip, with no heading above them.)
 */
const _MODE_DESC = {
  interactive: 'Agents work alongside you, asking questions before key decisions.',
  autonomous: 'Agents work on their own, making reasonable assumptions instead of pausing.',
};

/** Description of each Edit Control posture (prefix-free — see {@link _MODE_DESC}). */
const _EDIT_DESC: Record<EditControl, string> = {
  smart: 'Kōdo decides per edit whether to pause for your sign-off or apply it automatically.',
  review_all: 'Kōdo pauses for your sign-off on every edit.',
  allow_all: 'Kōdo applies edits without pausing.',
};

/** Description of each Tool Control posture (prefix-free — see {@link _MODE_DESC}). */
const _TOOL_DESC: Record<CommandControl, string> = {
  smart: 'Kōdo decides per tool action or shell command whether to ask for your approval or proceed automatically.',
  defensive: 'Kōdo asks you to review and approve all potentially unsafe tool actions and shell commands.',
  permissive: 'Kōdo allows tool actions and shell commands without asking.',
};

/** Display name of each Edit Control posture, as the popup rows label them. */
const _EDIT_NAME: Record<EditControl, string> = {
  smart: 'Smart',
  review_all: 'Review All',
  allow_all: 'Allow All',
};

/** Display name of each Tool Control posture, as the popup rows label them. */
const _COMMAND_NAME: Record<CommandControl, string> = {
  smart: 'Smart',
  defensive: 'Defensive',
  permissive: 'Permissive',
};

/** Row order within each single-choice group — default first, as before. */
const _EDIT_ORDER: EditControl[] = ['smart', 'review_all', 'allow_all'];
const _COMMAND_ORDER: CommandControl[] = ['smart', 'defensive', 'permissive'];

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
const _THINKING_CAVEAT: Partial<Record<ThinkingFamily, string>> = {
  openrouter_reasoning_effort: _OPENROUTER_THINKING_CAVEAT,
  kimi_reasoning_effort: _KIMI_THINKING_CAVEAT,
  bedrock_effort: _BEDROCK_THINKING_CAVEAT,
};

const _THINKING_DESC: Record<ThinkingFamily, Record<string, string>> = {
  qwen_reasoning_budget: _QWEN_THINKING_DESC,
  gpt_oss_reasoning_effort: _GPT_OSS_THINKING_DESC,
  qwen4exp_reasoning_effort: _QWEN4EXP_THINKING_DESC,
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
function _tierName(family: ThinkingFamily, tier: string): string {
  const label = tierLabel(family, tier);
  return label.startsWith('Thinking: ') ? label.slice('Thinking: '.length) : label;
}

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
function _tierDesc(family: ThinkingFamily, tier: string): string {
  const desc = _THINKING_DESC[family][tier];
  if (desc === undefined) {
    return '';
  }
  const dot = desc.indexOf('.');
  return dot === -1 ? desc : desc.slice(dot + 1).trim();
}

/**
 * The note printed under the Thinking heading: the unavailability line when the
 * group has no rows to offer, otherwise the family-wide caveat for the families
 * whose selected tier does not reach every model the vendor serves (OpenRouter,
 * Kimi, Bedrock). Empty string means no note.
 *
 * It is keyed on whether any row was actually built, not merely on
 * `family === null`: a known family that arrives with an empty tier list would
 * otherwise render a heading with nothing under it and no word of explanation.
 */
function _thinkingNote(family: ThinkingFamily | null, hasTiers: boolean): string {
  if (family === null || !hasTiers) {
    return 'This LLM does not have thinking mode.';
  }
  // The caveat strings are tooltip-shaped, i.e. prefixed with the newline that
  // separated them from the tier text; the note is its own line here.
  return (_THINKING_CAVEAT[family] ?? '').trim();
}

/**
 * The note printed under the Edit Control / Tool Control headings. Neither is
 * frozen per turn, but both are forced to a fixed posture while Autonomous is
 * in effect — the rows still show the user's own selection (which is what
 * comes back the moment Autonomous is cleared), so the note is what explains
 * why that selection is not the one in force.
 */
function _lockedNote(locked: boolean, lockedName: string): string {
  return locked ? `Locked to ${lockedName} while Autonomous mode is in effect.` : '';
}

interface ModeControlsProps {
  autonomous: boolean;
  effectiveAutonomous: boolean;
  editControl: EditControl;
  commandControl: CommandControl;
  /** True while Autonomous is in effect: Edit/Command are forced and locked. */
  editCommandLocked: boolean;
  /** Server-owned (doc/SESSIONS.md) — the active local model's current tier, or "". */
  thinkingLevel: string;
  /** Which thinking-tier family (if any) the active local model belongs to. */
  thinkingFamily: ThinkingFamily | null;
  /** Ordered tier slugs for `thinkingFamily`; [] when `thinkingFamily` is null. */
  thinkingTiers: string[];
  connected: boolean;
  /** True while a turn is in flight; gates the frozen groups' "queued" note. */
  running: boolean;
}

/**
 * The "Session Parameters" button and the popup it opens, holding the four
 * per-session single-choice groups (Mode, Edit Control, Tool Control,
 * Thinking). It replaced a stack of five cycling toggle buttons — the
 * groups, their values and the messages they post are unchanged, so there is no
 * protocol change; only the way you reach them is new. Agent split out into
 * its own button (`AgentButton.tsx`) once its catalog moved from a one-shot
 * `hello.ack` field to an on-demand fetch triggered by opening that button
 * specifically — see doc/WS_PROTOCOL.md §7.4g.
 *
 * Picking an option applies it immediately (exactly as clicking a toggle did)
 * and leaves the popup open, so several settings can be changed in one visit.
 * It closes on: a click anywhere outside it, Escape, or focus moving to another
 * widget.
 *
 * This renders only the button and its popup, NOT the composer's left column:
 * the column (`styles.sessionCol`) is App.tsx's, because the other buttons
 * beside this one — Agent and Sampling Parameters — are driven by state and
 * handlers that live there (or, for Agent, in `AgentButton.tsx`).
 */
export function ModeControls({
  autonomous,
  effectiveAutonomous,
  editControl,
  commandControl,
  editCommandLocked,
  thinkingLevel,
  thinkingFamily,
  thinkingTiers,
  connected,
  running,
}: ModeControlsProps) {
  const { open, setOpen, wrapRef, menuStyle } = useMenuPopup(connected);

  // Bound to a `const` before the null check so the narrowing survives into the
  // `.map` callback below — TypeScript drops a *parameter*'s narrowing inside a
  // closure, since a parameter could in principle be reassigned.
  const family: ThinkingFamily | null = thinkingFamily;
  const thinkingRows =
    family === null
      ? []
      : thinkingTiers.map((tier) => ({
          tier,
          label: _tierName(family, tier),
          desc: _tierDesc(family, tier),
        }));

  return (
    <div style={styles.sessionBtnWrap} ref={wrapRef}>
      <button
        type="button"
        style={connected ? styles.sessionBtn : { ...styles.sessionBtn, ...styles.sessionBtnDisabled }}
        disabled={!connected}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Session Parameters
      </button>
      {open && (
        <div style={menuStyle} role="menu" aria-label="Session settings">
          <MenuGroup
            title="Mode"
            note={frozenNote(
              running && autonomous !== effectiveAutonomous,
              effectiveAutonomous ? 'Autonomous' : 'Interactive',
            )}
          >
            <MenuOption
              label="Interactive"
              desc={_MODE_DESC.interactive}
              selected={!autonomous}
              disabled={false}
              onSelect={() => vscode.postMessage({ type: 'mode_set', autonomous: false })}
            />
            <MenuOption
              label="Autonomous"
              desc={_MODE_DESC.autonomous}
              selected={autonomous}
              disabled={false}
              onSelect={() => vscode.postMessage({ type: 'mode_set', autonomous: true })}
            />
          </MenuGroup>
          <hr style={styles.sessionGroupDivider} />
          <MenuGroup title="Edit Control" note={_lockedNote(editCommandLocked, _EDIT_NAME.allow_all)}>
            {_EDIT_ORDER.map((value) => (
              <MenuOption
                key={value}
                label={_EDIT_NAME[value]}
                desc={_EDIT_DESC[value]}
                selected={editControl === value}
                disabled={editCommandLocked}
                onSelect={() => vscode.postMessage({ type: 'edit_control_set', editControl: value })}
              />
            ))}
          </MenuGroup>
          <hr style={styles.sessionGroupDivider} />
          <MenuGroup title="Tool Control" note={_lockedNote(editCommandLocked, _COMMAND_NAME.permissive)}>
            {_COMMAND_ORDER.map((value) => (
              <MenuOption
                key={value}
                label={_COMMAND_NAME[value]}
                desc={_TOOL_DESC[value]}
                selected={commandControl === value}
                disabled={editCommandLocked}
                onSelect={() => vscode.postMessage({ type: 'command_control_set', commandControl: value })}
              />
            ))}
          </MenuGroup>
          <hr style={styles.sessionGroupDivider} />
          <MenuGroup title="Thinking" note={_thinkingNote(family, thinkingRows.length > 0)}>
            {thinkingRows.map((row) => (
              <MenuOption
                key={row.tier}
                label={row.label}
                desc={row.desc}
                selected={thinkingLevel === row.tier}
                disabled={false}
                onSelect={() =>
                  vscode.postMessage({ type: 'thinking_level_set', thinkingLevel: row.tier })
                }
              />
            ))}
          </MenuGroup>
      </div>
    )}
    </div>
  );
}
