import { useRef } from 'preact/hooks';
import { styles } from './styles';
import type { PermissionData } from './types';

/**
 * Security-layer permission prompt (`prompt.permission`, WS_PROTOCOL.md §6.5).
 *
 * Rendered in place of the prompt input (like the ApprovalGate) while the
 * server blocks a gated tool call on the user's decision. Shows the tool,
 * its risk level, the agent's declared intent, the security layer's reason
 * for asking, and the call's customer-visible parameters. The optional
 * feedback text rides along with either decision — on Deny it is returned
 * to the agent verbatim.
 */

interface PermissionPanelProps {
  permission: PermissionData;
  onRespond: (action: 'allow' | 'deny', feedback: string) => void;
}

export function PermissionPanel({ permission, onRespond }: PermissionPanelProps) {
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  function respond(action: 'allow' | 'deny') {
    onRespond(action, feedbackRef.current?.value.trim() ?? '');
  }

  return (
    <div style={styles.permissionCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>PERMISSION</span>
        <span style={styles.gateTitle}>Kōdo requests permission: {permission.externalName}</span>
        <span style={styles.permissionRiskBadge}>{permission.risk} impact</span>
      </div>
      <div style={styles.permissionReason}>{permission.reason}</div>
      {permission.intent && (
        <div style={styles.permissionIntent}>
          <span style={styles.permissionIntentLabel}>Declared intent: </span>
          {permission.intent}
        </div>
      )}
      {permission.params.length > 0 && (
        <div style={styles.permissionParams}>
          {permission.params.map((p) => (
            <div key={p.name} style={styles.permissionParamRow}>
              <span style={styles.permissionParamName}>{p.name}</span>
              <span style={styles.permissionParamValue}>{p.value}</span>
            </div>
          ))}
        </div>
      )}
      <div style={styles.gateActions}>
        <textarea
          ref={feedbackRef}
          style={styles.feedbackInput}
          placeholder="Optional: tell Kōdo why, or what to do instead…"
          rows={2}
        />
        <div style={styles.gateTopRow}>
          <button style={styles.agreeBtn} onClick={() => respond('allow')}>
            ✓ Allow
          </button>
          <button style={styles.stopBtn} onClick={() => respond('deny')}>
            ✕ Deny
          </button>
        </div>
      </div>
    </div>
  );
}
