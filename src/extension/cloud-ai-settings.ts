/**
 * The cloud AI vendor tabs' data (former standalone Cloud AI Settings panel)
 * and the API-key request flow the server's `api_key.request` triggers.
 */

import * as vscode from 'vscode';
import * as cloudCredentials from '../cloud-credentials';
import { makeRequest, makeResponse } from '../envelope';
import type { Envelope } from '../envelope';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { CloudRegistry, EffortLevel } from '../llm-registry-types';
import { sendControl } from './control-send';
import { readCloudModels, readMetaContributorTier, readSettings, writeSettings } from './settings-io';
import { state } from './state';

/** One entry per vendor in `cloudRegistryState`, keyed by vendor. */
export function cloudAiStateForPanel(): {
  cloudRegistry: CloudRegistry;
  modelsByVendor: Record<string, Record<string, string>>;
  keysByVendor: Record<string, cloudCredentials.ApiKeyEntry[]>;
  metaContributorTier: boolean;
} {
  const keysByVendor: Record<string, cloudCredentials.ApiKeyEntry[]> = {};
  for (const vendor of Object.keys(state.cloudRegistryState)) {
    keysByVendor[vendor] = cloudCredentials.listKeys(vendor);
  }
  return {
    cloudRegistry: state.cloudRegistryState,
    modelsByVendor: readCloudModels(),
    keysByVendor,
    metaContributorTier: readMetaContributorTier(),
  };
}

/** Push the cloud vendor tabs' fields into the Kōdo Settings panel — a no-op
 * if the panel isn't open, same pattern as `pushLocalInferenceState` in
 * local-llm-registry.ts. */
export function pushCloudAiSettingsState(): void {
  KodoSettingsPanel.instance?.update(cloudAiStateForPanel());
}

export function setActiveCloudVendor(vendor: string): void {
  writeSettings({ active_cloud_vendor: vendor });
  sendControl(makeRequest('config.reload'));
  state.activeCloudVendorState = vendor;
  state.sidebarProvider?.update({ activeCloudVendor: vendor });
}

export function setCloudModel(vendor: string, effort: EffortLevel, modelId: string): void {
  const models = (readSettings()['models'] as Record<string, unknown> | undefined) ?? {};
  const cloud = (models['cloud'] as Record<string, unknown> | undefined) ?? {};
  const vendorMap = (cloud[vendor] as Record<string, string> | undefined) ?? {};
  vendorMap[effort] = modelId;
  cloud[vendor] = vendorMap;
  models['cloud'] = cloud;
  writeSettings({ models });
  sendControl(makeRequest('config.reload'));
  pushCloudAiSettingsState();
}

/** Meta's account-wide "contributor" pricing tier (kodo/doc/SETTINGS.md
 *  §2.2a, kodo/doc/LLM_REGISTRY.md §3) -- trades a heavy discount for
 *  permission to train future Meta models on the account's traffic. Same
 *  plain-settings-write + `config.reload` pattern as `setActiveCloudVendor`/
 *  `setCloudModel` above: no server-side validation to run, so no dedicated
 *  WS command. Read fresh by `kodo/runtime/_engine/_llm.py`'s Meta vendor
 *  factory on every plugin resolution. */
export function setMetaContributorTier(enabled: boolean): void {
  writeSettings({ meta_contributor_tier: enabled });
  sendControl(makeRequest('config.reload'));
  pushCloudAiSettingsState();
}

// ---------------------------------------------------------------------------
// Cloud API keys: named/multi-key management lives in cloud-credentials.ts
// (kodo/doc/LLM_REGISTRY.md §6) — this just answers the server's pull
// requests from whichever key is active, falling back to the reactive
// add-a-key flow when the vendor has none configured yet.
// ---------------------------------------------------------------------------

export async function handleApiKeyRequest(
  vendor: string,
  requestId: string,
  send: (env: Envelope) => void,
): Promise<void> {
  if (!state.extensionContext) {
    return;
  }

  const key = await cloudCredentials.resolveApiKey(state.extensionContext, vendor);
  pushCloudAiSettingsState();
  if (key) {
    send(makeResponse(requestId, { api_key: key }));
    return;
  }

  vscode.window.showErrorMessage(
    `Kōdo: prompt not sent. A ${vendor} API key is required to use cloud-based LLM. ` +
      'Alternatively, you can configure Kōdo to use a local model running on your machine (e.g., llama.cpp).',
  );
  send(makeResponse(requestId, { error: 'cancelled' }));
}
