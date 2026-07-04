import { styles } from './styles';
import { vscode } from './vscode';
import type { SessionEntry, DiffLinkData, CheckpointData } from './types';
import { Markdown } from './markdown';
import { ThinkingBlock, CompactionBlock } from './StreamingBlocks';
import { RunCommandProgress } from './indicators';
import { completionLabel } from './format';
/** Crop a `visible` parameter value to at most 3 lines / 200 characters. */
function cropVisibleValue(value: string): string {
  const lines = value.split('\n');
  let text = lines.slice(0, 3).join('\n');
  if (lines.length > 3) {
    text += '\n…';
  }
  if (text.length > 200) {
    text = text.slice(0, 200) + '…';
  }
  return text;
}

/**
 * The clickable detail box shown beneath a tool-call one-liner. Renders the
 * customer-visible parameters as a two-column table (`always` in full,
 * `visible` cropped); clicking opens the persisted Markdown doc with the full
 * input and output.
 */
function ToolCallDetail({ entry }: { entry: Extract<SessionEntry, { type: 'tool_call' }> }) {
  if (entry.rows.length === 0) {
    return null;
  }
  const clickable = entry.detailFile !== null;
  const openDoc = () => {
    if (entry.detailFile !== null) {
      vscode.postMessage({ type: 'open_file', path: entry.detailFile });
    }
  };
  return (
    <div
      style={{ ...styles.toolCallBox, ...(clickable ? styles.toolCallBoxClickable : {}) }}
      onClick={clickable ? openDoc : undefined}
      title={clickable ? 'Open the full tool input & output' : undefined}
    >
      {entry.schemaCompliance === false && (
        <div style={styles.toolCallWarn}>
          ⚠️ Output did not match the tool&apos;s schema and was repaired.
        </div>
      )}
      <table style={styles.toolCallTable}>
        <tbody>
          {entry.rows.map((r, i) => (
            <tr key={i}>
              <td style={styles.toolCallParamName}>{r.name}</td>
              <td style={styles.toolCallParamValue}>
                {r.visibility === 'always' ? r.value : cropVisibleValue(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Clickable rounded-box link offering a before/after diff for a tool call
 * (e.g. edit_file). Rendered between the standard tool name/description line
 * and the parameters detail box. Posts 'open_diff' so the extension host can
 * open it via the standard `vscode.diff` command.
 */
function DiffLink({ diff }: { diff: DiffLinkData }) {
  const openDiff = () => {
    vscode.postMessage({ type: 'open_diff', prevPath: diff.prevPath, newPath: diff.newPath, label: diff.label });
  };
  return (
    <div
      style={{ ...styles.toolCallBox, ...styles.toolCallBoxClickable, ...styles.diffLinkBox }}
      onClick={openDiff}
      title="Open a diff view comparing the file before and after this change"
    >
      Click here to open a diff view of {diff.label}
    </div>
  );
}

/**
 * Inline "undo this change" / "re-do this change" toggle shown at the right
 * edge of a file-mutating tool call's header. Undo surgically reverts only
 * the files this call touched (discarding later edits to those same files);
 * re-do re-applies them. Hidden once the root has rolled back past this
 * entry (`index > currentIndex`) — its files aren't even checked out right
 * now, so neither action makes sense. Posts 'checkpoint_undo'/'checkpoint_redo'
 * so the extension host forwards it to the server.
 */
function UndoChangeLink({ checkpoint }: { checkpoint: CheckpointData }) {
  if (checkpoint.index > checkpoint.currentIndex) {
    return null;
  }
  const post = () => {
    vscode.postMessage({
      type: checkpoint.undone ? 'checkpoint_redo' : 'checkpoint_undo',
      root: checkpoint.root,
      sha: checkpoint.sha,
    });
  };
  return checkpoint.undone ? (
    <span
      style={styles.undoChangeLink}
      onClick={post}
      title="Re-do this change — re-applies the files this step touched to their state right after it ran (discarding later edits to those same files)."
    >
      ↻ re-do this change
    </span>
  ) : (
    <span
      style={styles.undoChangeLink}
      onClick={post}
      title="Undo only this change — restores the files this step touched to their state just before it (discarding any later edits to those same files). Itself undoable, so you can redo it afterwards."
    >
      ↺ undo this change
    </span>
  );
}

/**
 * "Rollback to this state" / "Roll forward to this state" toggle shown below
 * a file-mutating tool call's parameters, docked to the right edge (like the
 * undo/redo link above it) instead of the old full-width box. Moves the whole
 * project tree directly to this checkpoint (rollback if it's behind the
 * current state, roll-forward if ahead) by repointing the mirror's branch —
 * never a detached HEAD, since any orphaned tip is preserved on a
 * `rollback_<ts>` branch. Hidden when this entry already *is* the current
 * state. Posts 'checkpoint_rollback'/'checkpoint_roll_forward'; the extension
 * host asks for confirmation via a native modal before forwarding the
 * request to the server (see `_confirmCheckpointMove` in session-controller.ts).
 */
function RollbackBox({ checkpoint }: { checkpoint: CheckpointData }) {
  if (checkpoint.index === checkpoint.currentIndex) {
    return null;
  }
  const isRollback = checkpoint.index < checkpoint.currentIndex;
  const post = () => {
    vscode.postMessage({
      type: isRollback ? 'checkpoint_rollback' : 'checkpoint_roll_forward',
      root: checkpoint.root,
      sha: checkpoint.sha,
    });
  };
  return (
    <div style={styles.rollbackRow}>
      <span
        style={styles.rollbackLink}
        onClick={post}
        title={
          isRollback
            ? 'Restore the entire project to its state right after this step ran. Nothing is lost — you can roll forward again afterwards.'
            : 'Move the entire project forward to its state right after this step ran.'
        }
      >
        {isRollback ? (
          <span style={styles.rollbackIcon}>⎌</span>
        ) : (
          <span style={styles.rollforwardIcon}>⎌</span>
        )}
        {isRollback ? 'Rollback to this state' : 'Roll forward to this state'}
      </span>
    </div>
  );
}

/**
 * "open this file" link shown to the left of "undo this change" on a
 * file-mutating tool call's header row. Only rendered for calls that leave
 * behind an openable file: `edit_file`, and `filesystem`'s `create_file` /
 * `copy_file` / `move_file` operations (never its directory ops, which have
 * nothing an editor tab can open, and never `delete_file`/`delete_dir`, whose
 * target no longer exists). Posts 'open_file' so the extension host opens it
 * via `vscode.open`, resolving relative paths against the project root.
 */
function OpenFileLink({ path }: { path: string }) {
  const open = () => vscode.postMessage({ type: 'open_file', path });
  return (
    <span style={styles.openFileLink} onClick={open} title="Open this file in the editor">
      📂 open this file
    </span>
  );
}

/**
 * Resolves the file path a tool call left behind for {@link OpenFileLink}, or
 * null if this call has no openable file (still pending, a directory op, or a
 * delete). Reads projected detail rows rather than raw tool I/O, matching
 * every other customer-visible rendering in this file.
 */
function openablePath(entry: Extract<SessionEntry, { type: 'tool_call' }>): string | null {
  const outputRow = (name: string) => entry.rows.find((r) => r.source === 'output' && r.name === name)?.value ?? null;
  if (entry.toolName === 'edit_file') {
    return outputRow('path');
  }
  if (entry.toolName === 'filesystem') {
    const operation = entry.rows.find((r) => r.name === 'operation')?.value;
    if (operation === 'create_file') {
      return outputRow('path');
    }
    if (operation === 'copy_file' || operation === 'move_file') {
      return outputRow('destination');
    }
  }
  return null;
}
interface SessionEntryViewProps {
  entry: SessionEntry;
}

export function SessionEntryView({ entry }: SessionEntryViewProps) {
  switch (entry.type) {
    case 'user_message':
      return (
        <div style={styles.userPrompt}>
          <div style={styles.userPromptText}>{entry.content}</div>
          {entry.attachments.length > 0 && (
            <div style={styles.userPromptAttachments}>
              {entry.attachments.map((a, i) => (
                <div
                  key={i}
                  style={styles.sentAttachChip}
                  title={`Open ${a.path}`}
                  role="button"
                  onClick={() => vscode.postMessage({ type: 'open_file', path: a.path })}
                >
                  <span style={styles.sentAttachIcon}>📄</span>
                  <span style={styles.attachChipName}>{a.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    case 'assistant_response':
      return <div style={styles.agentTokens}><Markdown content={entry.content} /></div>;
    case 'status_response': {
      const mins = Math.floor(entry.durationMs / 60000);
      const secs = Math.round((entry.durationMs % 60000) / 1000);
      const timeStr = mins > 0 ? `${mins} min ${secs} seconds` : `${secs} seconds`;
      return (
        <div style={styles.statusResponse}>
          {'Kodo responded in '}
          {timeStr}
          {`, ${entry.inputTokens} tokens sent, ${entry.outputTokens} tokens received, context window size ${entry.contextTokens}.`}
        </div>
      );
    }
    case 'thinking_block':
      return <ThinkingBlock content={entry.content} isActive={false} durationMs={entry.durationMs} />;
    case 'tool_call': {
      // The result hasn't arrived until the detail event fills these in.
      const resultArrived =
        entry.rows.length > 0 || entry.detailFile !== null || entry.schemaCompliance !== null;
      const showProgress =
        entry.toolName === 'run_command' &&
        entry.startedAt !== null &&
        entry.timeoutSeconds !== null &&
        !resultArrived;
      const openPath = openablePath(entry);
      return (
        <div>
          {entry.toolgenDurationMs !== null && (
            <div style={styles.toolgenDone}>
              {completionLabel(`Generated content for ${entry.toolName}`, entry.toolgenChars ?? 0, entry.toolgenDurationMs)}
            </div>
          )}
          <div style={styles.toolCall}>
            {entry.success === true && <span style={styles.toolCallOk}>{'✅ '}</span>}
            {entry.success === false && <span style={styles.toolCallFail}>{'⚠️ '}</span>}
            <span style={styles.toolCallName}>
              {entry.toolName}
            </span>
            {entry.description && (
              <span style={styles.toolCallDesc}>{' — '}{entry.description}</span>
            )}
            {(openPath !== null || entry.checkpoint !== null) && (
              <span style={styles.toolCallActions}>
                {openPath !== null && <OpenFileLink path={openPath} />}
                {entry.checkpoint !== null && <UndoChangeLink checkpoint={entry.checkpoint} />}
              </span>
            )}
          </div>
          {showProgress && (
            <RunCommandProgress timeoutSeconds={entry.timeoutSeconds!} startedAt={entry.startedAt!} />
          )}
          {entry.diff !== null && <DiffLink diff={entry.diff} />}
          <ToolCallDetail entry={entry} />
          {entry.checkpoint !== null && <RollbackBox checkpoint={entry.checkpoint} />}
        </div>
      );
    }
    case 'subsession_divider': {
      // Render the takeover/handback notices as kodo callouts so they read like
      // the agent's own one-way notifications: <kodo_info> opening the delegation,
      // <kodo> on a clean finish, and <kodo_crit> when the sub-agent failed.
      if (entry.phase === 'start') {
        return <Markdown content={`<kodo_info>Delegating the task to **${entry.displayName}** subagent</kodo_info>`} />;
      }
      const tag = entry.failed ? 'kodo_crit' : 'kodo';
      const label = entry.failed
        ? `**${entry.displayName}** subagent failed to complete the task.`
        : `**${entry.displayName}** subagent has finished working on the task.`;
      return <Markdown content={`<${tag}>${label}</${tag}>`} />;
    }
    case 'subagent_task':
      return (
        <div style={styles.subagentTask}>
          <div style={styles.subagentTaskLabel}>Task brief</div>
          <div style={styles.subagentTaskText}><Markdown content={entry.content} /></div>
        </div>
      );
    case 'compaction_divider':
      return (
        <CompactionBlock
          summary={entry.summary}
          tokensBefore={entry.tokensBefore}
          tokensAfter={entry.tokensAfter}
        />
      );
    case 'ask_user':
      // Rendered by App.tsx as an interactive <AskUserPanel> (it needs the
      // live pendingQuestion and dispatch); never reached from the feed map.
      return null;
    case 'interrupted':
      return (
        <Markdown content="<kodo_crit>Interrupted by user — this turn was stopped before it finished, so any in-progress response or tool call may be incomplete.</kodo_crit>" />
      );
  }
}
