/**
 * JSON Schemas for user agent files (kodo doc/AGENT_BUILDER.md §4, D25).
 *
 * The server writes `top_agent.schema.json` and `subagent_spec.schema.json` to
 * `~/.kodo/etc/agent_schemas/` on every start. Neither agent JSON file can name
 * its schema with `$schema` (the loaders refuse unknown keys), so on activation
 * this module maps the two schemas onto the user agent globs in the
 * **user-level** `json.schemas` setting. VS Code's JSON language service then
 * gives completion and inline errors while a user edits an agent by hand.
 *
 * Our two entries are identified by their `url`: activation rewrites them in
 * place, never duplicates them, and never touches an entry it did not write.
 * The `contributes.jsonValidation` point cannot do this job — its `fileMatch`
 * cannot name the user's home directory.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface JsonSchemaEntry {
  url?: string;
  fileMatch?: string[];
  [key: string]: unknown;
}

/** The two entries this extension owns in `json.schemas`, for *home*. */
export function agentSchemaEntries(home: string): JsonSchemaEntry[] {
  const kodo = path.join(home, '.kodo');
  const schemas = path.join(kodo, 'etc', 'agent_schemas');
  // Globs from the URI path, not the OS path: VS Code matches `fileMatch`
  // against document URIs, which use `/` and a lowercase drive letter.
  const agents = vscode.Uri.file(path.join(kodo, 'agents')).path;
  return [
    {
      url: vscode.Uri.file(path.join(schemas, 'top_agent.schema.json')).toString(),
      fileMatch: [`${agents}/*/*.json`],
    },
    {
      url: vscode.Uri.file(path.join(schemas, 'subagent_spec.schema.json')).toString(),
      fileMatch: [`${agents}/subagents/*/*.json`],
    },
  ];
}

/**
 * *existing* with *ours* merged in: an entry with one of our urls is replaced
 * in place, a missing one is appended, every other entry is kept as it is.
 * Returns `undefined` when nothing would change, so the caller skips a write.
 */
export function mergeAgentSchemaEntries(
  existing: readonly JsonSchemaEntry[],
  ours: readonly JsonSchemaEntry[],
): JsonSchemaEntry[] | undefined {
  const byUrl = new Map(ours.map((entry) => [entry.url, entry]));
  const placed = new Set<string | undefined>();
  const merged: JsonSchemaEntry[] = [];
  for (const entry of existing) {
    const mine = byUrl.get(entry.url);
    if (mine === undefined) {
      merged.push(entry);
    } else if (!placed.has(entry.url)) {
      // A duplicate of one of ours (a hand copy, an older race) collapses into one.
      merged.push(mine);
      placed.add(entry.url);
    }
  }
  for (const entry of ours) {
    if (!placed.has(entry.url)) {
      merged.push(entry);
    }
  }
  return JSON.stringify(merged) === JSON.stringify(existing) ? undefined : merged;
}

/** Register the agent schemas in the user's `json.schemas` setting. */
export async function registerAgentSchemas(): Promise<void> {
  const config = vscode.workspace.getConfiguration('json');
  const existing = config.inspect<JsonSchemaEntry[]>('schemas')?.globalValue ?? [];
  const merged = mergeAgentSchemaEntries(existing, agentSchemaEntries(os.homedir()));
  if (merged !== undefined) {
    await config.update('schemas', merged, vscode.ConfigurationTarget.Global);
  }
}
