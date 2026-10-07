/**
 * Parsing for `local_llm.hf_search.ack` (kodo/doc/WS_PROTOCOL.md §7.6m) — the
 * reply behind the "Add local LLM (GGUF) from huggingface.com" dialog's
 * search-as-you-type list. Kept free of `vscode` imports so it unit-tests
 * without an extension host.
 */

import type { HfSearchHit, HfSearchResult } from '../settings-panel/types';

const TIERS: readonly HfSearchHit['publisher_tier'][] = ['top', 'known', 'other'];

function str(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value : '';
}

function count(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** One reply row, or `null` for a row without a repo id. An unknown
 *  `publisher_tier` reads as `'other'`, so a server that grows a tier never
 *  promotes a repo here. */
function parseHit(raw: unknown): HfSearchHit | null {
  if (!raw || typeof raw !== 'object') { return null; }
  const row = raw as Record<string, unknown>;
  const repoId = str(row, 'repo_id');
  if (!repoId) { return null; }
  const tier = str(row, 'publisher_tier') as HfSearchHit['publisher_tier'];
  return {
    repo_id: repoId,
    author: str(row, 'author'),
    publisher_tier: TIERS.includes(tier) ? tier : 'other',
    downloads: count(row, 'downloads'),
    likes: count(row, 'likes'),
    gated: row.gated === true,
    last_modified: str(row, 'last_modified'),
    base_model: str(row, 'base_model'),
    license: str(row, 'license'),
    in_catalog: row.in_catalog === true,
  };
}

/** The panel's `hfSearch` state for a reply to a search sent as `query`.
 *  Row order is the server's ranking and is kept as is. */
export function parseHfSearchReply(query: string, resp: Record<string, unknown>): HfSearchResult {
  const rows = Array.isArray(resp.results) ? resp.results : [];
  return {
    query,
    results: rows.map(parseHit).filter((hit): hit is HfSearchHit => hit !== null),
    error: typeof resp.error === 'string' ? resp.error : '',
  };
}
