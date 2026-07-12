import { useEffect, useRef, useState } from 'preact/hooks';
import { styles } from './styles';
import { BouncingDots } from './indicators';
import { useElapsedTick } from './hooks';
import { approxTokens, completionLabel, formatTokens, APPROX_TOKENS_TITLE } from './format';
import type { SessionEntry } from './types';
/** "~<N> tokens · <S>s" line shown under a live streaming summary. Token count
 *  is approximate (estimated from text length) — hence the "~" and tooltip. */
function StreamingMeta({ content, startedAt }: { content: string; startedAt: number | null }) {
  const elapsed = startedAt !== null ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return <div style={styles.toolgenMeta} title={APPROX_TOKENS_TITLE}>{`~${approxTokens(content.length).toLocaleString()} tokens · ${elapsed}s`}</div>;
}

interface ThinkingBlockProps {
  content: string;
  isActive: boolean;
  startedAt?: number | null;
  durationMs?: number | null;
}

export function ThinkingBlock({ content, isActive, startedAt = null, durationMs = null }: ThinkingBlockProps) {
  useElapsedTick(isActive);
  return (
    <details style={styles.thinkingBlock}>
      <summary style={styles.thinkingSummary}>
        {isActive ? (
          <>
            <span>{'Thinking '}<BouncingDots /></span>
            <StreamingMeta content={content} startedAt={startedAt} />
          </>
        ) : <span title={APPROX_TOKENS_TITLE}>{completionLabel('Thinking completed', content.length, durationMs)}</span>}
      </summary>
      <div style={styles.thinkingContent}>{content}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// CompactionBlock component
// ---------------------------------------------------------------------------

/**
 * Marks where the prior conversation was summarised and the live LLM context
 * reset. Rendered as a collapsible block in the same visual language as
 * ThinkingBlock: the summary line shows "✦ Context compacted (before → after
 * tokens)" and expanding it reveals the full summary — i.e. the exact context
 * the conversation continues from after compaction. Everything above the block
 * stays visible as history but is no longer part of the LLM context.
 */
export function CompactionBlock({ summary, tokensBefore, tokensAfter }: { summary: string; tokensBefore: number; tokensAfter: number }) {
  const reduction =
    tokensBefore > 0 && tokensAfter > 0
      ? ` (${formatTokens(tokensBefore)} → ${formatTokens(tokensAfter)} tokens)`
      : '';
  return (
    <details style={styles.thinkingBlock}>
      <summary style={styles.thinkingSummary}>{`✦ Context compacted${reduction}`}</summary>
      <div style={styles.thinkingContent}>{summary || '(no summary recorded)'}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// ToolgenBlock component
// ---------------------------------------------------------------------------

/**
 * Live indicator shown while the model streams a tool call's arguments (which
 * can be a whole file and take minutes). The summary line bounces dots and
 * ticks an elapsed timer so it is obvious the model is still working; the
 * collapsible body reveals the raw arguments arriving so far. Removed once the
 * call completes — at which point the tool_call entry shows "Generated … in …".
 */
export function ToolgenBlock({ toolName, content, startedAt }: { toolName: string; content: string; startedAt: number | null }) {
  useElapsedTick(true);
  const label = toolName || 'tool call';
  return (
    <details style={styles.thinkingBlock}>
      <summary style={styles.thinkingSummary}>
        <span>{'Generating content for '}<span style={styles.toolgenName}>{label}</span>{' '}<BouncingDots /></span>
        <StreamingMeta content={content} startedAt={startedAt} />
      </summary>
      <div style={styles.thinkingContent}>{content || '…'}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// WebSearchBlock component
// ---------------------------------------------------------------------------

type ToolCallEntry = Extract<SessionEntry, { type: 'tool_call' }>;

/**
 * Collapsible "Web Search is in progress" / "Web Search Completed" block
 * rendered under a `web_search` tool call (doc/WEB_SEARCH.md §6). The body is
 * the agent's own live narration of its actions/decisions
 * (`entry.webSearchNotes`, required by its prompt); once the call completes,
 * its structured report (the `themes`/`note` output rows already computed for
 * the generic tool-call detail table) is appended at the bottom.
 *
 * Auto-collapses the moment it transitions to completed, regardless of
 * whether the user had it open — but any manual toggle after that (in either
 * direction) sticks, exactly like `<details>`'s native click-to-toggle
 * behavior everywhere else in this file.
 */
export function WebSearchBlock({ entry }: { entry: ToolCallEntry }) {
  const completed = entry.rows.length > 0 || entry.detailFile !== null || entry.schemaCompliance !== null;
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const wasCompleted = useRef(completed);
  useEffect(() => {
    if (completed && !wasCompleted.current) {
      // Just finished this render cycle — force the auto-collapse default,
      // discarding whatever manual state was in effect while it ran.
      setManualOpen(null);
    }
    wasCompleted.current = completed;
  }, [completed]);
  const open = manualOpen ?? !completed;
  const outputRows = entry.rows.filter((r) => r.source === 'output');

  return (
    <details
      style={styles.thinkingBlock}
      open={open}
      onToggle={(e) => setManualOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary style={styles.thinkingSummary}>
        {completed ? 'Web Search Completed' : <span>{'Web Search is in progress '}<BouncingDots /></span>}
      </summary>
      <div style={styles.thinkingContent}>
        {entry.webSearchNotes.length === 0 ? (
          <div style={styles.webSearchNote}>{completed ? '(no narration recorded)' : 'Starting…'}</div>
        ) : (
          entry.webSearchNotes.map((note, i) => (
            <div key={i} style={styles.webSearchNote}>{'• '}{note}</div>
          ))
        )}
        {completed && outputRows.length > 0 && (
          <div style={styles.webSearchReport}>
            <div style={styles.webSearchReportHeading}>Report</div>
            {outputRows.map((r) => (
              <div key={r.name} style={styles.webSearchReportRow}>
                <strong>{r.name}:</strong> {r.value}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
