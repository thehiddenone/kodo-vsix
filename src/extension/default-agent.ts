/** The `default_agent` settings block (kodo/doc/SETTINGS.md §2.8,
 * kodo/doc/WS_PROTOCOL.md §7.6k) backing the Kōdo Settings panel's
 * "General" section: defaults, wire-payload parsing, and the fetch. */

import * as vscode from 'vscode';
import type { DefaultAgentSettings, TopAgentOption } from '../settings-panel/types';
import { sendControlAwait } from './control-send';

/** No known catalog yet — the fallback on a fetch error. Both names are empty
 * rather than guessed: which agents exist, and which one a new session starts
 * on, are entirely the server's answer, so an unreachable server just means the
 * "Default agent" subsection renders no choices yet. */
export const DEFAULT_AGENT_SETTINGS: DefaultAgentSettings = {
  selected: '',
  effective: '',
  agents: [],
};

function parseAgent(raw: unknown): TopAgentOption | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const a = raw as Record<string, unknown>;
  const name = String(a.name ?? '');
  if (!name) {
    return null;
  }
  return {
    name,
    label: typeof a.label === 'string' && a.label ? a.label : name,
    description: String(a.description ?? ''),
  };
}

/** Parse a `default_agent.get.ack` payload — defensively coerces every field,
 * same style as `parseHousekeeperLlm`. */
export function parseDefaultAgent(raw: Record<string, unknown>): DefaultAgentSettings {
  const rawAgents = Array.isArray(raw.agents) ? raw.agents : [];
  return {
    selected: typeof raw.selected === 'string' ? raw.selected : '',
    effective: typeof raw.effective === 'string' ? raw.effective : '',
    agents: rawAgents.map(parseAgent).filter((a): a is TopAgentOption => a !== null),
  };
}

/** Fetch the current `default_agent` settings from the server. Returns
 * `DEFAULT_AGENT_SETTINGS` (and shows a toast) if the server is unreachable —
 * the caller opens/refreshes the panel either way. */
export async function fetchDefaultAgent(): Promise<DefaultAgentSettings> {
  try {
    const resp = await sendControlAwait('default_agent.get');
    return parseDefaultAgent(resp);
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to load the default agent setting.');
    return DEFAULT_AGENT_SETTINGS;
  }
}
