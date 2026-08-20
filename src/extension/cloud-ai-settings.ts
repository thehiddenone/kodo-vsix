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
import { sendControl, sendControlAwait } from './control-send';
import {
  readBedrockRegion,
  readCloudModels,
  readMetaContributorTier,
  readOpenRouterAutoMode,
  readSettings,
  writeSettings,
} from './settings-io';
import { state } from './state';
import { broadcastThinkingContext } from './thinking-context';

/** One entry per vendor in `cloudRegistryState`, keyed by vendor. */
export function cloudAiStateForPanel(): {
  cloudRegistry: CloudRegistry;
  modelsByVendor: Record<string, Record<string, string>>;
  keysByVendor: Record<string, cloudCredentials.ApiKeyEntry[]>;
  metaContributorTier: boolean;
  openRouterCatalog: import('../llm-registry-types').OpenRouterModelInfo[];
  openRouterAutoMode: boolean;
  bedrockCatalog: import('../llm-registry-types').BedrockModelInfo[];
  bedrockRegion: string;
} {
  const keysByVendor: Record<string, cloudCredentials.ApiKeyEntry[]> = {};
  for (const vendor of Object.keys(state.cloudRegistryState)) {
    keysByVendor[vendor] = cloudCredentials.listKeys(vendor);
  }
  // OpenRouter has no cloudRegistryState entry (kodo has no compiled-in model
  // tuple for it) but is still a real vendor an API key can be added for —
  // make sure it always has a (possibly empty) key list.
  if (!('openrouter' in keysByVendor)) {
    keysByVendor.openrouter = cloudCredentials.listKeys('openrouter');
  }
  // Same for Bedrock — no cloudRegistryState entry (its catalog is fetched,
  // not compiled in), but a real vendor whose credentials live in the same
  // named-multi-key store as everyone else's.
  if (!('bedrock' in keysByVendor)) {
    keysByVendor.bedrock = cloudCredentials.listKeys('bedrock');
  }
  return {
    cloudRegistry: state.cloudRegistryState,
    modelsByVendor: readCloudModels(),
    keysByVendor,
    metaContributorTier: readMetaContributorTier(),
    openRouterCatalog: state.openRouterCatalogState,
    openRouterAutoMode: readOpenRouterAutoMode(),
    bedrockCatalog: state.bedrockCatalogState,
    bedrockRegion: readBedrockRegion(),
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
  // Each cloud vendor has its own thinking-tier family (kodo/doc/
  // LLM_REGISTRY.md §4.5a), so switching vendors changes which tiers the
  // footer's Thinking Level toggle offers -- same reason setMode already
  // does this for the local/cloud switch.
  broadcastThinkingContext();
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

/** OpenRouter's account-wide "Auto mode" toggle (kodo/doc/SETTINGS.md §2.2b,
 *  kodo/doc/LLM_REGISTRY.md §3a) -- when enabled, every effort tier resolves
 *  to the router pseudo-model "openrouter/auto" server-side regardless of
 *  `models.cloud.openrouter`, which is deliberately left untouched (not
 *  overwritten) so re-disabling Auto restores whatever was picked per-tier
 *  in Manual mode. Same plain-settings-write + `config.reload` pattern as
 *  `setMetaContributorTier` above -- no server-side validation to run beyond
 *  a boolean, so no dedicated WS command either. */
export function setOpenRouterAutoMode(enabled: boolean): void {
  writeSettings({ openrouter_auto_mode: enabled });
  sendControl(makeRequest('config.reload'));
  pushCloudAiSettingsState();
}

/** Re-fetch OpenRouter's model catalog on demand (kodo/doc/WS_PROTOCOL.md
 *  §7.6h) -- backs the OpenRouter tab's "Refresh model list" button, an
 *  alternative to the server's own 12-hour background TTL refresh. Unlike
 *  most of this file's setters, this is a real round trip (one OpenRouter
 *  API call server-side), so it's async and the caller can show a busy
 *  state around it if desired. */
export async function refreshOpenRouterCatalog(): Promise<void> {
  const resp = await sendControlAwait('openrouter.models.refresh', {});
  if (Array.isArray(resp.models)) {
    state.openRouterCatalogState = resp.models as import('../llm-registry-types').OpenRouterModelInfo[];
  }
  pushCloudAiSettingsState();
}

/** The AWS region Bedrock is called in (kodo/doc/SETTINGS.md §2.2c). Same
 *  plain-settings-write + `config.reload` pattern as the toggles above, plus
 *  one extra step: the model catalog is region-scoped server-side, so the
 *  cache for the *previous* region reads as empty and the picker must be
 *  refilled. */
export function setBedrockRegion(region: string): void {
  writeSettings({ bedrock_region: region });
  sendControl(makeRequest('config.reload'));
  // The cached catalog belongs to the old region — drop it immediately so the
  // picker doesn't offer models that may not exist in the new one while the
  // refresh is in flight.
  state.bedrockCatalogState = [];
  pushCloudAiSettingsState();
  void maybeRefreshBedrockCatalog();
}

/** Re-fetch Bedrock's model catalog for the configured region (kodo/doc/
 *  WS_PROTOCOL.md §7.6i) — backs the Bedrock tab's "Refresh model list"
 *  button.
 *
 *  Unlike every other command in this file, this one **sends credentials**:
 *  `ListFoundationModels` is a signed AWS call and the server holds no
 *  Bedrock credentials of its own, while a control-connection handler has no
 *  session response channel to pull them over. The blob sent here is exactly
 *  what an `api_key.request` for this vendor would be answered with, over the
 *  same local WebSocket.
 *
 *  Resolves the *active* key without falling back to the interactive add
 *  flow: a catalog refresh must never pop a credential prompt (see
 *  `maybeRefreshBedrockCatalog`, which runs unattended on every `hello.ack`).
 *  Returns `false` when there was no key to send. */
export async function refreshBedrockCatalog(): Promise<boolean> {
  if (!state.extensionContext) {
    return false;
  }
  const apiKey = await cloudCredentials.getActiveKey(state.extensionContext, 'bedrock');
  if (!apiKey) {
    return false;
  }
  const resp = await sendControlAwait('bedrock.models.refresh', {
    api_key: apiKey,
    region: readBedrockRegion(),
  });
  if (Array.isArray(resp.models)) {
    state.bedrockCatalogState = resp.models as import('../llm-registry-types').BedrockModelInfo[];
  }
  pushCloudAiSettingsState();
  return true;
}

/** Fetch the Bedrock catalog if it's missing and we have a key to fetch it
 *  with — the unattended counterpart of `refreshBedrockCatalog`.
 *
 *  Called on every `hello.ack` and after a region change or a new key. Silent
 *  in every failure mode on purpose: a window with no Bedrock credentials
 *  configured (the common case) must not be nagged, and a server that isn't
 *  reachable will get another chance on the next `hello.ack`. */
export async function maybeRefreshBedrockCatalog(): Promise<void> {
  if (state.bedrockCatalogState.length > 0) {
    return;
  }
  try {
    await refreshBedrockCatalog();
  } catch {
    // Non-fatal — see the doc comment.
  }
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
  // A Bedrock key that was just added is also what the (credential-gated)
  // model catalog fetch needs, and the picker is empty until it lands.
  if (vendor === 'bedrock') {
    void maybeRefreshBedrockCatalog();
  }
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
