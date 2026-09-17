import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ThinkingFamily } from '../llm-registry-types';
import { styles } from './styles';
import { vscode } from './vscode';
import type { AgentRow, EditControl, CommandControl } from './types';

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
 * The note printed under the Agent/Mode headings. Both are frozen for the
 * duration of a running turn: while a turn is in flight and the user's
 * selection differs from the value that turn is actually using, the change is
 * queued for the next prompt. Empty string when selection and effect agree (or
 * nothing is running), which is the overwhelmingly common case.
 */
/** A top-level agent's picker label, falling back to its bare name.
 *
 *  The fallback is reachable for an agent the server accepted but left out of
 *  the catalog — `judge`, which is registered but not selectable. Showing the
 *  name beats showing nothing, or showing the wrong agent's label. */
function _agentLabel(agents: AgentRow[], name: string): string {
  return agents.find((a) => a.name === name)?.label ?? name;
}

function _frozenNote(pending: boolean, effectiveName: string): string {
  return pending ? `Queued for the next prompt — currently ${effectiveName}.` : '';
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

/** One single-choice group: its heading, an optional status/lock note, and the
 *  option rows. Groups are separated by a rule, drawn by the caller.
 *
 *  The note sits to the *right of the title, on the same line*. Notes come and
 *  go with session state — a turn starting freezes Agent/Mode, Autonomous locks
 *  Edit/Tool Control, a model switch can withdraw Thinking — so giving one its
 *  own line would grow and shrink the group by a line each time, shifting every
 *  row below it while the menu is open under the user's pointer. Sharing the
 *  heading's line makes appearing and disappearing free. */
function MenuGroup({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ComponentChildren;
}) {
  return (
    <div role="group" aria-label={title}>
      <div style={styles.sessionGroupHeader}>
        <span style={styles.sessionGroupTitle}>{title}</span>
        {note !== '' && <span style={styles.sessionGroupNote}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * One radio row: the ◉/○ marker, the option's name, and its description
 * underneath. Disabled rows still render their marker, so a locked group shows
 * what is selected while refusing to change it.
 *
 * Hover highlighting is tracked in state rather than left to `:hover`, because
 * VS Code webviews style everything here inline — the same reason
 * FooterButton fakes `:active`.
 */
function MenuOption({
  label,
  desc,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  desc: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const style = {
    ...styles.sessionOption,
    ...(disabled ? styles.sessionOptionDisabled : {}),
    ...(hover && !disabled ? styles.sessionOptionHover : {}),
  };
  return (
    <button
      type="button"
      style={style}
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={styles.sessionRadio} aria-hidden="true">
        {selected ? '◉' : '○'}
      </span>
      <span>
        <span style={styles.sessionOptionLabel}>{label}</span>
        {desc !== '' && <div style={styles.sessionOptionDesc}>{desc}</div>}
      </span>
    </button>
  );
}

interface ModeControlsProps {
  autonomous: boolean;
  effectiveAutonomous: boolean;
  /** The selected top-level agent's name, and the one the in-flight prompt
   *  is actually running under. */
  topAgent: string;
  effectiveTopAgent: string;
  /** Selectable agents in picker order, straight from the server. */
  agents: AgentRow[];
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
 * The "Session Parameters" button and the popup it opens, holding the five
 * per-session single-choice groups (Agent, Mode, Edit Control, Tool Control,
 * Thinking). It replaced a stack of five cycling toggle buttons — the
 * groups, their values and the messages they post are unchanged, so there is no
 * protocol change; only the way you reach them is new.
 *
 * Picking an option applies it immediately (exactly as clicking a toggle did)
 * and leaves the popup open, so several settings can be changed in one visit.
 * It closes on: a click anywhere outside it, Escape, or focus moving to another
 * widget.
 *
 * This renders only the button and its popup, NOT the composer's left column:
 * the column (`styles.sessionCol`) is App.tsx's, because the two buttons
 * beneath this one — Sampling Parameters and Kōdo Settings — are driven by
 * state and handlers that live there.
 */
export function ModeControls({
  autonomous,
  effectiveAutonomous,
  topAgent,
  effectiveTopAgent,
  agents,
  editControl,
  commandControl,
  editCommandLocked,
  thinkingLevel,
  thinkingFamily,
  thinkingTiers,
  connected,
  running,
}: ModeControlsProps) {
  const [open, setOpen] = useState(false);
  // Space above the button, measured on open: the popup grows upward out of the
  // bottom of the WebView, so on a short panel it must scroll internally rather
  // than run off the top. Null until measured (the first paint of a freshly
  // opened menu), which is also what a `null` maxHeight renders as: uncapped.
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  // Wraps button + popup; every close rule below is "did this happen outside
  // *this* element?".
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setMaxHeight(null);
      return;
    }
    const el = wrapRef.current;
    if (el === null) {
      return;
    }
    // The popup's bottom edge sits on the button's top edge, so the room it has
    // is everything above that, less a small margin off the top of the view.
    setMaxHeight(Math.max(120, el.getBoundingClientRect().top - 12));
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (target: EventTarget | null): boolean =>
      wrapRef.current === null || !(target instanceof Node) || !wrapRef.current.contains(target);
    // mousedown, not click: the menu should be gone by the time the click lands
    // on whatever was pressed, and a press that drags out of the popup still
    // counts as dismissing it.
    const onMouseDown = (e: MouseEvent) => {
      if (outside(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    // Focus moving to any other widget (the prompt textarea, a footer button,
    // anything outside the popup) dismisses it too.
    const onFocusIn = (e: FocusEvent) => {
      if (outside(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  // A disconnected session can change nothing, so the button refuses to open —
  // and closes an open popup if the connection drops under it.
  useEffect(() => {
    if (!connected) {
      setOpen(false);
    }
  }, [connected]);

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
  const menuStyle =
    maxHeight === null ? styles.sessionMenu : { ...styles.sessionMenu, maxHeight: `${maxHeight}px` };

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
            title="Agent"
            note={_frozenNote(running && topAgent !== effectiveTopAgent, _agentLabel(agents, effectiveTopAgent))}
          >
            {agents.map((agent) => (
              <MenuOption
                key={agent.name}
                label={agent.label}
                desc={agent.description}
                selected={agent.name === topAgent}
                disabled={false}
                onSelect={() => vscode.postMessage({ type: 'agent_set', name: agent.name })}
              />
            ))}
          </MenuGroup>
          <hr style={styles.sessionGroupDivider} />
          <MenuGroup
            title="Mode"
            note={_frozenNote(
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
