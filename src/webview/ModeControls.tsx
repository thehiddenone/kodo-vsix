import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { tierLabel } from '../llm-registry-types';
import type { ThinkingFamily } from '../llm-registry-types';
import { styles } from './styles';
import { vscode } from './vscode';
import type { EditControl, CommandControl } from './types';
// Base, status-free description of what each toggle controls. The dynamic
// status line ("in effect" / "queued for the next prompt" / "locked by
// Autonomous") is appended on its own line at render time by the
// build*Tooltip helpers.
const _MODE_DESC = {
  interactive: 'Interactive — agents work alongside you, asking questions before key decisions.',
  autonomous: 'Autonomous — agents work on their own, making reasonable assumptions instead of pausing.',
  problem_solving: 'Problem Solving — one generalist agent tackles your request end to end.',
  guided: 'Guided Development — Kōdo walks through design, tests and implementation phases.',
};

/** Status-free description of Edit Control, one per posture. */
const _EDIT_DESC: Record<EditControl, string> = {
  smart: 'Edit Control — Smart. Kōdo decides per edit whether to pause for your sign-off or apply it automatically.',
  review_all: 'Edit Control — Review All. Kōdo pauses for your sign-off on every edit.',
  allow_all: 'Edit Control — Allow All. Kōdo applies edits without pausing.',
};

/** Status-free description of Tool Control, one per posture. */
const _TOOL_DESC: Record<CommandControl, string> = {
  smart: 'Tool Control — Smart. Kōdo decides per tool action or shell command whether to ask for your approval or proceed automatically.',
  defensive:
    'Tool Control — Defensive. Kōdo asks you to review and approve all potentially unsafe tool actions and shell commands.',
  permissive: 'Tool Control — Permissive. Kōdo allows tool actions and shell commands without asking.',
};

/** Button label per Edit Control posture. */
const _EDIT_LABEL: Record<EditControl, string> = {
  smart: '🧠 Edit Control: Smart',
  review_all: '🔍 Edit Control: Review All',
  allow_all: '✅ Edit Control: Allow All',
};

/** Short posture name used inside tooltips. */
const _EDIT_NAME: Record<EditControl, string> = {
  smart: 'Smart',
  review_all: 'Review All',
  allow_all: 'Allow All',
};

/** Click-cycle order, default-first: Smart → Review All → Allow All → Smart. */
const _EDIT_NEXT: Record<EditControl, EditControl> = {
  smart: 'review_all',
  review_all: 'allow_all',
  allow_all: 'smart',
};

/** Button label per Tool Control posture. */
const _COMMAND_LABEL: Record<CommandControl, string> = {
  smart: '🧠 Tool Control: Smart',
  defensive: '🛡️ Tool Control: Defensive',
  permissive: '🔓 Tool Control: Permissive',
};

/** Short posture name used inside tooltips. */
const _COMMAND_NAME: Record<CommandControl, string> = {
  smart: 'Smart',
  defensive: 'Defensive',
  permissive: 'Permissive',
};

/** Click-cycle order, default-first: Smart → Defensive → Permissive → Smart. */
const _COMMAND_NEXT: Record<CommandControl, CommandControl> = {
  smart: 'defensive',
  defensive: 'permissive',
  permissive: 'smart',
};

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
  huge: 'Thinking: Huge. A very large reasoning budget — reserved for the hardest problems, where speed matters least.',
  unlimited: 'Thinking: Unlimited. No cap on reasoning — Kōdo thinks for as long as it judges necessary.',
};

const _GPT_OSS_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. Minimal reasoning effort — fastest replies.',
  medium: "Thinking: Medium. The model's default reasoning effort — balances speed and depth.",
  high: 'Thinking: High. Maximum reasoning effort — the most careful deliberation, at the cost of speed.',
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
  xhigh: "Thinking: Extra high. Qwen's own default — thorough analysis for demanding problems, at the cost of speed and tokens.",
};

const _DEEPSEEK_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. A small reasoning effort — fastest and cheapest replies.',
  high: "Thinking: High. DeepSeek's own default reasoning effort — thorough deliberation on demanding problems.",
  max: 'Thinking: Max. A distinct extended thinking mode, not just more of the same — DeepSeek recommends it for demanding agent work, at a real cost in tokens.',
};

const _KIMI_THINKING_DESC: Record<string, string> = {
  low: 'Thinking: Low. A small reasoning effort — the one to pick when K3 is reasoning for too long.',
  high: 'Thinking: High. A large reasoning effort — careful deliberation on demanding problems, at the cost of speed.',
  max: "Thinking: Max. Kimi's own default — the deepest reasoning, for the hardest problems.",
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

/** Family -> the caveat appended to every one of its tier tooltips, for the
 *  families where the selected tier does not reach every model the vendor
 *  serves. Absent means no caveat. */
const _THINKING_CAVEAT: Partial<Record<ThinkingFamily, string>> = {
  openrouter_reasoning_effort: _OPENROUTER_THINKING_CAVEAT,
  kimi_reasoning_effort: _KIMI_THINKING_CAVEAT,
};

const _THINKING_DESC: Record<ThinkingFamily, Record<string, string>> = {
  qwen_reasoning_budget: _QWEN_THINKING_DESC,
  gpt_oss_reasoning_effort: _GPT_OSS_THINKING_DESC,
  anthropic_effort: _ANTHROPIC_THINKING_DESC,
  openai_reasoning_effort: _OPENAI_THINKING_DESC,
  meta_reasoning_effort: _META_THINKING_DESC,
  google_thinking_level: _GOOGLE_THINKING_DESC,
  alibaba_reasoning_effort: _ALIBABA_THINKING_DESC,
  deepseek_reasoning_effort: _DEEPSEEK_THINKING_DESC,
  kimi_reasoning_effort: _KIMI_THINKING_DESC,
  openrouter_reasoning_effort: _OPENROUTER_THINKING_DESC,
};

/** Tooltip for a tier, keyed by family — a full table per family rather than a
 *  default one, since the same tier slug carries a genuinely different meaning
 *  in each: "high" is a token budget on a local Qwen, Claude's own default, and
 *  the *top* of Gemini's ladder. Falls back to a plain label for an
 *  unrecognised tier (should not happen — the tier list comes straight from
 *  the server's `thinking_families` payload, and a family that has arrived
 *  before this build knew about it is coerced to null upstream). */
function _thinkingTierDesc(family: ThinkingFamily, tier: string): string {
  const desc = _THINKING_DESC[family][tier] ?? `Thinking: ${tierLabel(tier)}.`;
  return desc + (_THINKING_CAVEAT[family] ?? '');
}

/** The next tier in click-cycle order, wrapping — falls back to the first
 *  tier if the current value isn't (or is no longer) one of them. */
function _nextThinkingTier(tiers: string[], current: string): string {
  if (tiers.length === 0) {
    return '';
  }
  const idx = tiers.indexOf(current);
  return tiers[(idx + 1 + tiers.length) % tiers.length];
}

/**
 * Tooltip for the two *frozen* toggles (workflow, autonomous): the description
 * plus a status line. The effective value only changes when a new turn starts,
 * so while a turn is running and the user's selection differs from the frozen
 * effective value the toggle is "queued for the next prompt"; otherwise it is
 * "in effect". When idle a flip takes effect immediately, so it reads as in
 * effect.
 *
 * @param desc Status-free description of the selected position.
 * @param effectiveName Human name of the value the in-flight turn is using.
 * @param pending True when running and the selection diverges from effective.
 */
function buildModeTooltip(desc: string, effectiveName: string, pending: boolean): string {
  return pending
    ? `${desc}\nWill be applied to the next prompt, current mode: ${effectiveName}.`
    : `${desc}\nThis mode is in effect.`;
}

/**
 * Tooltip for the two *never-frozen* toggles (Edit Control/Tool Control). They
 * are locked to a forced posture while Autonomous mode is in effect; otherwise
 * they apply immediately (no per-turn freeze).
 *
 * @param desc Status-free description of the selected posture.
 * @param locked True while Autonomous mode is in effect.
 * @param lockedName The forced posture name shown when locked.
 */
function buildLockTooltip(desc: string, locked: boolean, lockedName: string): string {
  return locked
    ? `${desc}\nLocked to ${lockedName} while Autonomous mode is in effect.`
    : `${desc}\nThis setting is in effect.`;
}

/**
 * Custom hover tooltip. Native `title` is unreliable in VS Code webviews (no
 * tooltip on disabled buttons, inconsistent timing), so the ⓘ marker renders
 * its own positioned bubble. Shown above the trigger to avoid clipping at the
 * panel footer where the mode bar lives.
 */
function Tooltip({
  text,
  align = 'right',
  children,
}: {
  text: string;
  /** Side the bubble opens toward: 'right' (default) anchors it to the ⓘ's
   *  right edge and grows leftward; 'left' anchors left and grows rightward so
   *  the leftmost toggle's bubble stays inside the WebView. */
  align?: 'left' | 'right';
  children: ComponentChildren;
}) {
  const [show, setShow] = useState(false);
  const boxStyle =
    align === 'left' ? { ...styles.tooltipBox, ...styles.tooltipBoxLeft } : styles.tooltipBox;
  return (
    <span
      style={styles.tooltipWrap}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={boxStyle} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * One toggle cell: the cycling button plus a trailing ⓘ marker that owns the
 * tooltip (the button itself has none — hovering ⓘ is how you read what the
 * toggle does, which also works while the button is disabled/locked).
 */
function ModeButton({
  label,
  tip,
  disabled,
  onClick,
  tipAlign,
}: {
  label: string;
  tip: string;
  disabled: boolean;
  onClick: () => void;
  /** Direction the tooltip opens; pass 'left' for the leftmost toggle. */
  tipAlign?: 'left' | 'right';
}) {
  return (
    <span style={styles.modeBtnWrap}>
      <button
        style={disabled ? { ...styles.modeBtn, ...styles.modeBtnDisabled } : styles.modeBtn}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
      <Tooltip text={tip} align={tipAlign}>
        <span style={styles.modeInfo} role="img" aria-label="info">
          ⓘ
        </span>
      </Tooltip>
    </span>
  );
}

interface ModeControlsProps {
  autonomous: boolean;
  effectiveAutonomous: boolean;
  workflowMode: 'guided' | 'problem_solving';
  effectiveWorkflowMode: 'guided' | 'problem_solving';
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
  /** True while a turn is in flight; gates the frozen toggles' "queued" status. */
  running: boolean;
}

export function ModeControls({
  autonomous,
  effectiveAutonomous,
  workflowMode,
  effectiveWorkflowMode,
  editControl,
  commandControl,
  editCommandLocked,
  thinkingLevel,
  thinkingFamily,
  thinkingTiers,
  connected,
  running,
}: ModeControlsProps) {
  const isPS = workflowMode === 'problem_solving';

  const wfTip = buildModeTooltip(
    isPS ? _MODE_DESC.problem_solving : _MODE_DESC.guided,
    effectiveWorkflowMode === 'problem_solving' ? 'Problem Solving' : 'Guided Development',
    running && workflowMode !== effectiveWorkflowMode,
  );
  const autoTip = buildModeTooltip(
    autonomous ? _MODE_DESC.autonomous : _MODE_DESC.interactive,
    effectiveAutonomous ? 'Autonomous' : 'Interactive',
    running && autonomous !== effectiveAutonomous,
  );
  const editTip = buildLockTooltip(_EDIT_DESC[editControl], editCommandLocked, _EDIT_NAME.allow_all);
  const commandTip = buildLockTooltip(
    _TOOL_DESC[commandControl],
    editCommandLocked,
    _COMMAND_NAME.permissive,
  );
  const thinkingDisabled = !connected || thinkingFamily === null;
  const thinkingLabel = thinkingFamily === null ? '💭 Thinking: N/A' : `💭 Thinking: ${tierLabel(thinkingLevel)}`;
  const thinkingTip =
    thinkingFamily === null
      ? 'This LLM does not have thinking mode.'
      : _thinkingTierDesc(thinkingFamily, thinkingLevel);

  return (
    <div style={styles.modeControls}>
      <ModeButton
        label={isPS ? '💡 Problem Solving' : '🧩 Guided Development'}
        tip={wfTip}
        tipAlign="left"
        disabled={!connected}
        onClick={() => vscode.postMessage({ type: 'workflow_set', mode: isPS ? 'guided' : 'problem_solving' })}
      />
      <ModeButton
        label={autonomous ? '⚡ Autonomous' : '💬 Interactive'}
        tip={autoTip}
        disabled={!connected}
        onClick={() => vscode.postMessage({ type: 'mode_set', autonomous: !autonomous })}
      />
      <ModeButton
        label={_EDIT_LABEL[editControl]}
        tip={editTip}
        disabled={!connected || editCommandLocked}
        onClick={() => vscode.postMessage({ type: 'edit_control_set', editControl: _EDIT_NEXT[editControl] })}
      />
      <ModeButton
        label={_COMMAND_LABEL[commandControl]}
        tip={commandTip}
        disabled={!connected || editCommandLocked}
        onClick={() => vscode.postMessage({ type: 'command_control_set', commandControl: _COMMAND_NEXT[commandControl] })}
      />
      <ModeButton
        label={thinkingLabel}
        tip={thinkingTip}
        disabled={thinkingDisabled}
        onClick={() =>
          vscode.postMessage({
            type: 'thinking_level_set',
            thinkingLevel: _nextThinkingTier(thinkingTiers, thinkingLevel),
          })
        }
      />
    </div>
  );
}
