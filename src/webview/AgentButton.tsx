import { useEffect } from 'preact/hooks';
import { styles } from './styles';
import { vscode } from './vscode';
import type { AgentRow } from './types';
import { MenuGroup, MenuOption, frozenNote, useMenuPopup } from './MenuPrimitives';

/** A top-level agent's picker label, or `null` if `name` isn't in the catalog
 *  yet (or ever — `judge` is registered but deliberately left out of it since
 *  it isn't selectable). `null` rather than falling back to the bare wire
 *  value (`"kodo_problem_solver"`): that value is an internal identifier, not
 *  something to ever show a user, not even for the brief gap before the very
 *  first `top_agents.list.ack` of the connection arrives (negligible in
 *  practice — `session/controller.ts` requests it eagerly right after
 *  `hello.ack`, not only when this popup opens — but still real). Callers
 *  render their own neutral placeholder for `null`. */
function agentLabel(agents: AgentRow[], name: string): string | null {
  return agents.find((a) => a.name === name)?.label ?? null;
}

interface AgentButtonProps {
  /** The selected top-level agent's name, and the one the in-flight prompt
   *  is actually running under. */
  topAgent: string;
  effectiveTopAgent: string;
  /** Selectable agents in picker order — kodo-vsix's own cached copy of the
   *  catalog, replaced wholesale by each `top_agents.list.ack` (never merged:
   *  a since-deleted user agent must disappear from here too). */
  agents: AgentRow[];
  connected: boolean;
  /** True while a turn is in flight; gates the "queued" note. */
  running: boolean;
}

/**
 * The "Agent: <name>" button and its single-group popup — split out of
 * Session Parameters so the picker's own catalog fetch (doc/WS_PROTOCOL.md
 * §7.4g `top_agents.list`) is scoped to opening *this* button, not bundled
 * into the unrelated Mode/Edit/Tool/Thinking groups.
 *
 * Every time the popup opens, this asks the host for a fresh catalog
 * (`agents_refresh`) — kodo-vsix's own `agents` cache (owned by
 * `ModeToggleController`, threaded through `mode_state` like before, and
 * already populated once right after connect — see `controller.ts`'s
 * `_onHelloAck`) already renders immediately from whatever it last knew, and
 * is replaced wholesale the moment the reply lands, so an agent installed or
 * deleted mid-session shows up (or disappears) the next time this button is
 * clicked, without a reload.
 */
export function AgentButton({ topAgent, effectiveTopAgent, agents, connected, running }: AgentButtonProps) {
  const { open, setOpen, wrapRef, menuStyle } = useMenuPopup(connected);

  useEffect(() => {
    if (open) {
      vscode.postMessage({ type: 'agents_refresh' });
    }
  }, [open]);

  const label = agentLabel(agents, topAgent);

  return (
    <div style={styles.sessionBtnWrap} ref={wrapRef}>
      <button
        type="button"
        style={connected ? styles.sessionBtn : { ...styles.sessionBtn, ...styles.sessionBtnDisabled }}
        disabled={!connected}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* No colon-plus-name form for the `null` case: "Agent: Agent" would
            read as a mistake rather than a placeholder. */}
        {label === null ? 'Agent' : `Agent: ${label}`}
      </button>
      {open && (
        <div style={menuStyle} role="menu" aria-label="Agent settings">
          <MenuGroup
            title="Agent"
            note={frozenNote(
              running && topAgent !== effectiveTopAgent,
              agentLabel(agents, effectiveTopAgent) ?? 'that agent',
            )}
          >
            {agents.map((agent) => (
              <MenuOption
                key={agent.name}
                label={agent.label}
                desc={agent.description}
                selected={agent.name === topAgent}
                disabled={false}
                onSelect={() => vscode.postMessage({ type: 'agent_set', name: agent.name })}
              />
            ))}
          </MenuGroup>
        </div>
      )}
    </div>
  );
}
