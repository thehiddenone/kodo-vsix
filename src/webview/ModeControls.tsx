import type { ThinkingFamily } from '../llm-registry-types';
import { styles } from './styles';
import { vscode } from './vscode';
import type { EditControl, CommandControl } from './types';
import { MenuGroup, MenuOption, frozenNote, useMenuPopup } from './MenuPrimitives';
import {
  COMMAND_GLYPH,
  COMMAND_NAME,
  COMMAND_ORDER,
  EDIT_DESC,
  EDIT_GLYPH,
  EDIT_NAME,
  EDIT_ORDER,
  MODE_DESC,
  MODE_GLYPH,
  THINKING_CAVEAT,
  THINKING_GLYPH,
  TOOL_DESC,
  tierDesc,
  tierName,
} from './sessionParamLabels';

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
  return (THINKING_CAVEAT[family] ?? '').trim();
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
      : thinkingTiers.map((tier) => {
          const label = tierName(family, tier);
          return { tier, label, glyph: THINKING_GLYPH[label] ?? '', desc: tierDesc(family, tier) };
        });

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
              glyph={MODE_GLYPH.interactive}
              label="Interactive"
              desc={MODE_DESC.interactive}
              selected={!autonomous}
              disabled={false}
              onSelect={() => vscode.postMessage({ type: 'mode_set', autonomous: false })}
            />
            <MenuOption
              glyph={MODE_GLYPH.autonomous}
              label="Autonomous"
              desc={MODE_DESC.autonomous}
              selected={autonomous}
              disabled={false}
              onSelect={() => vscode.postMessage({ type: 'mode_set', autonomous: true })}
            />
          </MenuGroup>
          <hr style={styles.sessionGroupDivider} />
          <MenuGroup title="Edit Control" note={_lockedNote(editCommandLocked, EDIT_NAME.allow_all)}>
            {EDIT_ORDER.map((value) => (
              <MenuOption
                key={value}
                glyph={EDIT_GLYPH[value]}
                label={EDIT_NAME[value]}
                desc={EDIT_DESC[value]}
                selected={editControl === value}
                disabled={editCommandLocked}
                onSelect={() => vscode.postMessage({ type: 'edit_control_set', editControl: value })}
              />
            ))}
          </MenuGroup>
          <hr style={styles.sessionGroupDivider} />
          <MenuGroup title="Tool Control" note={_lockedNote(editCommandLocked, COMMAND_NAME.permissive)}>
            {COMMAND_ORDER.map((value) => (
              <MenuOption
                key={value}
                glyph={COMMAND_GLYPH[value]}
                label={COMMAND_NAME[value]}
                desc={TOOL_DESC[value]}
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
                glyph={row.glyph}
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
