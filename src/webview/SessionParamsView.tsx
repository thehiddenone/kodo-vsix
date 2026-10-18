import type { ThinkingFamily } from '../llm-registry-types';
import { paramChangesView } from './paramChanges';
import type { ParamChange } from './paramChanges';
import { styles } from './styles';

interface SessionParamsViewProps {
  first: boolean;
  changes: ParamChange[];
  /** `base_llm` → thinking family, so each tier is named by its own family. */
  families: Record<string, ThinkingFamily>;
}

/**
 * The change element placed before a prompt (kodo/doc/SESSION_LLM_BINDING.md
 * §4): "Started on <LLM>" with the non-default parameters on a session's first
 * prompt, otherwise "Session parameters changed" with one "from → to" row per
 * change. Which rows appear is the server's decision; this only renders them.
 */
export function SessionParamsView({ first, changes, families }: SessionParamsViewProps) {
  const { title, rows } = paramChangesView(changes, families, first);
  return (
    <div style={styles.paramsCard}>
      <div style={styles.paramsTitle}>{title}</div>
      {rows.map((row, i) => (
        <div key={i} style={styles.paramsRow}>
          {row.label}: {first ? row.to : `${row.from} → ${row.to}`}
        </div>
      ))}
    </div>
  );
}
