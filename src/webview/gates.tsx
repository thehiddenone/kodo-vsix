import { useRef } from 'preact/hooks';
import { styles } from './styles';
import { vscode } from './vscode';
import type { GateData, QuestionData } from './types';
interface ApprovalGateProps {
  gate: GateData;
  onRespond: (action: string, feedback: string) => void;
}

export function ApprovalGate({ gate, onRespond }: ApprovalGateProps) {
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  function handleAgree() {
    onRespond('agree', '');
  }

  function handleFeedback() {
    const text = feedbackRef.current?.value.trim() ?? '';
    if (!text) return;
    onRespond('feedback', text);
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
        <span style={styles.gateTitle}>Approval Gate</span>
      </div>
      {gate.summary && <div style={styles.gateSummary}>{gate.summary}</div>}
      {gate.artifactPath && (
        <div style={styles.gateArtifact}>
          <button
            style={styles.openBtn}
            onClick={() => vscode.postMessage({ type: 'open_file', path: gate.artifactPath! })}
          >
            Open {gate.artifactPath}
          </button>
        </div>
      )}
      <div style={styles.gateActions}>
        <div style={styles.gateTopRow}>
          <button style={styles.agreeBtn} onClick={handleAgree}>
            ✓ Agree
          </button>
          <button style={styles.stopBtn} onClick={() => onRespond('stop', '')}>
            ◼ Stop
          </button>
        </div>
        <div style={styles.feedbackRow}>
          <textarea
            ref={feedbackRef}
            style={styles.feedbackInput}
            placeholder="Feedback (Enter to send)…"
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

// ---------------------------------------------------------------------------
// QuestionGate component
// ---------------------------------------------------------------------------

interface QuestionGateProps {
  question: QuestionData;
  onRespond: (answerText: string, choiceKey: string) => void;
}

export function QuestionGate({ question, onRespond }: QuestionGateProps) {
  const answerRef = useRef<HTMLTextAreaElement>(null);

  function handleAnswer() {
    const text = answerRef.current?.value.trim() ?? '';
    if (!text) return;
    onRespond(text, '');
    if (answerRef.current) answerRef.current.value = '';
  }

  function handleAnswerKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAnswer();
    }
  }

  return (
    <div style={styles.gateCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>QUESTION</span>
      </div>
      {question.question && <div style={styles.gateSummary}>{question.question}</div>}
      {question.mode === 'choice' && question.choices ? (
        <div style={styles.gateTopRow}>
          {question.choices.map((c) => (
            <button key={c.key} style={styles.agreeBtn} onClick={() => onRespond('', c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <div style={styles.feedbackRow}>
          <textarea
            ref={answerRef}
            style={styles.feedbackInput}
            placeholder="Your answer (Enter to send)…"
            rows={2}
            onKeyDown={handleAnswerKey}
          />
          <button style={styles.feedbackBtn} onClick={handleAnswer}>
            ↵ Send
          </button>
        </div>
      )}
    </div>
  );
}
