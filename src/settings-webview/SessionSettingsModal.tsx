import { useEffect, useState } from 'preact/hooks';
import { RuleList, RuleToolbar } from './RuleList';
import { sessionWorkspaceLine } from './SessionsSection';
import type { SessionListEntry, SessionRulesState } from './types';
import { ruleKey } from './types';
import { vscode } from './vscode';

interface SessionSettingsModalProps {
  session: SessionListEntry;
  sessionRules: SessionRulesState | null;
  onClose: () => void;
}

export function SessionSettingsModal({ session, sessionRules, onClose }: SessionSettingsModalProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const rulesLoaded = sessionRules !== null && sessionRules.sessionId === session.id;
  const rules = rulesLoaded ? sessionRules.rules : [];

  useEffect(() => {
    if (!rulesLoaded) { return; }
    const keys = new Set(rules.map(ruleKey));
    setChecked((prev) => {
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRules]);

  const ws = session.workspace;
  const lockedPaths = ws && ws.folders ? Object.values(ws.folders) : [];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h2>Session Details</h2>

        <div className="section-subheading">Title</div>
        <p className="value-line"><span className="value-code">{session.name}</span></p>
        <hr className="section-divider" />

        <div className="section-subheading">{ws && ws.codeWorkspaceFile ? '.code-workspace file' : 'Bound workspace root'}</div>
        <p className="value-line"><span className="value-code">{sessionWorkspaceLine(session)}</span></p>
        <hr className="section-divider" />

        <div className="section-subheading">Working directories</div>
        <div className="readonly-list">
          {lockedPaths.length === 0 ? (
            <p className="value-code">No working directories — no files in this session have been modified yet.</p>
          ) : (
            lockedPaths.map((p) => <p className="value-line" key={p}><span className="value-code">{p}</span></p>)
          )}
        </div>
        <hr className="section-divider" />

        <div className="section-subheading">Session Allow-Rules</div>
        {!rulesLoaded ? (
          <div id="empty-msg">Loading…</div>
        ) : (
          <RuleList
            rules={rules}
            checked={checked}
            onCheckedChange={setChecked}
            emptyText="No allow-rules for this session yet — they're added from a permission prompt's 'always allow' checkbox when you choose the 'session' scope."
          />
        )}
        <hr className="section-divider" />

        <RuleToolbar
          className="modal-toolbar"
          rules={rules}
          checked={checked}
          onCheckedChange={setChecked}
          onDeleteSelected={(selected) => vscode.postMessage({
            type: 'delete_session_rules', sessionId: session.id, rules: selected,
          })}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
