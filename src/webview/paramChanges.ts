/**
 * The change element shown right before a prompt (kodo doc/SESSION_LLM_BINDING.md
 * §4): what changed in the session's parameters since its previous prompt.
 * The server decides *which* parameters are listed; this module only turns
 * each row's raw values into display text, using the same names and glyphs as
 * the Session Parameters popup (sessionParamLabels.ts). Pure, so unit-tested.
 */

import type { ThinkingFamily } from '../llm-registry-types';
import {
  COMMAND_GLYPH,
  COMMAND_NAME,
  EDIT_GLYPH,
  EDIT_NAME,
  MODE_GLYPH,
  THINKING_GLYPH,
  tierName,
} from './sessionParamLabels';
import type { CommandControl, EditControl } from './types';

/** One row of a `session.params` event / `session_params` marker. */
export interface ParamChange {
  param: string;
  label: string;
  from: string | null;
  to: string | null;
  /** Display context, by key: `from_<k>`/`to_<k>` on the wire (e.g. `base_llm`, `display`). */
  fromExtra: Record<string, string>;
  toExtra: Record<string, string>;
}

/** One row as displayed. `from` is `''` on a session's first prompt. */
export interface ParamRow {
  label: string;
  from: string;
  to: string;
}

const _FIXED_LABELS: Record<string, string> = {
  llm: 'LLM',
  agent: 'Agent',
  mode: 'Mode',
  edit_control: 'Edit Control',
  command_control: 'Tool Control',
  thinking: 'Thinking',
  profile: 'Profile',
};

function _str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Parse the `changes` array off the wire; malformed rows are dropped. */
export function coerceParamChanges(raw: unknown): ParamChange[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ParamChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const fromExtra: Record<string, string> = {};
    const toExtra: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (key.startsWith('from_')) {
        fromExtra[key.slice('from_'.length)] = String(value);
      } else if (key.startsWith('to_')) {
        toExtra[key.slice('to_'.length)] = String(value);
      }
    }
    out.push({
      param: String(row.param ?? ''),
      label: String(row.label ?? ''),
      from: _str(row.from),
      to: _str(row.to),
      fromExtra,
      toExtra,
    });
  }
  return out;
}

function _modeText(value: string): string {
  return value === 'autonomous' ? `${MODE_GLYPH.autonomous} Autonomous` : `${MODE_GLYPH.interactive} Interactive`;
}

function _thinkingText(tier: string, family: ThinkingFamily | null): string {
  if (!tier) {
    return 'Off';
  }
  if (family === null) {
    return tier;
  }
  const name = tierName(family, tier);
  const glyph = THINKING_GLYPH[name];
  return glyph ? `${glyph} ${name}` : name;
}

function _valueText(
  change: ParamChange,
  value: string | null,
  extra: Record<string, string>,
  families: Record<string, ThinkingFamily>,
): string {
  if (value === null) {
    return 'not set';
  }
  switch (change.param) {
    case 'mode':
      return _modeText(value);
    case 'edit_control': {
      const name = EDIT_NAME[value as EditControl];
      return name ? `${EDIT_GLYPH[value as EditControl]} ${name}` : value;
    }
    case 'command_control': {
      const name = COMMAND_NAME[value as CommandControl];
      return name ? `${COMMAND_GLYPH[value as CommandControl]} ${name}` : value;
    }
    case 'thinking':
      return _thinkingText(value, families[extra.base_llm ?? ''] ?? null);
    default:
      return extra.display ?? value;
  }
}

/**
 * Display text for one row: its label, and its old and new values with the
 * popup's names and glyphs (thinking tiers named by their own family, so a
 * DeepSeek `max` reads "High"). A value that is not set reads "not set".
 *
 * @param first Whether the element is a session's first ("Started on …"),
 *   where no row has an old value worth showing.
 */
export function describeParamChange(
  change: ParamChange,
  families: Record<string, ThinkingFamily>,
  first: boolean,
): ParamRow {
  return {
    label: _FIXED_LABELS[change.param] ?? (change.label || change.param),
    from: first ? '' : _valueText(change, change.from, change.fromExtra, families),
    to: _valueText(change, change.to, change.toExtra, families),
  };
}

/**
 * The element's heading and the rows under it. A session's first prompt reads
 * "Started on <LLM>" and lists the non-default parameters under it (the LLM
 * row is the heading itself); every later element reads "Session parameters
 * changed" and lists each change, the LLM included, as "from → to".
 */
export function paramChangesView(
  changes: ParamChange[],
  families: Record<string, ThinkingFamily>,
  first: boolean,
): { title: string; rows: ParamRow[] } {
  if (first) {
    const llm = changes.find((c) => c.param === 'llm');
    return {
      title: llm?.to ? `Started on ${llm.to}` : 'Session started',
      rows: changes.filter((c) => c.param !== 'llm').map((c) => describeParamChange(c, families, true)),
    };
  }
  return {
    title: 'Session parameters changed',
    rows: changes.map((c) => describeParamChange(c, families, false)),
  };
}

/** What the header line under "Session name:" shows (kodo/doc/SESSION_LLM_BINDING.md D13). */
export interface SessionLineInput {
  bound: boolean;
  label: string;
  nextLabel: string;
  autonomous: boolean;
  editControl: EditControl;
  commandControl: CommandControl;
  thinkingLevel: string;
  thinkingFamily: ThinkingFamily | null;
}

/**
 * The header line: the session's LLM, then Mode, Edit Control, Tool Control
 * and Thinking with the Session Parameters popup's glyphs —
 * `LLM: Qwen3.6 27B Q4_K_XL · 💬 Interactive · Edit: 🧠 Smart · Tools: 🛡️ Defensive · Thinking: 🔥 High`.
 * An unbound session reads `LLM: not bound yet`; a bound session whose next
 * prompt will run on another LLM reads `LLM: <now> → <next> (next prompt)`.
 */
export function sessionParamsLine(input: SessionLineInput): string {
  let llm = input.bound ? input.label : 'not bound yet';
  if (input.bound && input.nextLabel) {
    llm = `${input.label} → ${input.nextLabel} (next prompt)`;
  }
  return [
    `LLM: ${llm}`,
    _modeText(input.autonomous ? 'autonomous' : 'interactive'),
    `Edit: ${EDIT_GLYPH[input.editControl]} ${EDIT_NAME[input.editControl]}`,
    `Tools: ${COMMAND_GLYPH[input.commandControl]} ${COMMAND_NAME[input.commandControl]}`,
    `Thinking: ${_thinkingText(input.thinkingLevel, input.thinkingFamily)}`,
  ].join(' · ');
}
