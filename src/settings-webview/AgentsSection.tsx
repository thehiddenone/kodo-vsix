import type { AgentEntry, AgentsState } from './types';
import { vscode } from './vscode';

interface RowProps {
  agent: AgentEntry;
}

function AgentRow({ agent }: RowProps) {
  const broken = agent.error !== '';
  // A broken bundle has no description to show, so its load error takes the
  // column instead — that is the whole reason broken entries are listed
  // (kodo/doc/USER_AGENTS.md §5): the user can see what is wrong and delete it.
  const detail = broken ? agent.error : agent.description;
  return (
    <div className="agent-row">
      <div className="skill-name" title={agent.path}>
        {agent.label || agent.name}
      </div>
      <div className="agent-kind">{agent.kind}</div>
      <div className="agent-version">{agent.version || '—'}</div>
      <div className={'skill-description' + (broken ? ' skill-error' : '')} title={detail}>
        {detail}
      </div>
      <div className="session-icons">
        <button
          className="icon-btn secondary-btn"
          title="Open this agent's folder in a new window"
          onClick={() => vscode.postMessage({ type: 'open_agent', path: agent.path })}
        >
          📁
        </button>
        <button
          className="icon-btn secondary-btn"
          title="Delete this agent"
          onClick={() =>
            vscode.postMessage({ type: 'delete_agent', name: agent.name, kind: agent.kind })
          }
        >
          🗑
        </button>
      </div>
    </div>
  );
}

interface AgentsSectionProps {
  agents: AgentsState;
  onInstallClick: () => void;
}

export function AgentsSection({ agents, onInstallClick }: AgentsSectionProps) {
  return (
    <div>
      <h2>Agents</h2>
      <p className="intro-text">
        Agents you install yourself, alongside the ones Kōdo ships. A top-level agent appears in
        the agent picker; a sub-agent is one another agent delegates to, and is shared by every
        agent you install. Install from a local folder or a git repository below, or by hand by
        copying a bundle into <code>{agents.root || '~/.kodo/agents'}</code> and using Reload —
        either way no restart is needed. Names beginning <code>kodo_</code> are reserved for the
        built-in agents.
      </p>
      <p>
        <button className="secondary-btn" onClick={onInstallClick}>
          Install from a repository…
        </button>{' '}
        <button
          className="secondary-btn"
          onClick={() => vscode.postMessage({ type: 'pick_agent_source' })}
        >
          Install from a local folder…
        </button>{' '}
        <button
          className="secondary-btn"
          title="Re-read ~/.kodo/agents, for a bundle you edited by hand"
          onClick={() => vscode.postMessage({ type: 'reload_agents' })}
        >
          Reload
        </button>
      </p>
      {agents.agents.length === 0 ? (
        <div id="empty-msg">No agents installed yet — Kōdo's own are always available.</div>
      ) : (
        <div className="rule-table">
          <div className="agent-row agent-header">
            <div className="skill-name">Agent</div>
            <div className="agent-kind">Kind</div>
            <div className="agent-version">Version</div>
            <div className="skill-description">Description</div>
            <div className="session-icons" />
          </div>
          {agents.agents.map((a) => (
            <AgentRow key={`${a.kind}:${a.name}`} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}
