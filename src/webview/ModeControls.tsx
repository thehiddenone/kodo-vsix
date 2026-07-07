import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
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
    </div>
  );
}
