import { useRef, useState } from 'preact/hooks';
import { styles } from './styles';
import type { PermissionData, PermissionPart, RuleOffer } from './types';

/**
 * Security-layer permission prompt (`prompt.permission`, WS_PROTOCOL.md §6.5).
 *
 * Rendered in place of the prompt input (like the ApprovalGate) while the
 * server blocks a gated tool call on the user's decision. Shows the tool,
 * its risk level, the agent's declared intent, the security layer's reason
 * for asking, and the call's customer-visible parameters. The optional
 * feedback text rides along with either decision — on Deny it is returned
 * to the agent verbatim.
 *
 * When `permission.recovered` is set, the gated call was salvaged from a
 * malformed (plain-text) tool call the model emitted instead of a proper tool
 * call — Kōdo inferred the tool from the arguments and needs the user to
 * confirm the guess before running it. A distinct banner flags that (only ever
 * shown outside autonomous mode; the server auto-runs recovered calls when
 * autonomous).
 *
 * `permission.parts` is every elementary command within the call that still
 * needs attention (doc/SECURITY_RULES_PLAN.md §2.6) — one for an ordinary
 * single-command ask, several for a compound pipeline/`&&`/`;` chain where
 * each part was judged independently. A single part renders exactly as
 * before: the top `reason` banner plus, when that part's `ruleOffer` is set,
 * one checkbox pair ("this session" / "all sessions", mutually exclusive).
 * More than one part renders the top `reason` as a summary, then one block
 * per part with its own reason line and its own checkbox pair. The choice
 * only takes effect alongside Allow (the server ignores `remember` on a
 * Deny); clicking Deny with boxes checked is harmless, not a silent grant.
 */

interface PermissionPanelProps {
  permission: PermissionData;
  onRespond: (action: 'allow' | 'deny', feedback: string, remember: ('session' | 'global' | null)[]) => void;
}

function ruleShapeText(offer: RuleOffer): string {
  return `${offer.executable} ${offer.subcommand}`.trim();
}

interface RuleOfferCheckboxesProps {
  offer: RuleOffer;
  remembered: 'session' | 'global' | null;
  onToggle: (scope: 'session' | 'global') => void;
}

function RuleOfferCheckboxes({ offer, remembered, onToggle }: RuleOfferCheckboxesProps) {
  const shape = ruleShapeText(offer);
  return (
    <div style={styles.permissionRuleOffer}>
      <label style={styles.permissionRuleOfferLabel}>
        <input type="checkbox" checked={remembered === 'session'} onChange={() => onToggle('session')} />
        Always allow <span style={styles.permissionRuleOfferShape}>{shape}</span> — this session
      </label>
      <label style={styles.permissionRuleOfferLabel}>
        <input type="checkbox" checked={remembered === 'global'} onChange={() => onToggle('global')} />
        Always allow <span style={styles.permissionRuleOfferShape}>{shape}</span> — all sessions
      </label>
    </div>
  );
}

export function PermissionPanel({ permission, onRespond }: PermissionPanelProps) {
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [remember, setRemember] = useState<('session' | 'global' | null)[]>(() =>
    permission.parts.map(() => null),
  );

  function respond(action: 'allow' | 'deny') {
    onRespond(action, feedbackRef.current?.value.trim() ?? '', remember);
  }

  function toggleRemember(index: number, scope: 'session' | 'global') {
    setRemember((current) => current.map((v, i) => (i === index ? (v === scope ? null : scope) : v)));
  }

  const parts: PermissionPart[] = permission.parts;
  const singlePart = parts.length === 1 ? parts[0] : null;

  return (
    <div style={styles.permissionCard}>
      <div style={styles.gateHeader}>
        <span style={styles.gateType}>PERMISSION</span>
        <span style={styles.gateTitle}>Kōdo requests permission: {permission.externalName}</span>
        <span style={styles.permissionRiskBadge}>{permission.risk} impact</span>
      </div>
      {permission.recovered && (
        <div style={styles.permissionRecoveredBanner}>
          ⚠ The agent produced a malformed tool call, which Kōdo recovered. The tool below was
          inferred from its arguments — confirm it looks right before allowing it to run.
        </div>
      )}
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
      {singlePart?.ruleOffer && (
        <RuleOfferCheckboxes
          offer={singlePart.ruleOffer}
          remembered={remember[0] ?? null}
          onToggle={(scope) => toggleRemember(0, scope)}
        />
      )}
      {parts.length > 1 && (
        <div style={styles.permissionParts}>
          {parts.map((part, i) => (
            <div key={i} style={styles.permissionPartBlock}>
              <div style={styles.permissionPartReason}>{part.reason}</div>
              {part.ruleOffer && (
                <RuleOfferCheckboxes
                  offer={part.ruleOffer}
                  remembered={remember[i] ?? null}
                  onToggle={(scope) => toggleRemember(i, scope)}
                />
              )}
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
