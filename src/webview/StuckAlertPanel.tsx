import { styles } from './styles';
import type { StuckAlertData } from './types';

/**
 * Stuck-agent watchdog alarm (`prompt.stuck_alert`, doc/STUCK_DETECTION.md).
 *
 * Rendered in place of the prompt input (like PermissionPanel) while the
 * server waits for the user's decision. Modeled on PermissionPanel's card
 * layout but info-blue rather than warning-amber (this is a behavioral
 * observation, not a security risk), with distinct Unstick/Dismiss actions
 * and no "always allow" checkboxes — there is nothing here to remember.
 *
 * Fires two different ways depending on scope (doc/STUCK_DETECTION.md): for
 * the top-level agent, ~5s after its turn already ended normally (the
 * session already looks idle); for a sub-agent, immediately, blocking that
 * sub-agent's turn exactly like a permission prompt blocks its tool call.
 */

interface StuckAlertPanelProps {
  alert: StuckAlertData;
  onRespond: (action: 'unstick' | 'dismiss') => void;
}

export function StuckAlertPanel({ alert, onRespond }: StuckAlertPanelProps) {
  return (
    <div style={styles.stuckAlertCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>STUCK?</span>
        <span style={styles.gateTitle}>{alert.displayName} appears to have stopped early</span>
      </div>
      {alert.reasons.length > 0 && (
        <ul style={styles.stuckAlertReasons}>
          {alert.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      )}
      <div style={styles.gateActions}>
        <div style={styles.gateTopRow}>
          <button style={styles.stuckAlertBtn} onClick={() => onRespond('unstick')}>
            ↻ Unstick it
          </button>
          <button style={styles.stuckAlertDismissBtn} onClick={() => onRespond('dismiss')}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
