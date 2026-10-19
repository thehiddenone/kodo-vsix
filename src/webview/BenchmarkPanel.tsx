import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ActivityLog, BenchmarkActivity, BenchmarkView } from '../benchmark-view';
import { activityTrials, benchmarkActive, benchmarkStatusLine, formatReward, formatSeconds } from '../benchmark-view';
import { activityEntries } from './benchmarkActivity';
import { groupSessionEntries } from './groupSubsessions';
import { Markdown } from './markdown';
import { SessionEntryView } from './SessionEntryView';
import { styles } from './styles';
import { SubsessionGroupView } from './SubsessionGroupView';
import type { UiSettings } from './types';
import { vscode } from './vscode';

interface BenchmarkPanelProps {
  view: BenchmarkView;
  activity: BenchmarkActivity;
  uiSettings: UiSettings;
}

/**
 * A benchmark session's tab body, in place of the chat feed (kodo
 * doc/BENCHMARK_SESSIONS.md §5): what runs, its status, one row per finished
 * trial, and — once it ends — the run's summary. The job directory and the
 * run's log (`kodo-harbor`'s output, never sent over the wire) open from here.
 * Below the trials, one collapsible block per trial shows what the agent did
 * in it (`harbor.activity`, §4.8). A trial without a Kōdo log (a terminus-2
 * control) has no block.
 */
export function BenchmarkPanel({ view, activity, uiSettings }: BenchmarkPanelProps) {
  const { job, trials, finished } = view;
  const active = benchmarkActive(job);
  const logPath = finished?.logPath || job.logPath;
  const jobDir = finished?.jobDir || job.jobDir;
  return (
    <div style={styles.benchmark}>
      <div style={styles.benchmarkHeader}>
        <span>{job.kind === 'basics' ? 'Basics test' : 'Benchmark'}</span>
        <span>agent <span style={styles.benchmarkHeaderValue}>{job.agent}</span></span>
        <span>model <span style={styles.benchmarkHeaderValue}>{job.model}</span></span>
        <span>suite <span style={styles.benchmarkHeaderValue}>{job.suite}</span></span>
        {job.attempts > 1 && <span>{job.attempts} attempts per task</span>}
        {job.thinkingLevel !== null && (
          <span>thinking <span style={styles.benchmarkHeaderValue}>{job.thinkingLevel}</span></span>
        )}
        {job.control && <span>with a terminus-2 control</span>}
      </div>

      <div style={styles.benchmarkStatus}>{benchmarkStatusLine(view)}</div>

      {finished !== null && finished.outcome === 'failed' && finished.detail && (
        <pre style={styles.benchmarkDetail}>{finished.detail}</pre>
      )}

      {trials.length > 0 && (
        <div style={styles.reviewFindings}>
          <div style={styles.reviewFindingsBody}>
            <table style={styles.reviewFindingsTable}>
              <thead>
                <tr>
                  <th style={styles.reviewFindingsHeadCell}>Task</th>
                  <th style={styles.reviewFindingsHeadCell}>Arm</th>
                  <th style={styles.reviewFindingsHeadCell}>Reward</th>
                  <th style={styles.reviewFindingsHeadCell}>Agent time</th>
                  <th style={styles.reviewFindingsHeadCell}>Errors</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => (
                  <tr key={t.trial}>
                    <td style={styles.reviewFindingsCell} title={t.trial}>{t.task}</td>
                    <td style={styles.reviewFindingsCell}>{t.arm}</td>
                    <td style={styles.benchmarkNumberCell}>{formatReward(t.reward)}</td>
                    <td style={styles.benchmarkNumberCell}>{formatSeconds(t.seconds)}</td>
                    <td style={styles.reviewFindingsCell}>{t.exceptions.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activityTrials(activity).map((trial) => (
        <TrialActivityView
          key={trial}
          trial={trial}
          logs={activity[trial]}
          running={active && !trials.some((t) => t.trial === trial)}
          uiSettings={uiSettings}
        />
      ))}

      {finished !== null && finished.summaryMarkdown && <Markdown content={finished.summaryMarkdown} />}

      <div style={styles.benchmarkLinks}>
        {logPath && (
          <button
            style={styles.benchmarkLink}
            onClick={() => vscode.postMessage({ type: 'open_path', path: logPath })}
            title={logPath}
          >
            Open the run's log
          </button>
        )}
        {jobDir && (
          <button
            style={styles.benchmarkLink}
            onClick={() => vscode.postMessage({ type: 'reveal_path', path: jobDir })}
            title={jobDir}
          >
            Show the job directory
          </button>
        )}
      </div>
    </div>
  );
}

interface TrialActivityViewProps {
  trial: string;
  /** The trial's logs in run order: one per step of a multi-step task. */
  logs: ActivityLog[];
  /** Whether the trial is still going (it has no row yet and the run is on). */
  running: boolean;
  uiSettings: UiSettings;
}

/**
 * One trial's agent activity as a collapsible block, like a subsession's
 * (SubsessionGroupView): open while the trial runs, folded when it finishes
 * — only on that transition, so a block opened by hand stays open — and
 * folded from the start for a trial that had already finished. A multi-step
 * trial's steps follow one another, each after a divider with its name.
 */
function TrialActivityView({ trial, logs, running, uiSettings }: TrialActivityViewProps) {
  const [collapsed, setCollapsed] = useState(!running);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      setCollapsed(true);
    }
    wasRunning.current = running;
  }, [running]);
  const steps = useMemo(() => logs.map((l) => ({ log: l, entries: activityEntries(l.events) })), [logs]);
  const dividers = logs.length > 1 || logs.some((l) => l.step !== null);
  return (
    <div>
      <div
        style={styles.subsessionBlockTitle}
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        title={collapsed ? "Click to see what the agent did in this trial" : 'Click to collapse it'}
      >
        {collapsed ? '[+] ' : '[-] '}
        {trial}: agent activity.
        {collapsed && ' Click to see the details.'}
      </div>
      {!collapsed && (
        <div style={styles.subsessionBlockContent}>
          {steps.map(({ log, entries }, i) => (
            <div key={log.log}>
              {dividers && <div style={styles.benchmarkStepDivider}>{log.step ?? `Step ${i + 1}`}</div>}
              {groupSessionEntries(entries).map((block) =>
                block.kind === 'entry' ? (
                  <SessionEntryView key={block.index} entry={block.entry} uiSettings={uiSettings} fileLinks={false} />
                ) : (
                  <SubsessionGroupView key={block.index} group={block} uiSettings={uiSettings}>
                    {block.inner.map((e, j) => (
                      <SessionEntryView key={`${block.index}-${j}`} entry={e} uiSettings={uiSettings} fileLinks={false} />
                    ))}
                  </SubsessionGroupView>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
