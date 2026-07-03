import { useEffect, useRef, useState } from 'preact/hooks';
import { styles } from './styles';
import type { AskUserAnswer, AskUserQuestion, SessionEntry } from './types';

/**
 * In-feed panel for an `ask_user` question batch.
 *
 * Interactive while the entry has no answers AND the live prompt.question
 * request is attached (requestId non-null): the user can navigate the
 * question boxes, pick options (radio semantics for single_choice, checkbox
 * for multi_choice), type into the always-present free-text option, and
 * revise everything until "Confirm and Send". Every question must be
 * answered before the confirm button enables; its label counts what is
 * missing.
 *
 * Frozen once `entry.answers` is set (locally on confirm, or rebuilt from
 * the persisted tool call + result after a reload): the same boxes render
 * read-only with the confirmed selections.
 *
 * A question with an empty `options` list (escalate_blocker's prompt) renders
 * as free-text-only.
 */

interface QuestionSelection {
  /** Indexes of the selected options. */
  selected: Set<number>;
  /** Whether the free-text option is selected. */
  freeChecked: boolean;
  freeText: string;
}

function emptySelection(): QuestionSelection {
  return { selected: new Set(), freeChecked: false, freeText: '' };
}

/** A question counts as answered with ≥1 option, or non-blank selected free text. */
function isAnswered(sel: QuestionSelection): boolean {
  return sel.selected.size > 0 || (sel.freeChecked && sel.freeText.trim() !== '');
}

interface AskUserPanelProps {
  entry: Extract<SessionEntry, { type: 'ask_user' }>;
  /** The live request id to respond to, or null when not (yet) interactive. */
  requestId: string | null;
  onRespond: (requestId: string, answers: AskUserAnswer[]) => void;
}

export function AskUserPanel({ entry, requestId, onRespond }: AskUserPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selections, setSelections] = useState<QuestionSelection[]>(() =>
    entry.questions.map(emptySelection),
  );
  const frozen = entry.answers !== null;

  // Auto-scroll a newly asked batch so its first question sits at the top of
  // the visible area. Mount-only: reconciliation keeps this component keyed
  // by toolCallId, so it never re-fires on reconnect refreshes.
  useEffect(() => {
    if (entry.answers === null) {
      rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(qi: number, patch: (sel: QuestionSelection) => QuestionSelection) {
    setSelections((prev) => prev.map((sel, i) => (i === qi ? patch(sel) : sel)));
  }

  function clickOption(q: AskUserQuestion, qi: number, oi: number) {
    if (frozen) return;
    update(qi, (sel) => {
      if (q.kind === 'multi_choice') {
        const selected = new Set(sel.selected);
        if (selected.has(oi)) {
          selected.delete(oi);
        } else {
          selected.add(oi);
        }
        return { ...sel, selected };
      }
      // single_choice: exactly one of (an option | free text).
      return { ...sel, selected: new Set([oi]), freeChecked: false };
    });
  }

  function clickFree(q: AskUserQuestion, qi: number) {
    if (frozen) return;
    update(qi, (sel) =>
      q.kind === 'multi_choice'
        ? { ...sel, freeChecked: !sel.freeChecked }
        : { ...sel, selected: new Set(), freeChecked: true },
    );
  }

  function onFreeInput(q: AskUserQuestion, qi: number, text: string) {
    // Typing selects the free-text option (deselecting options for single_choice).
    update(qi, (sel) => ({
      ...sel,
      freeText: text,
      freeChecked: text.trim() !== '' ? true : sel.freeChecked,
      selected: q.kind === 'single_choice' && text.trim() !== '' ? new Set<number>() : sel.selected,
    }));
  }

  function confirm() {
    if (requestId === null) return;
    const answers: AskUserAnswer[] = entry.questions.map((q, qi) => {
      const sel = selections[qi] ?? emptySelection();
      return {
        selected: q.options.filter((_, oi) => sel.selected.has(oi)),
        free_text: sel.freeChecked && sel.freeText.trim() !== '' ? sel.freeText : null,
      };
    });
    onRespond(requestId, answers);
  }

  function mark(q: AskUserQuestion, on: boolean): string {
    if (q.kind === 'multi_choice') return on ? '■' : '☐';
    return on ? '◉' : '○';
  }

  // Frozen rendering reads the confirmed answers; interactive reads local state.
  function optionOn(q: AskUserQuestion, qi: number, oi: number): boolean {
    if (frozen) return entry.answers![qi]?.selected.includes(q.options[oi]) ?? false;
    return selections[qi]?.selected.has(oi) ?? false;
  }

  function freeOn(qi: number): boolean {
    if (frozen) return (entry.answers![qi]?.free_text ?? null) !== null;
    return selections[qi]?.freeChecked ?? false;
  }

  const unanswered = frozen
    ? 0
    : selections.reduce((n, sel) => n + (isAnswered(sel) ? 0 : 1), 0);
  const confirmDisabled = unanswered > 0 || requestId === null;
  const confirmLabel =
    unanswered > 0
      ? `${unanswered} question${unanswered === 1 ? '' : 's'} remain${unanswered === 1 ? 's' : ''} unanswered`
      : requestId === null
        ? 'Waiting for the session to reconnect…'
        : 'All questions answered, click to confirm and proceed';

  return (
    <div ref={rootRef} style={{ ...styles.askUserPanel, ...(frozen ? styles.askUserPanelFrozen : {}) }}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>{entry.questions.length > 1 ? 'QUESTIONS' : 'QUESTION'}</span>
        <span style={styles.gateTitle}>Kōdo needs your input</span>
        {frozen && <span style={styles.askUserAnsweredNote}>✓ answered</span>}
      </div>
      {entry.questions.map((q, qi) => (
        <div key={qi} style={styles.askUserQuestionBox}>
          <div style={styles.askUserQuestionText}>{q.question}</div>
          {q.options.length > 0 && (
            <div style={styles.askUserKindHint}>
              {q.kind === 'multi_choice' ? 'Select one or more:' : 'Select one:'}
            </div>
          )}
          {q.options.map((opt, oi) => {
            const on = optionOn(q, qi, oi);
            return (
              <div
                key={oi}
                style={{
                  ...styles.askUserOption,
                  ...(on ? styles.askUserOptionSelected : {}),
                  ...(frozen ? styles.askUserOptionFrozen : {}),
                }}
                onClick={() => clickOption(q, qi, oi)}
              >
                <span style={styles.askUserMark}>{mark(q, on)}</span>
                <span>{opt}</span>
              </div>
            );
          })}
          {/* The always-present free-text option, last. */}
          <div
            style={{
              ...styles.askUserOption,
              ...(freeOn(qi) ? styles.askUserOptionSelected : {}),
              ...(frozen ? styles.askUserOptionFrozen : {}),
            }}
            onClick={frozen || q.options.length === 0 ? undefined : () => clickFree(q, qi)}
          >
            <span style={styles.askUserMark}>{mark(q, freeOn(qi))}</span>
            {frozen ? (
              <span style={styles.askUserFreeTextFrozen}>
                {entry.answers![qi]?.free_text ?? '(your own answer — not used)'}
              </span>
            ) : (
              <textarea
                style={styles.askUserFreeInput}
                placeholder="Your own answer…"
                rows={1}
                value={selections[qi]?.freeText ?? ''}
                onClick={(e) => e.stopPropagation()}
                onInput={(e) => onFreeInput(q, qi, (e.currentTarget as HTMLTextAreaElement).value)}
              />
            )}
          </div>
        </div>
      ))}
      {!frozen && (
        <button
          style={{ ...styles.askUserConfirmBtn, ...(confirmDisabled ? styles.askUserConfirmBtnDisabled : {}) }}
          disabled={confirmDisabled}
          onClick={confirm}
          title="Answers are sent only when you confirm; until then you can revise any of them."
        >
          {confirmLabel}
        </button>
      )}
    </div>
  );
}
