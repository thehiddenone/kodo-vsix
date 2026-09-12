import { useState } from 'preact/hooks';
import { styles } from './styles';
import type { PlanTask, SessionEntry } from './types';

type PlanEntry = Extract<SessionEntry, { type: 'plan_state' }>;

interface PlanViewProps {
  entry: PlanEntry;
}

/**
 * The session's work plan — the ordered task list a planner sub-agent produced,
 * with where the work has got to (kodo `doc/PLANNING.md`).
 *
 * Three properties come from the server, not from here:
 *
 * - **The statuses are already derived** from the plan log server-side. Do not
 *   recompute one from `currentTask`, a step count, or position — the client and
 *   the server must not be able to disagree about where the work stands.
 * - **The order is the plan.** `tasks` is the execution order and `id` is
 *   1-based position; nothing here sorts or renumbers.
 * - **There is no `failed` status.** A task cannot fail: a plan only moves
 *   forward, and work that turns out to be misjudged is closed wholesale —
 *   finished, or abandoned. An unrecognised status therefore renders as pending
 *   rather than inventing a fourth state.
 *
 * An **abandoned** plan is one that was closed without being finished. Its
 * unfinished tasks deliberately keep their statuses, so this renders them as
 * they are: the record says how far the work actually got, and dressing the
 * leftovers up as anything else would be the lie the whole derived-status design
 * exists to prevent.
 *
 * This widget is the user's *only* view of the plan, but not the only copy of
 * it: the model was handed the identical state as its own `get_plan` /
 * `plan_step_forward` result. The two are one payload, emitted twice — which is
 * why nothing here is ever fed back to an agent (the server persists it as a
 * marker, and markers never enter the LLM's message history).
 *
 * Collapsed by default once the plan is closed: a finished or abandoned plan is a
 * record, and a live one is what deserves the space.
 */
export function PlanView({ entry }: PlanViewProps) {
  const done = entry.tasks.filter((t) => t.status === 'done').length;
  const [collapsed, setCollapsed] = useState(entry.complete || entry.abandoned);
  const [showContext, setShowContext] = useState(false);
  return (
    <div style={styles.plan}>
      <div
        style={styles.planHeader}
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        title={collapsed ? 'Click to see the plan' : 'Click to collapse the plan'}
      >
        <span>{collapsed ? '[+]' : '[-]'}</span>
        <span style={styles.planTitle}>{headline(entry)}</span>
        <span style={styles.planCounter}>
          {done} of {entry.tasks.length} done
        </span>
      </div>
      {!collapsed && (
        <div style={styles.planBody}>
          {/* A shortfall between what the planner reported and what became a
              task. Shown here rather than only in the agent's result, because
              this is the card that is missing the tasks. */}
          {entry.issue !== '' && <div style={styles.planIssue}>⚠ {entry.issue}</div>}
          {entry.abandoned && (
            <div style={styles.planAbandonReason}>
              Closed unfinished
              {entry.abandonReason !== '' ? `: ${entry.abandonReason}` : '.'}
            </div>
          )}
          <ol style={styles.planTaskList}>
            {entry.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ol>
          {entry.context !== '' && (
            <>
              <button
                style={styles.planContextToggle}
                onClick={() => setShowContext((s) => !s)}
                title="The briefing the planner established while writing this plan"
              >
                {showContext ? 'Hide' : 'Show'} the planner's notes on the codebase
              </button>
              {showContext && <div style={styles.planContext}>{entry.context}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The card's title. `reason` is the server's word for what produced this view —
 *  a plan that was just created reads differently from one the agent re-read —
 *  but a closed plan's state outranks it: "abandoned" and "complete" are the
 *  headlines that matter, and both are checked before the reason. */
function headline(entry: PlanEntry): string {
  if (entry.abandoned) {
    return 'Plan abandoned';
  }
  if (entry.complete) {
    return 'Plan complete';
  }
  return entry.reason === 'created' ? 'Plan' : 'Plan progress';
}

/** A glyph per status. Deliberately three and only three — see PlanView's note
 *  on why there is no failure state. An unknown status falls through to pending
 *  rather than being rendered as something the plan model cannot represent. */
function marker(status: string): string {
  if (status === 'done') {
    return '✓';
  }
  return status === 'in_progress' ? '▸' : '·';
}

function TaskRow({ task }: { task: PlanTask }) {
  const titleStyle =
    task.status === 'done'
      ? styles.planTaskTitleDone
      : task.status === 'in_progress'
        ? styles.planTaskTitleCurrent
        : styles.planTaskTitle;
  return (
    <li style={styles.planTaskRow}>
      <span style={styles.planTaskMarker}>{marker(task.status)}</span>
      <span style={styles.planTaskIndex}>{task.id}.</span>
      <span style={titleStyle}>{task.title}</span>
    </li>
  );
}
