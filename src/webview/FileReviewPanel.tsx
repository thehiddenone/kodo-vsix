import { useEffect, useState } from 'preact/hooks';
import { styles } from './styles';
import type { FileReviewComposerData, FileReviewData, FileReviewFeedbackEntry, FileReviewSelection } from './types';

/**
 * Edit Control review gate (`prompt.edit_review`, WS_PROTOCOL.md §6.5b).
 *
 * Rendered in place of the prompt input (like `PermissionPanel`) while the
 * server blocks a `create_file`/`edit_file` call on the user's decision. The
 * gated call's proposed content opens in a companion read-only editor tab —
 * the full content for a new file, a diff for a modification — driven by
 * `session-controller.ts`'s `_openReviewTab`; this panel only ever holds the
 * decision controls and the feedback list.
 *
 * Feedback is modal-edited: "+ Add feedback" is always enabled and opens
 * `ComposerModal` — a small dialog with a multiline textarea — rather than
 * adding a draft directly, so the user always types (or edits) the note's
 * text before it's committed. The host continuously pushes the live
 * selection in the companion tab (`file_review_selection`); when one exists
 * at click time the draft is line-anchored to it, otherwise the draft is
 * "general feedback" (`generalFeedback: true`, no line reference at all —
 * see `FileReviewFeedbackEntry`). The same host also wires a right-click
 * "Add Feedback" item into the companion tab's context menu, converging on
 * the identical `file_review_open_composer` action. Each committed draft
 * renders as a chip (clicking it re-opens the modal to edit; its trash icon
 * asks for confirmation before removing it). Once at least one draft exists,
 * the decision row collapses to a single "Submit Feedback" button — a
 * draft's text already *is* the rejection reason, so a separate plain
 * "Reject" choice would be redundant.
 */

const MODE_LABEL: Record<FileReviewData['mode'], string> = {
  new_file: 'New file',
  modification: 'Modification',
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function truncate(text: string, maxChars: number): string {
  const t = text.trim();
  return t.length <= maxChars ? t : `${t.slice(0, maxChars)}…`;
}

/** Escape-to-cancel, shared by both modals below. */
function useEscapeToCancel(onCancel: () => void): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
}

interface ComposerModalProps {
  path: string;
  composer: FileReviewComposerData;
  onApply: (text: string) => void;
  onCancel: () => void;
}

/** The feedback text editor — opened fresh (empty) for a new draft anchored
 *  to the live selection, or seeded with an existing draft's text when
 *  re-opened from its chip. Mounted only while `composer` is non-null, so
 *  its local `text` state naturally resets between opens (see
 *  `FileReviewPanel` below) without needing an explicit key. */
function ComposerModal({ path, composer, onApply, onCancel }: ComposerModalProps) {
  const [text, setText] = useState(composer.initialText);
  const applyDisabled = text.trim().length === 0;
  useEscapeToCancel(onCancel);

  const title = composer.generalFeedback
    ? `General feedback on ${basename(path)}`
    : `Feedback on ${basename(path)}, L${composer.lineFrom}-${composer.lineTo}`;

  return (
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>{title}</div>
        <div style={styles.modalInstructions}>Enter your feedback in the box below.</div>
        <textarea
          style={styles.modalTextarea}
          autoFocus
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        <div style={styles.modalButtonRow}>
          <button
            style={{ ...styles.agreeBtn, ...(applyDisabled ? styles.modalApplyBtnDisabled : {}) }}
            disabled={applyDisabled}
            onClick={() => onApply(text)}
          >
            Apply
          </button>
          <button style={styles.modalCancelBtn} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmRemoveModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmRemoveModal({ onConfirm, onCancel }: ConfirmRemoveModalProps) {
  useEscapeToCancel(onCancel);

  return (
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalConfirmMessage}>Remove this feedback?</div>
        <div style={styles.modalButtonRow}>
          <button style={styles.stopBtn} onClick={onConfirm}>
            Yes, remove
          </button>
          <button style={styles.modalCancelBtn} onClick={onCancel}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}

interface FileReviewPanelProps {
  review: FileReviewData;
  selection: FileReviewSelection | null;
  drafts: FileReviewFeedbackEntry[];
  composer: FileReviewComposerData | null;
  onOpenComposer: () => void;
  onEditDraft: (index: number) => void;
  onCloseComposer: () => void;
  onApplyComposer: (text: string) => void;
  onRemoveDraft: (index: number) => void;
  onRespond: (action: 'approve' | 'reject', feedback: FileReviewFeedbackEntry[]) => void;
}

export function FileReviewPanel({
  review,
  selection,
  drafts,
  composer,
  onOpenComposer,
  onEditDraft,
  onCloseComposer,
  onApplyComposer,
  onRemoveDraft,
  onRespond,
}: FileReviewPanelProps) {
  const hasDrafts = drafts.length > 0;
  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);

  return (
    <div style={styles.fileReviewCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>REVIEW</span>
        <span style={styles.gateTitle}>Please review and approve changes to {review.path}</span>
        <span style={styles.fileReviewModeBadge}>{MODE_LABEL[review.mode]}</span>
      </div>
      <div style={styles.fileReviewPath}>{review.path}</div>
      <div style={styles.fileReviewInstructions}>
        ℹ Select text in the review tab, then click <strong>+ Add feedback</strong> below, or
        right-click the selection and choose <strong>Add Feedback</strong>.
      </div>
      {hasDrafts && (
        <div style={styles.fileReviewFeedbackList}>
          {drafts.map((d, i) => (
            <div key={i} style={styles.fileReviewFeedbackChip} onClick={() => onEditDraft(i)}>
              <span style={styles.fileReviewFeedbackChipMeta}>
                <span style={styles.fileReviewFeedbackChipLines}>
                  {d.generalFeedback ? 'General feedback' : `L${d.lineFrom}-${d.lineTo}`}
                </span>{' '}
                — {truncate(d.feedback, 30)}
              </span>
              <button
                style={styles.fileReviewFeedbackChipRemove}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmRemoveIndex(i);
                }}
                title="Remove this feedback note"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={styles.fileReviewActionRow}>
        {hasDrafts ? (
          <button style={styles.agreeBtn} onClick={() => onRespond('reject', drafts)}>
            ✓ Submit Feedback
          </button>
        ) : (
          <>
            <button style={styles.agreeBtn} onClick={() => onRespond('approve', [])}>
              ✓ Approve
            </button>
            <button style={styles.stopBtn} onClick={() => onRespond('reject', [])}>
              ✕ Reject
            </button>
          </>
        )}
        <button
          style={styles.feedbackBtn}
          onClick={onOpenComposer}
          title={
            selection?.hasSelection
              ? `Add feedback for lines ${selection.lineFrom}-${selection.lineTo}`
              : 'Add general feedback (not anchored to a specific line)'
          }
        >
          + Add feedback
        </button>
      </div>
      {composer && <ComposerModal path={review.path} composer={composer} onApply={onApplyComposer} onCancel={onCloseComposer} />}
      {confirmRemoveIndex !== null && (
        <ConfirmRemoveModal
          onConfirm={() => {
            onRemoveDraft(confirmRemoveIndex);
            setConfirmRemoveIndex(null);
          }}
          onCancel={() => setConfirmRemoveIndex(null)}
        />
      )}
    </div>
  );
}
