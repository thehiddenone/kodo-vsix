/** Global allow-rules: parsing the wire shape and fetching the current set. */

import * as vscode from 'vscode';
import type { GlobalRuleEntry } from '../settings-panel/types';
import { sendControlAwait } from './control-send';

/** Parse a `rules` payload shared by both the global and session-scoped rule
 * commands' `.list.ack`/`.delete.ack` (kodo/doc/WS_PROTOCOL.md §7.6c/§7.6e)
 * — malformed/unknown entries are dropped rather than shown as broken rows. */
export function parseRuleEntries(raw: unknown): GlobalRuleEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: GlobalRuleEntry[] = [];
  for (const entry of raw as unknown[]) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const executable = typeof rec.executable === 'string' ? rec.executable : '';
    const value = typeof rec.value === 'string' ? rec.value : '';
    if (!executable || !value) {
      continue;
    }
    out.push({ kind: rec.kind === 'path' ? 'path' : 'command', executable, value });
  }
  return out;
}

/** Fetch the current global rule set from the server. Returns `[]` (and shows
 * a toast) if the server is unreachable — the caller opens/refreshes the panel
 * either way. */
export async function fetchGlobalRules(): Promise<GlobalRuleEntry[]> {
  try {
    const resp = await sendControlAwait('security.rules.list');
    return parseRuleEntries(resp.rules);
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to load global allow-rules.');
    return [];
  }
}
