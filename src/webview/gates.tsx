import { useRef, useState } from 'preact/hooks';
import { styles } from './styles';
import { vscode } from './vscode';
import type { GateData } from './types';

interface ApprovalGateProps {
  gate: GateData;
  /** `artifactPath` names the member file the user had selected when they
   *  responded, so a rejection can be anchored to it; empty for a decision
   *  about the set as a whole. */
  onRespond: (action: string, feedback: string, artifactPath: string) => void;
}

/** The last path segment — what identifies a file at a glance in a list where
 *  every entry shares a project and usually a directory. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function ApprovalGate({ gate, onRespond }: ApprovalGateProps) {
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  // Which member the feedback is about. Null means the set as a whole, which
  // is the right default: most objections are not about one file.
  const [selected, setSelected] = useState<string | null>(null);
  const multi = gate.paths.length > 1;

  function handleAgree() {
    // One decision settles every file. Accepting them one at a time would
    // permit exactly the half-accepted, unbuildable state a work product
    // exists to prevent.
    onRespond('agree', '', '');
  }

  function handleFeedback() {
    const text = feedbackRef.current?.value.trim() ?? '';
    if (!text) return;
    onRespond('feedback', text, selected ?? '');
    if (feedbackRef.current) feedbackRef.current.value = '';
  }

  function handleFeedbackKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFeedback();
    }
  }

  return (
    <div style={styles.gateCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>{gate.gateType.toUpperCase()}</span>
        <span style={styles.gateTitle}>
          {multi ? `Approval Gate — ${gate.paths.length} files` : 'Approval Gate'}
        </span>
      </div>
      {gate.summary && <div style={styles.gateSummary}>{gate.summary}</div>}
      {gate.paths.length > 0 && (
        <div style={styles.gateArtifact}>
          {multi && (
            <div style={styles.gateFilesHint}>
              These were written as one change and are accepted together. Select a file to
              aim your feedback at it.
            </div>
          )}
          {gate.paths.map((path) => {
            const isSelected = selected === path;
            return (
              <div key={path} style={styles.gateFileRow}>
                <button
                  style={styles.openBtn}
                  title={path}
                  onClick={() => vscode.postMessage({ type: 'open_file', path })}
                >
                  Open {multi ? basename(path) : path}
                </button>
                {multi && (
                  <button
                    style={isSelected ? styles.gateFileSelected : styles.gateFileSelect}
                    aria-pressed={isSelected}
                    onClick={() => setSelected(isSelected ? null : path)}
                  >
                    {isSelected ? '● Feedback targets this' : '○ Aim feedback here'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={styles.gateActions}>
        <div style={styles.gateTopRow}>
          <button style={styles.agreeBtn} onClick={handleAgree}>
            {multi ? `✓ Accept all ${gate.paths.length}` : '✓ Agree'}
          </button>
          <button style={styles.stopBtn} onClick={() => onRespond('stop', '', '')}>
            ◼ Stop
          </button>
        </div>
        <div style={styles.feedbackRow}>
          <textarea
            ref={feedbackRef}
            style={styles.feedbackInput}
            placeholder={
              selected ? `Feedback on ${basename(selected)} (Enter to send)…` : 'Feedback (Enter to send)…'
            }
            rows={2}
            onKeyDown={handleFeedbackKey}
          />
          <button style={styles.feedbackBtn} onClick={handleFeedback}>
            ↵ Feedback
          </button>
        </div>
      </div>
    </div>
  );
}

// The former QuestionGate (a transient prompt-area widget) was replaced by the
// in-feed AskUserPanel — see AskUserPanel.tsx.
