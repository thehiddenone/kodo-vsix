/**
 * The cloud AI vendor tabs' data (former standalone Cloud AI Settings panel)
 * and the API-key request flow the server's `api_key.request` triggers.
 */

import * as vscode from 'vscode';
import * as cloudCredentials from '../cloud-credentials';
import { kodoDiagnostics } from '../diagnostics';
import { makeRequest, makeResponse } from '../envelope';
import type { Envelope } from '../envelope';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { BedrockTokenStatus, CloudRegistry, CloudUniformEntry, EffortLevel } from '../llm-registry-types';
import type { SidebarState } from '../sidebar-provider';
import { getBedrockToken, isBedrockInUse, syncBedrockToken } from './bedrock-token';
import { sendControl, sendControlAwait } from './control-send';
import {
  readBedrockProfile,
  readBedrockRegion,
  readCloudModels,
  readCloudUniform,
  readMetaContributorTier,
  readOpenRouterAutoMode,
  readSettings,
  writeSettings,
} from './settings-io';
import { state } from './state';
import { broadcastThinkingContext } from './thinking-context';
import { captureIntoActiveSession } from './session-llm-capture';

/** Every vendor that takes a stored API key -> its keys.
 *
 *  OpenRouter is special-cased in: it has no `cloudRegistryState` entry (kodo
 *  has no compiled-in model tuple for it — kodo/doc/LLM_REGISTRY.md §3a), yet
 *  it is a real vendor an API key can be added for, so it must always come
 *  back with a (possibly empty) list rather than `undefined`. Bedrock is left
 *  out: it has no stored keys, only a token minted from an AWS profile (§3b). */
function cloudKeysByVendor(): Record<string, cloudCredentials.ApiKeyEntry[]> {
  const keysByVendor: Record<string, cloudCredentials.ApiKeyEntry[]> = {};
  for (const vendor of Object.keys(state.cloudRegistryState)) {
    if (vendor !== 'bedrock') {
      keysByVendor[vendor] = cloudCredentials.listKeys(vendor);
    }
  }
  if (!('openrouter' in keysByVendor)) {
    keysByVendor.openrouter = cloudCredentials.listKeys('openrouter');
  }
  return keysByVendor;
}

/** The cloud model-selection slice of {@link SidebarState} — what the
 *  sidebar's bottom-anchored "Select LLM model" section renders from.
 *
 *  It edits exactly the same two settings maps as the Kōdo Settings Cloud AI
 *  tab (`models.cloud`, `models.cloud_uniform`) through exactly the same
 *  setters below, which is why both surfaces are refreshed together from
 *  {@link pushCloudAiSettingsState}: a model picked in one must never
 *  silently disagree with what the other is showing.
 *
 *  The two fetched catalogs are handed over whole; `SidebarProvider._post`
 *  narrows them to the active vendor before they reach the webview. */
export function cloudModelStateForSidebar(): Pick<
  SidebarState,
  'cloudModels' | 'cloudUniform' | 'openRouterAutoMode' | 'openRouterCatalog' | 'bedrockCatalog' | 'cloudHasKey'
> {
  const cloudHasKey: Record<string, boolean> = {};
  for (const [vendor, keys] of Object.entries(cloudKeysByVendor())) {
    cloudHasKey[vendor] = keys.length > 0;
  }
  cloudHasKey.bedrock = state.bedrockTokenState.hasToken;
  return {
    cloudModels: readCloudModels(),
    cloudUniform: readCloudUniform(),
    openRouterAutoMode: readOpenRouterAutoMode(),
    openRouterCatalog: state.openRouterCatalogState,
    bedrockCatalog: state.bedrockCatalogState,
    cloudHasKey,
  };
}

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
  bedrockProfile: string;
  bedrockProfiles: string[];
  bedrockToken: BedrockTokenStatus;
  cloudUniform: Record<string, CloudUniformEntry>;
} {
  return {
    cloudRegistry: state.cloudRegistryState,
    modelsByVendor: readCloudModels(),
    keysByVendor: cloudKeysByVendor(),
    metaContributorTier: readMetaContributorTier(),
    openRouterCatalog: state.openRouterCatalogState,
    openRouterAutoMode: readOpenRouterAutoMode(),
    bedrockCatalog: state.bedrockCatalogState,
    bedrockRegion: readBedrockRegion(),
    bedrockProfile: readBedrockProfile(),
    bedrockProfiles: state.bedrockProfilesState,
    bedrockToken: state.bedrockTokenState,
    cloudUniform: readCloudUniform(),
  };
}

/** Push the cloud vendor tabs' fields into the Kōdo Settings panel — a no-op
 * if the panel isn't open, same pattern as `pushLocalInferenceState` in
 * local-llm-registry.ts — **and** the same model selection into the sidebar's
 * own "Select LLM model" section.
 *
 * Both surfaces are refreshed from this one function on purpose. Every setter
 * in this file already called it, so wiring the sidebar in here (rather than
 * at each call site) is what guarantees a model picked in either place, a
 * refreshed catalog, or a key that was added/forgotten/pruned shows up in
 * both without anyone having to remember a second push. */
export function pushCloudAiSettingsState(): void {
  KodoSettingsPanel.instance?.update(cloudAiStateForPanel());
  state.sidebarProvider?.update(cloudModelStateForSidebar());
}

export function setActiveCloudVendor(vendor: string): void {
  writeSettings({ active_cloud_vendor: vendor });
  sendControl(makeRequest('config.reload'));
  state.activeCloudVendorState = vendor;
  state.sidebarProvider?.update({ activeCloudVendor: vendor });
  if (vendor === 'bedrock') {
    void maybeRefreshBedrockCatalog();
  }
  // Each cloud vendor has its own thinking-tier family (kodo/doc/
  // LLM_REGISTRY.md §4.5a), so switching vendors changes which tiers the
  // footer's Thinking Level toggle offers -- same reason setMode already
  // does this for the local/cloud switch.
  broadcastThinkingContext();
  captureIntoActiveSession();
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
  captureIntoActiveSession();
}

/** Read-modify-write one vendor's entry in `models.cloud_uniform`, preserving
 *  every other vendor's entry (and the rest of `models`) exactly like
 *  `setCloudModel` does for `models.cloud`. */
function patchCloudUniform(vendor: string, patch: Partial<CloudUniformEntry>): void {
  const models = (readSettings()['models'] as Record<string, unknown> | undefined) ?? {};
  const cloudUniform = (models['cloud_uniform'] as Record<string, unknown> | undefined) ?? {};
  const current = (cloudUniform[vendor] as Record<string, unknown> | undefined) ?? {};
  cloudUniform[vendor] = {
    enabled: current.enabled === true,
    model_id: typeof current.model_id === 'string' ? current.model_id : null,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.modelId !== undefined ? { model_id: patch.modelId } : {}),
  };
  models['cloud_uniform'] = cloudUniform;
  writeSettings({ models });
}

/** Vendor-wide "use one model for all effort levels" shortcut (kodo/doc/
 *  SETTINGS.md's `models.cloud_uniform`, kodo/doc/LLM_REGISTRY.md §3c) --
 *  when enabled, every effort tier resolves to that vendor's
 *  `models.cloud_uniform.<vendor>.model_id` server-side regardless of
 *  `models.cloud.<vendor>`, which is deliberately left untouched (not
 *  overwritten) so re-disabling restores whatever was picked per-tier. Same
 *  non-destructive-override shape as `setOpenRouterAutoMode` above -- no
 *  server-side validation to run beyond a boolean, so no dedicated WS
 *  command either. */
export function setCloudUniformEnabled(vendor: string, enabled: boolean): void {
  patchCloudUniform(vendor, { enabled });
  sendControl(makeRequest('config.reload'));
  pushCloudAiSettingsState();
  captureIntoActiveSession();
}

/** The specific model `setCloudUniformEnabled`'s shortcut resolves to for
 *  *vendor* once enabled. Writable independently of `enabled` -- the picker
 *  works the same whether the checkbox is currently on or off, exactly like
 *  `setCloudModel`'s per-tier pickers do. */
export function setCloudUniformModel(vendor: string, modelId: string): void {
  patchCloudUniform(vendor, { modelId });
  sendControl(makeRequest('config.reload'));
  pushCloudAiSettingsState();
  captureIntoActiveSession();
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
  captureIntoActiveSession();
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
  void reloadForNewBedrockIdentity();
}

/** The AWS profile Bedrock's token is minted from (kodo/doc/SETTINGS.md §2.2c),
 *  `''` for botocore's default credential chain. The catalog is fetched per
 *  account, so a new profile can offer different models. */
export function setBedrockProfile(profile: string): void {
  writeSettings({ bedrock_profile: profile });
  sendControl(makeRequest('config.reload'));
  void reloadForNewBedrockIdentity();
}

/** After a profile or region change: the stored token and the cached catalog
 *  both belong to the old pair, and the user just picked this one, so mint now
 *  rather than at the next turn. A failure shows on the Bedrock tab. */
async function reloadForNewBedrockIdentity(): Promise<void> {
  // Dropped immediately so the picker doesn't offer models that may not exist
  // for the new pair while the refresh is in flight.
  state.bedrockCatalogState = [];
  await syncBedrockToken();
  try {
    await refreshBedrockCatalog();
  } catch {
    // recordFailure already put a token failure on the tab, and a catalog that
    // failed to load stays empty for the Refresh button.
  }
}

/** The AWS profiles on the server's machine, for the Bedrock tab's dropdown. */
export async function refreshBedrockProfiles(): Promise<void> {
  const reply = await sendControlAwait('bedrock.profiles.list');
  if (Array.isArray(reply.profiles)) {
    state.bedrockProfilesState = reply.profiles.map(String);
  }
  pushCloudAiSettingsState();
}

/** Re-fetch Bedrock's model catalog for the configured region (kodo/doc/
 *  WS_PROTOCOL.md §7.6i) — backs the Bedrock tab's "Refresh model list"
 *  button.
 *
 *  Unlike every other command in this file, this one **sends credentials**:
 *  `ListFoundationModels` is an authenticated AWS call and the server holds no
 *  Bedrock credentials of its own, while a control-connection handler has no
 *  session response channel to pull them over. The token sent here is exactly
 *  what an `api_key.request` for this vendor would be answered with, over the
 *  same local WebSocket.
 *
 *  @throws When no token can be minted; the message is for the user. */
export async function refreshBedrockCatalog(): Promise<void> {
  const region = readBedrockRegion();
  const apiKey = await getBedrockToken();
  const resp = await sendControlAwait('bedrock.models.refresh', { api_key: apiKey, region });
  if (Array.isArray(resp.models)) {
    state.bedrockCatalogState = resp.models as import('../llm-registry-types').BedrockModelInfo[];
  }
  pushCloudAiSettingsState();
}

/** Fetch the Bedrock catalog if it's missing — the unattended counterpart of
 *  `refreshBedrockCatalog`.
 *
 *  Called on every `hello.ack`, so it does nothing for a window not using
 *  Bedrock: minting a token there would mean talking to AWS on behalf of a user
 *  of some other vendor. Silent in every failure mode on purpose, since a server
 *  that isn't reachable will get another chance on the next `hello.ack`. */
export async function maybeRefreshBedrockCatalog(): Promise<void> {
  if (state.bedrockCatalogState.length > 0 || !isBedrockInUse()) {
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

/** Drop keys whose SecretStorage secret has vanished
 *  ({@link cloudCredentials.pruneMissingKeys}), refresh the panel, and say so.
 *
 *  Silence is not an option here: the key disappears from the settings list,
 *  and a user who sees a configured key one moment and an "enter your API key"
 *  prompt the next has no way to tell that from a bug. One message names every
 *  dropped key — pruning is idempotent, so it is shown once and never repeats
 *  for the same key.
 *
 *  @param vendor Restrict to one vendor; omit to sweep all of them. */
export async function pruneMissingCloudKeys(vendor?: string): Promise<void> {
  if (!state.extensionContext) {
    return;
  }
  const missing = await cloudCredentials.pruneMissingKeys(state.extensionContext, vendor);
  if (missing.length === 0) {
    return;
  }
  pushCloudAiSettingsState();

  const listed = missing.map((k) => `${k.vendor}: "${k.name}"`).join(', ');
  const plural = missing.length > 1;
  vscode.window.showWarningMessage(
    `Kōdo: ${plural ? 'these API keys are' : 'this API key is'} no longer in VS Code's secret storage ` +
      `and ${plural ? 'have' : 'has'} been removed — ${listed}. ` +
      `Add ${plural ? 'them' : 'it'} again in Kōdo Settings → Cloud AI.`,
  );
}

export async function handleApiKeyRequest(
  vendor: string,
  requestId: string,
  send: (env: Envelope) => void,
): Promise<void> {
  if (!state.extensionContext) {
    // No context, no SecretStorage — answer anyway. The server's KeyBroker
    // blocks on this request until it gets a response (kodo/doc/
    // WS_PROTOCOL.md §6.3), so a silent return hangs the session's turn.
    send(makeResponse(requestId, { error: 'cancelled' }));
    return;
  }

  // No stored key and nothing to prompt for: the token is minted from the
  // AWS profile, and a failure to do so (an expired SSO login, say) is what the
  // session has to show, so its message goes back as the error.
  if (vendor === 'bedrock') {
    try {
      const token = await getBedrockToken();
      void maybeRefreshBedrockCatalog();
      send(makeResponse(requestId, { api_key: token }));
    } catch (err) {
      send(makeResponse(requestId, { error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  try {
    // A key whose secret is gone must not be mistaken for one that merely
    // failed to resolve: prune it (and tell the user why the prompt below is
    // about to appear) before falling back to the interactive add flow.
    await pruneMissingCloudKeys(vendor);

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
  } catch (err) {
    // Same reason as the no-context branch: every path out of here owes the
    // server a response.
    kodoDiagnostics().appendLine(`[kodo] API key request for ${vendor} failed: ${String(err)}`);
    vscode.window.showErrorMessage(`Kōdo: could not read the stored ${vendor} API key — ${String(err)}`);
    send(makeResponse(requestId, { error: 'cancelled' }));
  }
}
