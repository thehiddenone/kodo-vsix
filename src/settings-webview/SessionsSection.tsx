import type { SessionListEntry } from './types';
import { vscode } from './vscode';

export function sessionWorkspaceLine(session: SessionListEntry): string {
  const ws = session.workspace;
  if (!ws) { return 'Not bound to any workspace'; }
  return ws.codeWorkspaceFile || ws.physicalRoot || 'Not bound to any workspace';
}

interface RowProps {
  session: SessionListEntry;
  onOpenSettings: (sessionId: string) => void;
}

function SessionRow({ session, onOpenSettings }: RowProps) {
  const kindLabel = session.workflowMode === 'guided' ? 'Guided' : 'Problem solving';
  const wsLine = sessionWorkspaceLine(session);
  return (
    <div className="session-row">
      <div className="session-info">
        <div className="session-name" title={session.name}>{session.name}</div>
        <div className="session-meta">{kindLabel}{session.taken ? ' · Open in another window' : ''}</div>
        <div className="session-workspace" title={wsLine}>{wsLine}</div>
      </div>
      <div className="session-icons">
        <button
          className="icon-btn secondary-btn"
          title="Open this session"
          onClick={() => vscode.postMessage({ type: 'open_session', sessionId: session.id })}
        >
          📂
        </button>
        <button
          className="icon-btn secondary-btn"
          title="Session Settings"
          onClick={() => onOpenSettings(session.id)}
        >
          ⚙
        </button>
        <button
          className="icon-btn secondary-btn"
          disabled={session.taken}
          title={session.taken ? 'Close this session in its window before deleting it' : 'Delete this session'}
          onClick={() => {
            if (session.taken) { return; }
            vscode.postMessage({ type: 'delete_session', sessionId: session.id });
          }}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

interface SessionsSectionProps {
  sessions: SessionListEntry[];
  onOpenSettings: (sessionId: string) => void;
}

export function SessionsSection({ sessions, onOpenSettings }: SessionsSectionProps) {
  return (
    <div>
      <h2>Sessions</h2>
      <p className="intro-text">
        Every Kōdo session on this machine. Use the open-folder icon to open (or activate) a session&apos;s tab,
        the gear icon to review a session&apos;s bound workspace and its own allow-rules, or the trash icon to
        delete it.
      </p>
      {sessions.length === 0 ? (
        <div id="empty-msg">No sessions yet.</div>
      ) : (
        <div className="rule-table">
          {sessions.map((s) => <SessionRow key={s.id} session={s} onOpenSettings={onOpenSettings} />)}
        </div>
      )}
    </div>
  );
}
