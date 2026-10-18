/**
 * The Kōdo Settings panel's Benchmark and Basics test modal reads its options
 * from here (kodo doc/AGENT_BUILDER.md §8, doc/BENCHMARK_SESSIONS.md §5).
 *
 * The run itself is not started here: Run opens a new session tab that sends
 * `harbor.run`, and the Kōdo server runs `kodo-harbor` and shows the run in
 * that tab (`newSession({ kind: 'benchmark', … })`). The former terminal
 * launcher is gone (BENCHMARK_SESSIONS.md D6).
 *
 * Credentials (D37): the server reports a cloud model's `credential` from its
 * own environment, but a key entered in Kōdo's Cloud AI settings lives in VS
 * Code's secret storage. So a model the server marks keyless is offered when
 * a key is stored; the server then asks this window for it with
 * `api_key.request` when the run starts.
 */

import * as cloudCredentials from '../cloud-credentials';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { HarborModelOption, HarborOptionsResult } from '../settings-panel/types';
import { sendControlAwait } from './control-send';
import { state } from './state';

async function storedKey(vendor: string): Promise<string | undefined> {
  const context = state.extensionContext;
  return context ? cloudCredentials.getActiveKey(context, vendor) : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** Fetch `harbor.options` for the modal, widening each cloud model's
 *  `credential` with the keys kept in Kōdo's Cloud AI settings (D37). */
export async function fetchHarborOptionsForPanel(): Promise<void> {
  const failed = (error: string): HarborOptionsResult => ({
    ok: false, error, models: [], suites: [], basicsSuite: '', controls: [],
    llamaRunning: false, llamaModel: '',
  });
  let resp: Record<string, unknown>;
  try {
    resp = await sendControlAwait('harbor.options', {}, 30_000);
  } catch {
    KodoSettingsPanel.instance?.update({ harborOptions: failed('Could not reach the Kōdo server.') });
    return;
  }
  if (resp.ok !== true) {
    KodoSettingsPanel.instance?.update({ harborOptions: failed(String(resp.error ?? 'unknown error')) });
    return;
  }
  const rows = Array.isArray(resp.models) ? (resp.models as Record<string, unknown>[]) : [];
  const stored = new Map<string, boolean>();
  const models: HarborModelOption[] = [];
  for (const row of rows) {
    const vendor = String(row.vendor ?? '');
    let credential = typeof row.credential === 'boolean' ? row.credential : null;
    if (vendor) {
      if (credential === false) {
        if (!stored.has(vendor)) {
          stored.set(vendor, (await storedKey(vendor)) !== undefined);
        }
        credential = stored.get(vendor) === true;
      }
    }
    models.push({
      model: String(row.model ?? ''),
      kind: String(row.kind ?? 'local'),
      description: String(row.description ?? ''),
      credential,
      vendor,
      thinkingTiers: strings(row.thinking_tiers),
      defaultThinkingTier: String(row.default_thinking_tier ?? ''),
      control: row.control === true,
    });
  }
  const suites = Array.isArray(resp.suites) ? (resp.suites as Record<string, unknown>[]) : [];
  KodoSettingsPanel.instance?.update({
    harborOptions: {
      ok: true,
      error: '',
      models,
      suites: suites.map((s) => ({ name: String(s.name ?? ''), description: String(s.description ?? '') })),
      basicsSuite: String(resp.basics_suite ?? ''),
      controls: strings(resp.controls),
      llamaRunning: resp.llama_running === true,
      llamaModel: String(resp.llama_model ?? ''),
    },
  });
}
