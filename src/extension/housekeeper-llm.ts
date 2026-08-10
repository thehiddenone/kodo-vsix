/** The `housekeeper_llm` settings block (kodo/doc/SETTINGS.md §2.7,
 * kodo/doc/WS_PROTOCOL.md §7.6f) backing the Kōdo Settings panel's
 * "General" section: defaults, wire-payload parsing, and the fetch. */

import * as vscode from 'vscode';
import type { HousekeeperLlmOption, HousekeeperLlmSettings } from '../settings-panel/types';
import { sendControlAwait } from './control-send';

/** No known selection/catalog yet — used as the fallback on a fetch error.
 * Unlike `DEFAULT_STUCK_DETECTION`, there is no meaningful client-side
 * default `selected` id to fall back to (the catalog itself is server-owned,
 * kodo.titling.HOUSEKEEPER_LLM_OPTIONS) — an unreachable server just means
 * the "Housekeeper LLM" subsection renders no radio buttons yet. */
export const DEFAULT_HOUSEKEEPER_LLM: HousekeeperLlmSettings = {
  selected: '',
  options: [],
};

function parseOption(raw: unknown): HousekeeperLlmOption | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  return {
    id: String(o.id ?? ''),
    name: String(o.name ?? ''),
    description: String(o.description ?? ''),
  };
}

/** Parse a `housekeeper_llm.get.ack` payload (kodo/doc/WS_PROTOCOL.md §7.6f)
 * — defensively coerces every field, same style as `parseStuckDetection`. */
export function parseHousekeeperLlm(raw: Record<string, unknown>): HousekeeperLlmSettings {
  const selected = typeof raw.selected === 'string' ? raw.selected : '';
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions
    .map(parseOption)
    .filter((o): o is HousekeeperLlmOption => o !== null);
  return { selected, options };
}

/** Fetch the current `housekeeper_llm` settings from the server. Returns
 * `DEFAULT_HOUSEKEEPER_LLM` (and shows a toast) if the server is
 * unreachable — the caller opens/refreshes the panel either way. */
export async function fetchHousekeeperLlm(): Promise<HousekeeperLlmSettings> {
  try {
    const resp = await sendControlAwait('housekeeper_llm.get');
    return parseHousekeeperLlm(resp);
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to load the housekeeper LLM setting.');
    return DEFAULT_HOUSEKEEPER_LLM;
  }
}
