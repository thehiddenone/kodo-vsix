import { ActionsMenu } from './ActionsMenu';
import type { MenuAction } from './ActionsMenu';
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

/** The Basics test and Benchmark actions (kodo/doc/AGENT_BUILDER.md §8). Only
 * a selectable top-level agent that loads can run alone, so for any other row
 * the caller leaves these out of its menu. */
function benchmarkActions(name: string, label: string, onBenchmark: OnBenchmark): MenuAction[] {
  return [
    {
      glyph: '🧪',
      label: 'Basics test',
      description: 'Seven small tasks in Docker check that the prompt makes the agent follow '
        + 'instructions and use its tools',
      onSelect: () => onBenchmark(name, label, 'basics'),
    },
    {
      glyph: '📊',
      label: 'Benchmark',
      description: 'Run a Harbor suite on this agent in a new session tab',
      onSelect: () => onBenchmark(name, label, 'benchmark'),
    },
  ];
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
  const label = agent.label || agent.name;
  const actions: MenuAction[] = [
    ...(agent.selectable && !broken ? benchmarkActions(agent.name, label, onBenchmark) : []),
    {
      glyph: '🩺',
      label: 'Validate',
      description: 'Check that it loads, and see what the lint says about its prompt',
      onSelect: () => onValidate(agent.name),
    },
    {
      glyph: '🤖',
      label: 'Review with AI',
      description: "A new session has Agent Critic check this agent against Kōdo's "
        + 'prompt-writing rules and list each concern',
      onSelect: () => vscode.postMessage({ type: 'review_agent', name: agent.name }),
    },
    {
      glyph: '📁',
      label: 'Open folder',
      description: "Open this agent's folder in a new window",
      onSelect: () => vscode.postMessage({ type: 'open_agent', path: agent.path }),
    },
    {
      glyph: '🗑',
      label: 'Delete',
      description: 'Delete this agent from disk, after you confirm',
      onSelect: () => vscode.postMessage({ type: 'delete_agent', name: agent.name, kind: agent.kind }),
    },
  ];
  return (
    <div className="agent-row">
      <div className="skill-name" title={agent.path}>
        {label}
      </div>
      <div className="agent-kind">{agent.kind}</div>
      <div className="agent-version">{agent.version || '—'}</div>
      <LintCell agent={agent} />
      <div className={'skill-description' + (broken ? ' skill-error' : '')} title={detail}>
        {detail}
      </div>
      <div className="agent-actions">
        <ActionsMenu actions={actions} />
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
  // Every row here is a selectable top-level agent (`top_builtins`), so it can
  // always be benchmarked.
  const actions = benchmarkActions(agent.name, agent.label || agent.name, onBenchmark);
  if (copyable) {
    actions.push({
      glyph: '⧉',
      label: 'Copy',
      description: 'Make an editable copy of this agent, with every sub-agent it uses',
      onSelect: () => onCopy(agent.name),
    });
  }
  return (
    <div className="builtin-agent-row">
      <div className="skill-name" title={agent.name}>{agent.label || agent.name}</div>
      <div className="skill-description" title={agent.description}>{agent.description}</div>
      <div className="agent-actions">
        <ActionsMenu actions={actions} />
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
            <div className="agent-actions" />
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
