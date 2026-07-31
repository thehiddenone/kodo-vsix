// Groups the flat `state.session` array into render blocks: plain entries,
// and subsession groups (a `subsession_divider` "start" through its matching
// "end", with the subsession's own spliced-in entries between them — see
// reducer.ts's `subsession_started`/`subsession_ended`/`session_history`
// handling, which is what interleaves a subsession's own transcript into the
// same flat array in the first place). Subsessions cannot nest (see kodo's
// `_llm.py`), so a single linear scan is enough: no group ever contains
// another group.
import type { SessionEntry } from './types';

type SubsessionDivider = Extract<SessionEntry, { type: 'subsession_divider' }>;
type SubagentTask = Extract<SessionEntry, { type: 'subagent_task' }>;

export interface SubsessionGroup {
  kind: 'subsession_group';
  /** Position of the "start" divider in the original flat array — stable
   *  across re-renders (entries are only ever appended), used as the React
   *  key so the collapse/expand toggle survives history reconciliation. */
  index: number;
  startEntry: SubsessionDivider;
  task: SubagentTask | null;
  inner: SessionEntry[];
  /** Null while the subsession is still running (no "end" divider yet). */
  endEntry: SubsessionDivider | null;
}

export interface PlainBlock {
  kind: 'entry';
  index: number;
  entry: SessionEntry;
}

export type SessionBlock = PlainBlock | SubsessionGroup;

export function groupSessionEntries(session: SessionEntry[]): SessionBlock[] {
  const blocks: SessionBlock[] = [];
  let i = 0;
  while (i < session.length) {
    const entry = session[i];
    if (entry.type === 'subsession_divider' && entry.phase === 'start') {
      const startIndex = i;
      const startEntry = entry;
      i++;
      let task: SubagentTask | null = null;
      if (i < session.length && session[i].type === 'subagent_task') {
        task = session[i] as SubagentTask;
        i++;
      }
      const inner: SessionEntry[] = [];
      let endEntry: SubsessionDivider | null = null;
      while (i < session.length) {
        const e = session[i];
        if (e.type === 'subsession_divider' && e.phase === 'end') {
          endEntry = e;
          i++;
          break;
        }
        inner.push(e);
        i++;
      }
      blocks.push({ kind: 'subsession_group', index: startIndex, startEntry, task, inner, endEntry });
      continue;
    }
    blocks.push({ kind: 'entry', index: i, entry });
    i++;
  }
  return blocks;
}
