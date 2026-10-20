/**
 * A benchmark session's run, as its tab shows it (kodo doc/BENCHMARK_SESSIONS.md
 * §4.3, §5). Pure — no `vscode` import — so the session controller (which
 * caches it) and the webview (which renders it) share one shape.
 *
 * The server sends three things: the run's record as `state.job`, one
 * `harbor.trial` per finished trial, and one `harbor.finished` at the end. A
 * reopened session gets the trials and the end again as `harbor_trial` /
 * `harbor_finished` entries in `session.history`, with the same fields.
 */

/** Statuses of a run that has not ended. */
const ACTIVE_STATUSES = new Set(['waiting', 'running', 'stopping']);

export interface BenchmarkJob {
  /** `waiting` · `running` · `stopping` · `completed` · `failed` · `stopped` · `interrupted`. */
  status: string;
  /** `basics` for the Basics test suite, else `benchmark`. */
  kind: string;
  agent: string;
  model: string;
  suite: string;
  attempts: number;
  control: boolean;
  thinkingLevel: string | null;
  jobDir: string;
  logPath: string;
  startedAt: string;
  /** Whether the user pressed Stop (`stopped_by: "user"`); a shutdown's stop is `server`. */
  stoppedByUser: boolean;
}

export interface BenchmarkTrial {
  trial: string;
  task: string;
  arm: string;
  reward: number | null;
  seconds: number | null;
  exceptions: string[];
}

export interface BenchmarkFinished {
  /** `completed` · `failed` · `stopped` · `interrupted`. */
  outcome: string;
  exitCode: number | null;
  summaryMarkdown: string;
  detail: string;
  jobDir: string;
  logPath: string;
}

export interface BenchmarkView {
  job: BenchmarkJob;
  trials: BenchmarkTrial[];
  /** Trials the run will have; `null` until Harbor has written the count. */
  total: number | null;
  finished: BenchmarkFinished | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Whether the run has not ended yet. */
export function benchmarkActive(job: BenchmarkJob): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

/** `state.job` → the record, or `null` for a session that is no benchmark. */
export function parseBenchmarkJob(raw: unknown): BenchmarkJob | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const job = raw as Record<string, unknown>;
  return {
    status: text(job.status),
    kind: text(job.kind) || 'benchmark',
    agent: text(job.agent),
    model: text(job.model),
    suite: text(job.suite),
    attempts: numberOrNull(job.attempts) ?? 1,
    control: job.control === true,
    thinkingLevel: typeof job.thinking_level === 'string' && job.thinking_level ? job.thinking_level : null,
    jobDir: text(job.job_dir),
    logPath: text(job.log_path),
    startedAt: text(job.started_at),
    stoppedByUser: job.stopped_by === 'user',
  };
}

/** A `harbor.trial` event or `harbor_trial` entry → the trial, plus its `total`. */
export function parseBenchmarkTrial(raw: Record<string, unknown>): { trial: BenchmarkTrial; total: number | null } {
  return {
    trial: {
      trial: text(raw.trial),
      task: text(raw.task),
      arm: text(raw.arm),
      reward: numberOrNull(raw.reward),
      seconds: numberOrNull(raw.seconds),
      exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.map((e) => String(e)) : [],
    },
    total: numberOrNull(raw.total),
  };
}

/** A `harbor.finished` event or `harbor_finished` entry → how the run ended. */
export function parseBenchmarkFinished(raw: Record<string, unknown>): BenchmarkFinished {
  return {
    outcome: text(raw.outcome),
    exitCode: numberOrNull(raw.exit_code),
    summaryMarkdown: text(raw.summary_markdown),
    detail: text(raw.detail),
    jobDir: text(raw.job_dir),
    logPath: text(raw.log_path),
  };
}

/**
 * Folds a benchmark session's server messages into what its tab shows.
 * Trials are kept once each (by trial name), in the order they first arrive;
 * `session.history` is authoritative for everything it holds, since it is
 * re-sent on every reconnect.
 */
export class BenchmarkProgress {
  private job: BenchmarkJob | null = null;
  private trials: BenchmarkTrial[] = [];
  private total: number | null = null;
  private finished: BenchmarkFinished | null = null;

  /** Adopt `state.job`. Returns whether the view changed. */
  adoptJob(raw: unknown): boolean {
    const job = parseBenchmarkJob(raw);
    if (JSON.stringify(job) === JSON.stringify(this.job)) {
      return false;
    }
    this.job = job;
    return true;
  }

  /** Add one `harbor.trial`. Returns whether the view changed. */
  addTrial(raw: Record<string, unknown>): boolean {
    const { trial, total } = parseBenchmarkTrial(raw);
    let changed = false;
    if (total !== null && total !== this.total) {
      this.total = total;
      changed = true;
    }
    if (trial.trial && !this.trials.some((t) => t.trial === trial.trial)) {
      this.trials = [...this.trials, trial];
      changed = true;
    }
    return changed;
  }

  /** Record `harbor.finished`. */
  finish(raw: Record<string, unknown>): void {
    this.finished = parseBenchmarkFinished(raw);
  }

  /** Rebuild the trials and the end from `session.history`'s entries. Returns
   *  whether the entries held any part of a run. */
  adoptHistory(entries: Record<string, unknown>[]): boolean {
    const trials: BenchmarkTrial[] = [];
    let total: number | null = null;
    let finished: BenchmarkFinished | null = null;
    let any = false;
    for (const entry of entries) {
      const type = String(entry.type ?? '');
      if (type === 'harbor_job') {
        any = true;
      } else if (type === 'harbor_trial') {
        any = true;
        const parsed = parseBenchmarkTrial(entry);
        total = parsed.total ?? total;
        if (parsed.trial.trial && !trials.some((t) => t.trial === parsed.trial.trial)) {
          trials.push(parsed.trial);
        }
      } else if (type === 'harbor_finished') {
        any = true;
        finished = parseBenchmarkFinished(entry);
      }
    }
    if (!any) {
      return false;
    }
    // Trials pushed live after the history was read stay, after it.
    const extra = this.trials.filter((t) => !trials.some((h) => h.trial === t.trial));
    this.trials = [...trials, ...extra];
    this.total = total ?? this.total;
    this.finished = finished ?? this.finished;
    return true;
  }

  /** The view, or `null` while the session is no benchmark session. */
  snapshot(): BenchmarkView | null {
    if (this.job === null) {
      return null;
    }
    return { job: this.job, trials: [...this.trials], total: this.total, finished: this.finished };
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The one-line status a benchmark tab shows under its header. */
export function benchmarkStatusLine(view: BenchmarkView): string {
  const done = view.trials.length;
  const of = view.total === null ? `${done}` : `${done} of ${view.total}`;
  switch (view.job.status) {
    case 'waiting':
      return 'Starting: waiting for llama.cpp (another session\'s turn, or the model loading), or for an API key';
    case 'running':
      return view.total === null && done === 0
        ? 'Running: Harbor is starting (Docker images, installing Kōdo in the containers)'
        : `Running: ${of} trials finished`;
    case 'stopping':
      return `Stopping: Harbor is winding down the trials in progress (${of} finished)`;
    case 'completed':
      return `Finished: ${plural(done, 'trial')}`;
    case 'failed':
      return `Failed after ${plural(done, 'finished trial')}`;
    case 'stopped':
      return `Stopped: ${of} trials finished`;
    case 'interrupted':
      return `Interrupted: the Kōdo server stopped during the run (${plural(done, 'trial')} finished)`;
    default:
      return view.job.status;
  }
}

/**
 * The red callout a benchmark tab shows once the user pressed Stop, as the
 * chat feed does for a stopped turn: from the click (`stopping`) on, and
 * after a reload. `null` while nobody stopped the run, or a shutdown did.
 */
export function benchmarkStopNotice(job: BenchmarkJob): string | null {
  if (!job.stoppedByUser) {
    return null;
  }
  return '<kodo_crit>Benchmark stopped by user — the trials still running were cancelled and have no result; the trials that had finished are kept.</kodo_crit>';
}

/** A reward as the trials table shows it; `—` when the verifier gave none. */
export function formatReward(reward: number | null): string {
  if (reward === null) {
    return '—';
  }
  return Number.isInteger(reward) ? String(reward) : reward.toFixed(3);
}

/** Agent time as the trials table shows it: `42s`, `3m 05s`; `—` when unknown. */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null) {
    return '—';
  }
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total}s`;
  }
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/**
 * One `kodo.jsonl` of a trial: the events `kodo-headless` wrote for one agent
 * run (kodo doc/HEADLESS.md §2.1) — a multi-step trial has one per step.
 * `events` is indexed by the event's position in the log, so it can hold
 * holes for a moment when a live update arrives before the full read a
 * reconnect sends.
 */
export interface ActivityLog {
  log: string;
  /** The step's name once Harbor has filed the log under `steps/`, else null. */
  step: string | null;
  /** `ts` of the log's first event; orders a trial's logs. */
  started: string;
  /** The instruction the run was given (its `instruction.md`), once known. */
  prompt: string | null;
  events: (Record<string, unknown> | undefined)[];
}

/** Every trial's agent activity, by trial name; each trial's logs in run order. */
export type BenchmarkActivity = Record<string, ActivityLog[]>;

/**
 * Fold one `harbor.activity` chunk (kodo doc/WS_PROTOCOL.md §5.9m:
 * `{trial, log, step, started, first, events, prompt}`) into `activity`.
 * Events are placed by position, and a log keeps the first prompt it gets, so
 * a chunk that repeats what is there changes nothing.
 * Returns the new value, or `null` when nothing changed.
 */
export function mergeActivity(activity: BenchmarkActivity, raw: Record<string, unknown>): BenchmarkActivity | null {
  const trial = text(raw.trial);
  const log = text(raw.log);
  const first = numberOrNull(raw.first);
  if (!trial || !log || first === null || first < 0 || !Array.isArray(raw.events)) {
    return null;
  }
  const logs = activity[trial] ?? [];
  const current = logs.find((l) => l.log === log);
  const step = current?.step ?? (typeof raw.step === 'string' && raw.step ? raw.step : null);
  const events = current ? [...current.events] : [];
  const prompt = current?.prompt ?? (typeof raw.prompt === 'string' ? raw.prompt : null);
  let changed = current === undefined || step !== current.step || prompt !== current.prompt;
  raw.events.forEach((event, i) => {
    if (events[first + i] === undefined && event !== null && typeof event === 'object') {
      events[first + i] = event as Record<string, unknown>;
      changed = true;
    }
  });
  if (!changed) {
    return null;
  }
  const next: ActivityLog = { log, step, started: current?.started || text(raw.started), prompt, events };
  const others = logs.filter((l) => l.log !== log);
  const merged = [...others, next].sort((a, b) => a.started.localeCompare(b.started));
  return { ...activity, [trial]: merged };
}

/** The trials with activity, in the order their agents started. */
export function activityTrials(activity: BenchmarkActivity): string[] {
  const started = (trial: string) => activity[trial][0]?.started ?? '';
  return Object.keys(activity).sort((a, b) => started(a).localeCompare(started(b)) || a.localeCompare(b));
}

/** A chunk per log carrying all of it — what a fresh webview is sent. */
export function activityChunks(activity: BenchmarkActivity): Record<string, unknown>[] {
  return activityTrials(activity).flatMap((trial) =>
    activity[trial].map((l) => ({
      trial, log: l.log, step: l.step, started: l.started, first: 0, events: l.events, prompt: l.prompt,
    })),
  );
}
