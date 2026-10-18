import type { BenchmarkView } from '../benchmark-view';
import { benchmarkStatusLine, formatReward, formatSeconds } from '../benchmark-view';
import { Markdown } from './markdown';
import { styles } from './styles';
import { vscode } from './vscode';

/**
 * A benchmark session's tab body, in place of the chat feed (kodo
 * doc/BENCHMARK_SESSIONS.md §5): what runs, its status, one row per finished
 * trial, and — once it ends — the run's summary. The job directory and the
 * run's log (`kodo-harbor`'s output, never sent over the wire) open from here.
 */
export function BenchmarkPanel({ view }: { view: BenchmarkView }) {
  const { job, trials, finished } = view;
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
