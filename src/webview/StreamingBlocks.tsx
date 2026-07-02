import { styles } from './styles';
import { BouncingDots } from './indicators';
import { useElapsedTick } from './hooks';
import { completionLabel, formatTokens } from './format';
/** "<N> chars · <S>s" line shown under a live streaming summary. */
function StreamingMeta({ content, startedAt }: { content: string; startedAt: number | null }) {
  const elapsed = startedAt !== null ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return <div style={styles.toolgenMeta}>{`${content.length.toLocaleString()} chars · ${elapsed}s`}</div>;
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
        ) : completionLabel('Thinking completed', content.length, durationMs)}
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
