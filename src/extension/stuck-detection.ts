/** The `stuck_detection` settings block (kodo/doc/SETTINGS.md §2.6,
 * kodo/doc/WS_PROTOCOL.md §7.6d) backing the Kōdo Settings panel's
 * "General" section: defaults, wire-payload parsing, and the fetch. */

import * as vscode from 'vscode';
import type { StuckDetectionSettings } from '../settings-panel/types';
import { sendControlAwait } from './control-send';

/** Same documented defaults as `kodo/server/_config.py`'s
 * `_DEFAULT_USER_SETTINGS["stuck_detection"]` — used both as the fallback on
 * a fetch error and to defensively coerce a malformed `.ack` payload. */
export const DEFAULT_STUCK_DETECTION: StuckDetectionSettings = {
  active: 'local_only',
  scope: 'top_level',
  auto_unstuck_interactive: false,
};

/** Parse a `stuck_detection.get.ack`/`.set.ack` payload (kodo/doc/WS_PROTOCOL.md
 * §7.6d) — an unrecognised/missing field falls back to its documented default,
 * same defensive style as `parseRuleEntries`. */
export function parseStuckDetection(raw: Record<string, unknown>): StuckDetectionSettings {
  const active = raw.active;
  const scope = raw.scope;
  return {
    active: active === 'off' || active === 'local_only' || active === 'local_and_cloud'
      ? active : DEFAULT_STUCK_DETECTION.active,
    scope: scope === 'top_level' || scope === 'top_level_and_subagents'
      ? scope : DEFAULT_STUCK_DETECTION.scope,
    auto_unstuck_interactive: Boolean(raw.auto_unstuck_interactive),
  };
}

/** Fetch the current `stuck_detection` settings from the server. Returns the
 * documented defaults (and shows a toast) if the server is unreachable — the
 * caller opens/refreshes the panel either way. */
export async function fetchStuckDetection(): Promise<StuckDetectionSettings> {
  try {
    const resp = await sendControlAwait('stuck_detection.get');
    return parseStuckDetection(resp);
  } catch {
    vscode.window.showErrorMessage('Kōdo: could not reach the server to load stuck-detection settings.');
    return DEFAULT_STUCK_DETECTION;
  }
}
