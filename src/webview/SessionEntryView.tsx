import { styles } from './styles';
import { vscode } from './vscode';
import type { SessionEntry, DiffLinkData, CheckpointData } from './types';
import { Markdown } from './markdown';
import { ThinkingBlock, CompactionBlock } from './streaming-blocks';
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
 * Inline "undo this change" control shown next to a file-mutating tool call's
 * header. Surgically reverts only the files this call touched (and discards any
 * later edits to those same files), leaving everything else untouched. Posts
 * 'checkpoint_undo' so the extension host forwards it to the server.
 */
function UndoChangeLink({ checkpoint }: { checkpoint: CheckpointData }) {
  const undo = () => {
    vscode.postMessage({ type: 'checkpoint_undo', root: checkpoint.root, sha: checkpoint.sha });
  };
  return (
    <span
      style={styles.undoChangeLink}
      onClick={undo}
      title="Undo only this change — restores the files this step touched to their state just before it (discarding any later edits to those same files). Itself undoable, so you can redo it afterwards."
    >
      ↩ undo this change
    </span>
  );
}

/**
 * "Rollback to this state" box shown below a file-mutating tool call's
 * parameters. Restores the whole project tree to its state right after this
 * call ran; a new checkpoint is recorded so rolling forward stays possible.
 * Posts 'checkpoint_rollback' for the extension host to forward to the server.
 */
function RollbackBox({ checkpoint }: { checkpoint: CheckpointData }) {
  const rollback = () => {
    vscode.postMessage({ type: 'checkpoint_rollback', root: checkpoint.root, sha: checkpoint.sha });
  };
  return (
    <div
      style={{ ...styles.toolCallBox, ...styles.toolCallBoxClickable, ...styles.rollbackBox }}
      onClick={rollback}
      title="Restore the entire project to its state right after this step ran. A new checkpoint is recorded, so you can still roll forward to a later state afterwards."
    >
      ⟲ Rollback to this state
    </div>
  );
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
            {entry.checkpoint !== null && <UndoChangeLink checkpoint={entry.checkpoint} />}
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
    case 'post_update':
      return <div style={styles.postUpdate}>{entry.content}</div>;
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
  }
}
