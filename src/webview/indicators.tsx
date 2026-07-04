import { useState, useEffect } from 'preact/hooks';
import { styles } from './styles';
export function BouncingDots() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % 22), 150);
    return () => clearInterval(id);
  }, []);
  const dots = step <= 11 ? step + 1 : 23 - step;
  return <span>{'.'.repeat(dots)}</span>;
}

export function AwaitingIndicator() {
  return (
    <div style={styles.awaitingLine}>
      {'Awaiting response '}<BouncingDots />
    </div>
  );
}

/**
 * Gateway queue/throttle indicator. While a request is queued behind the serial
 * local gate / a saturated cloud feed it reads "LLM is busy, waiting"; while a
 * 429 backoff is in effect it reads "Getting throttled, waiting for X minutes".
 */
export function LlmWaitingIndicator({ waiting }: { waiting: { reason: string; retryIn: number | null } }) {
  const label =
    waiting.reason === 'throttled'
      ? `Getting throttled, waiting for ${Math.max(1, Math.round((waiting.retryIn ?? 60) / 60))} minute${
          Math.max(1, Math.round((waiting.retryIn ?? 60) / 60)) === 1 ? '' : 's'
        } `
      : 'LLM is busy, waiting ';
  return (
    <div style={styles.awaitingLine}>
      {label}<BouncingDots />
    </div>
  );
}

/**
 * Progress bar shown under a live `run_command` call while it runs. The filled
 * `===>` segment advances from empty toward full over the command's timeout
 * window (`|======>.......|`), so it reaches the right edge exactly when the
 * command would be killed. Removed once the tool's detail (result) arrives.
 */
const RUN_COMMAND_BAR_WIDTH = 24;

export function RunCommandProgress({ timeoutSeconds, startedAt }: { timeoutSeconds: number; startedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
  const frac = timeoutSeconds > 0 ? Math.min(elapsed / timeoutSeconds, 1) : 1;
  const filled = Math.round(frac * RUN_COMMAND_BAR_WIDTH);
  const bar =
    (filled > 0 ? '='.repeat(filled - 1) + '>' : '') +
    '.'.repeat(RUN_COMMAND_BAR_WIDTH - filled);
  const shown = Math.min(Math.floor(elapsed), Math.floor(timeoutSeconds));
  return (
    <div style={styles.runCommandProgress}>
      {'Waiting for tool output '}
      <span style={styles.runCommandBar}>{`|${bar}|`}</span>
      {` ${shown}s / ${Math.floor(timeoutSeconds)}s`}
    </div>
  );
}

export function NamingIndicator() {
  return (
    <div style={styles.awaitingLine}>
      {'Starting a new session '}<BouncingDots />
    </div>
  );
}

export function SecurityJudgingIndicator() {
  return (
    <div style={styles.awaitingLine}>
      {"Evaluating Kōdo's action "}<BouncingDots />
    </div>
  );
}

export function CompactingIndicator() {
  return (
    <div style={styles.awaitingLine}>
      {'Compacting context, please hold on '}<BouncingDots />
    </div>
  );
}
