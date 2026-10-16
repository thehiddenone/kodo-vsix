import type { BenchmarkMode } from './BenchmarkModal';
import type { AgentEntry, AgentsState, TopBuiltinEntry } from './types';
import { vscode } from './vscode';

/** Opens the Benchmark / Basics test modal for one top-level agent. */
export type OnBenchmark = (agent: string, label: string, mode: BenchmarkMode) => void;

interface RowProps {
  agent: AgentEntry;
  onValidate: (name: string) => void;
  onBenchmark: OnBenchmark;
}

/** The Basics test and Benchmark buttons (kodo/doc/AGENT_BUILDER.md §8). Only a
 * selectable top-level agent can run alone; any other row gets them disabled,
 * so the action column stays aligned. */
function BenchmarkButtons({ name, label, enabled, onBenchmark }: {
  name: string; label: string; enabled: boolean; onBenchmark: OnBenchmark;
}) {
  const why = 'Only a top-level agent the picker offers can run alone; benchmark one that uses this';
  return (
    <>
      <button
        className="icon-btn secondary-btn"
        disabled={!enabled}
        title={enabled
          ? 'Basics test: seven small tasks in Docker check that the prompt makes the agent follow instructions and use its tools'
          : why}
        onClick={() => onBenchmark(name, label, 'basics')}
      >
        🧪
      </button>
      <button
        className="icon-btn secondary-btn"
        disabled={!enabled}
        title={enabled ? 'Benchmark: run a Harbor suite on this agent in a terminal' : why}
        onClick={() => onBenchmark(name, label, 'benchmark')}
      >
        📊
      </button>
    </>
  );
}

/** The lint column: how many warnings the prompt has (kodo/doc/AGENT_BUILDER.md
 * §5.2). Warnings never stop an agent loading — a broken row's reason is in its
 * description column — so this only says whether the report is worth opening. */
function LintCell({ agent }: { agent: AgentEntry }) {
  if (agent.warnings === 0) {
    return <div className="agent-lint" title="Its prompt passes every lint rule">✓</div>;
  }
  const plural = agent.warnings === 1 ? '' : 's';
  return (
    <div className="agent-lint agent-lint-warn" title={`${agent.warnings} lint warning${plural}`}>
      ⚠ {agent.warnings}
    </div>
  );
}

function AgentRow({ agent, onValidate, onBenchmark }: RowProps) {
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
      <LintCell agent={agent} />
      <div className={'skill-description' + (broken ? ' skill-error' : '')} title={detail}>
        {detail}
      </div>
      <div className="session-icons">
        <BenchmarkButtons
          name={agent.name}
          label={agent.label || agent.name}
          enabled={agent.selectable && !broken}
          onBenchmark={onBenchmark}
        />
        <button
          className="icon-btn secondary-btn"
          title="Validate: does it load, and what does the lint say about its prompt"
          onClick={() => onValidate(agent.name)}
        >
          🩺
        </button>
        <button
          className="icon-btn secondary-btn"
          title="Review with AI: a new session has Agent Critic check this agent against Kōdo's prompt-writing rules and lists each concern"
          onClick={() => vscode.postMessage({ type: 'review_agent', name: agent.name })}
        >
          🤖
        </button>
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

/** One row of the read-only "Built-in agents" list: Kōdo's own selectable
 * top-level agents, where Basics test, Benchmark and Copy start for a built-in
 * (kodo/doc/AGENT_BUILDER.md §8, D23). */
function BuiltinRow({ agent, copyable, onBenchmark, onCopy }: {
  agent: TopBuiltinEntry;
  copyable: boolean;
  onBenchmark: OnBenchmark;
  onCopy: (name: string) => void;
}) {
  return (
    <div className="builtin-agent-row">
      <div className="skill-name" title={agent.name}>{agent.label || agent.name}</div>
      <div className="skill-description" title={agent.description}>{agent.description}</div>
      <div className="session-icons">
        <BenchmarkButtons
          name={agent.name}
          label={agent.label || agent.name}
          enabled
          onBenchmark={onBenchmark}
        />
        <button
          className="icon-btn secondary-btn"
          disabled={!copyable}
          title={copyable
            ? 'Copy: make an editable copy of this agent, with every sub-agent it uses'
            : 'This agent cannot be copied'}
          onClick={() => onCopy(agent.name)}
        >
          ⧉
        </button>
      </div>
    </div>
  );
}

interface AgentsSectionProps {
  agents: AgentsState;
  onInstallClick: () => void;
  onCopyClick: (name?: string) => void;
  onValidate: (name: string) => void;
  onBenchmark: OnBenchmark;
}

export function AgentsSection({
  agents, onInstallClick, onCopyClick, onValidate, onBenchmark,
}: AgentsSectionProps) {
  const copyable = new Set(agents.builtins.map((b) => b.name));
  return (
    <div>
      <h2>Agents</h2>
      <p className="intro-text">
        Agents you install yourself, alongside the ones Kōdo ships. A top-level agent appears in
        the agent picker; a sub-agent is one another agent delegates to, and is shared by every
        agent you install. Install from a local folder or a git repository below, or by hand by
        copying a bundle into <code>{agents.root || '~/.kodo/agents'}</code> and using Reload —
        either way no restart is needed. Names beginning <code>kodo_</code> are reserved for the
        built-in agents. To change how a built-in works, copy it — with every sub-agent it uses —
        and edit the copy.
      </p>
      {agents.topBuiltins.length > 0 && (
        <>
          <h3>Built-in agents</h3>
          <div className="rule-table">
            {agents.topBuiltins.map((b) => (
              <BuiltinRow
                key={b.name}
                agent={b}
                copyable={copyable.has(b.name)}
                onBenchmark={onBenchmark}
                onCopy={onCopyClick}
              />
            ))}
          </div>
          <h3>Your agents</h3>
        </>
      )}
      <p>
        <button className="secondary-btn" onClick={() => onCopyClick()}>
          Copy a built-in agent…
        </button>{' '}
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
            <div className="agent-lint">Lint</div>
            <div className="skill-description">Description</div>
            <div className="session-icons" />
          </div>
          {agents.agents.map((a) => (
            <AgentRow
              key={`${a.kind}:${a.name}`}
              agent={a}
              onValidate={onValidate}
              onBenchmark={onBenchmark}
            />
          ))}
        </div>
      )}
    </div>
  );
}
