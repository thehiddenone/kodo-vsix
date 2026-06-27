import { styles } from './styles';
import type { LastCallTokens, ContextStats } from './types';
import { formatTokens } from './format';
interface UsagePanelProps {
  sessionName: string;
  currentProject: string;
  cumulativeUsd: number;
  lastCallTokens: LastCallTokens | null;
  contextStats: ContextStats | null;
  compacting: boolean;
  onCompact: () => void;
}

export function UsagePanel({ sessionName, currentProject, cumulativeUsd, lastCallTokens, contextStats, compacting, onCompact }: UsagePanelProps) {
  // Always render both header lines so the session name and running cost are
  // visible from the very first frame — before a title is generated and before
  // any cost has accrued.
  return (
    <div style={styles.usagePanel}>
      <div style={styles.usageName}>
        Session name: <strong>{sessionName || 'Unnamed Session'}</strong>
      </div>
      {currentProject && (
        <div style={styles.usageName}>
          Project: <strong>{currentProject}</strong> <span style={styles.usageDetail}>(locked for this session)</span>
        </div>
      )}
      <div style={styles.usageCostLine}>
        <span style={styles.usageTotal}>
          Session cost: <strong>${cumulativeUsd.toFixed(4)}</strong>
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
