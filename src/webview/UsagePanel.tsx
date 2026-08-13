import { styles } from './styles';
import type { LastCallTokens, ContextStats, SubsessionContextStats } from './types';
import { formatTokens } from './format';
interface UsagePanelProps {
  sessionName: string;
  cumulativeInputTokens: number;
  cumulativeInputTokensUncached: number;
  cumulativeOutputTokens: number;
  lastCallTokens: LastCallTokens | null;
  contextStats: ContextStats | null;
  subsessionContextStats: SubsessionContextStats | null;
  compacting: boolean;
  onCompact: () => void;
}

export function UsagePanel({ sessionName, cumulativeInputTokens, cumulativeInputTokensUncached, cumulativeOutputTokens, lastCallTokens, contextStats, subsessionContextStats, compacting, onCompact }: UsagePanelProps) {
  // Always render the header line so the session name is visible from the
  // very first frame — before a title is generated.
  return (
    <div style={styles.usagePanel}>
      <div style={styles.usageName}>
        Session name: <strong>{sessionName || 'Unnamed Session'}</strong>
      </div>
      <div style={styles.usageStatsLine}>
        <span style={styles.usageTotals}>
          Total input/output tokens: <strong>{cumulativeInputTokens.toLocaleString()}/{cumulativeOutputTokens.toLocaleString()}</strong>
          {cumulativeInputTokensUncached !== cumulativeInputTokens && (
            <> ({cumulativeInputTokensUncached.toLocaleString()} uncached)</>
          )}
        </span>
        {lastCallTokens !== null && (
          <span style={styles.usageDetail}>
            {' '}| last call: {lastCallTokens.input}↑ {lastCallTokens.output}↓
            {lastCallTokens.cache_read > 0 && ` ${lastCallTokens.cache_read}✦cached`}
          </span>
        )}
        {contextStats !== null && (
          <>
            <span style={styles.usageDetail}>
              {' '}| context: <strong>{formatTokens(contextStats.currentTokens)}</strong>
              {' / '}{formatTokens(contextStats.limitTokens)}
              {' ('}{contextStats.percent.toFixed(0)}%)
            </span>
            {subsessionContextStats !== null && (
              <span style={styles.usageDetail}>
                {' '}| subsession context: <strong>{formatTokens(subsessionContextStats.currentTokens)}</strong>
                {' / '}{formatTokens(subsessionContextStats.limitTokens)}
                {' ('}{subsessionContextStats.percent.toFixed(0)}%)
              </span>
            )}
            <button
              style={contextStats.canCompact && !compacting ? styles.compactBtn : styles.compactBtnDisabled}
              onClick={onCompact}
              disabled={!contextStats.canCompact || compacting}
              title={compacting ? 'Compaction in progress' : contextStats.canCompact ? 'Summarise and reset the LLM context now' : 'Available once the current turn has finished'}
            >
              Compact now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
