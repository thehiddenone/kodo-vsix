/**
 * The sidebar follows the active bound session (kodo/doc/SESSION_LLM_BINDING.md
 * §5). When a session tab comes to the front — or its window regains focus —
 * and that session is bound, its pending LLM is written into the sidebar's
 * state (`settings.json` + the local entry's profile and knobs). An unbound
 * session changes nothing (D5): its first prompt binds to whatever the sidebar
 * shows then.
 *
 * Before applying, the session's LLM is checked (D11). When it cannot be bound
 * again — the GGUF or self-hosted entry is gone, the cloud vendor has no key, a
 * model left the vendor's catalog — a sticky error toast says why and the
 * sidebar switches to the topmost local card, which is captured into the
 * session as its next LLM (D12).
 */

import * as vscode from 'vscode';
import * as cloudCredentials from '../cloud-credentials';
import { makeRequest } from '../envelope';
import { sameLlmSelection, settingsPatchFor, topmostLocalCard, unavailableReason } from '../session-llm';
import type { AvailabilityFacts, LlmSelection } from '../session-llm';
import type { SessionController } from '../session/controller';
import { pushCloudAiSettingsState } from './cloud-ai-settings';
import { sendControl } from './control-send';
import { lastActiveSession } from './session-llm-capture';
import { readCloudModels, readCloudUniform, readOpenRouterAutoMode, readSettings, readUiSettings, writeSettings } from './settings-io';
import { state } from './state';
import { broadcastThinkingContext } from './thinking-context';

/** The card the sidebar shows right now, in selection form. */
function sidebarSelection(): LlmSelection | null {
  if (state.modeState === 'local') {
    const entry = state.localRegistryState.find((e) => e.name === state.activeLocalModelState);
    return {
      kind: 'local',
      entry: state.activeLocalModelState,
      profileId: entry?.kind === 'custom_server_url' ? '' : entry?.active_profile ?? '',
      knobs: entry?.kind === 'custom_server_url' ? {} : { ...(entry?.knob_selections ?? {}) },
    };
  }
  const vendor = state.activeCloudVendorState;
  const uniform = readCloudUniform()[vendor] ?? { enabled: false, modelId: null };
  return {
    kind: 'cloud',
    vendor,
    tiers: { ...(readCloudModels()[vendor] ?? {}) },
    uniformEnabled: uniform.enabled,
    uniformModel: uniform.modelId ?? '',
    openrouterAuto: vendor === 'openrouter' && readOpenRouterAutoMode(),
  };
}

async function availabilityFacts(selection: LlmSelection): Promise<AvailabilityFacts> {
  let keyStored = true;
  if (selection.kind === 'cloud' && state.extensionContext) {
    keyStored = (await cloudCredentials.getActiveKey(state.extensionContext, selection.vendor)) !== undefined;
  }
  return {
    registry: state.localRegistryState,
    cloudRegistry: state.cloudRegistryState,
    hasKey: () => keyStored,
    cloudModelKnown: (vendor, modelId) => {
      if (vendor === 'openrouter') {
        const catalog = state.openRouterCatalogState;
        return catalog.length === 0 ? null : catalog.some((m) => m.id === modelId);
      }
      if (vendor === 'bedrock') {
        const catalog = state.bedrockCatalogState;
        return catalog.length === 0 ? null : catalog.some((m) => m.id === modelId);
      }
      const models = state.cloudRegistryState[vendor]?.models;
      return models === undefined ? null : models.some((m) => m.model_id === modelId);
    },
  };
}

/** Push the sidebar's mode + card and everything derived from them. */
function refreshSidebar(): void {
  state.sidebarProvider?.update({
    mode: state.modeState,
    activeLocalModel: state.activeLocalModelState,
    activeCloudVendor: state.activeCloudVendorState,
  });
  pushCloudAiSettingsState();
  broadcastThinkingContext();
}

/** Write *selection* into the sidebar's state, without capturing it back. */
function applyToSidebar(selection: LlmSelection): void {
  state.applyingSessionLlm = true;
  try {
    const models = (readSettings().models as Record<string, unknown> | undefined) ?? {};
    writeSettings(settingsPatchFor(selection, models));
    sendControl(makeRequest('config.reload'));
    if (selection.kind === 'local') {
      state.modeState = 'local';
      state.activeLocalModelState = selection.entry;
      const entry = state.localRegistryState.find((e) => e.name === selection.entry);
      if (entry && entry.kind !== 'custom_server_url') {
        // The session's own profile and knobs become the sidebar's (D6). The
        // server stores them without restarting llama-server (D1); a stale
        // profile id is left alone — it binds as the Default profile anyway.
        const profileKnown = selection.profileId === '' || entry.profiles.some((p) => p.id === selection.profileId);
        if (profileKnown && entry.active_profile !== selection.profileId) {
          sendControl(makeRequest('local_llm.set_active_profile', { name: entry.name, profile_id: selection.profileId }));
        }
        if (!sameLlmSelection(
          { kind: 'local', entry: entry.name, profileId: '', knobs: entry.knob_selections },
          { kind: 'local', entry: entry.name, profileId: '', knobs: selection.knobs },
        )) {
          sendControl(makeRequest('local_llm.set_knobs', { name: entry.name, knobs: selection.knobs }));
        }
      }
    } else {
      state.modeState = 'cloud';
      state.activeCloudVendorState = selection.vendor;
    }
    refreshSidebar();
  } finally {
    state.applyingSessionLlm = false;
  }
}

/** D12: tell the user why (sticky until closed), switch the sidebar to the
 *  topmost local card, and make that the session's next LLM. */
function fallBack(session: SessionController, reason: string): void {
  const card = topmostLocalCard(state.localRegistryState, readUiSettings().pinnedLocalModels);
  state.applyingSessionLlm = true;
  try {
    const models = (readSettings().models as Record<string, unknown> | undefined) ?? {};
    writeSettings(settingsPatchFor({ kind: 'local', entry: card?.name ?? '', profileId: '', knobs: {} }, models));
    sendControl(makeRequest('config.reload'));
    state.modeState = 'local';
    state.activeLocalModelState = card?.name ?? '';
    refreshSidebar();
  } finally {
    state.applyingSessionLlm = false;
  }
  session.captureLlmSelection();
  const next = card
    ? `Switched it to ${card.description || card.name}, the topmost local LLM.`
    : 'There is no local LLM to switch to — pick or install one in the sidebar before sending a prompt.';
  // An error notification with an action stays on screen until it is closed.
  void vscode.window.showErrorMessage(`Kōdo: this session's LLM is not available — ${reason}. ${next}`, 'Close');
}

/**
 * A session tab came to the front (or its window regained focus): a bound
 * session puts its own pending LLM into the sidebar (§5); an unbound one
 * leaves the sidebar exactly as it was (D5).
 */
export async function onSessionActivated(session: SessionController): Promise<void> {
  state.lastActiveSessionKey = session.key;
  const llm = session.sessionLlm;
  if (!llm.bound || llm.selection === null) {
    return;
  }
  if (state.localRegistryState.length === 0) {
    // The registries arrive on the control connection; until then nothing
    // can be checked. `onRegistriesLoaded` runs this again.
    state.pendingActivationKey = session.key;
    return;
  }
  const selection = llm.selection;
  const reason = unavailableReason(selection, await availabilityFacts(selection));
  if (lastActiveSession() !== session) {
    return; // another tab came to the front while the key was looked up
  }
  if (reason !== null) {
    fallBack(session, reason);
    return;
  }
  if (!sameLlmSelection(selection, sidebarSelection())) {
    applyToSidebar(selection);
  }
}

/** Re-run an activation that came before the registries did. */
export function onRegistriesLoaded(): void {
  const key = state.pendingActivationKey;
  state.pendingActivationKey = '';
  const session = key ? state.sessions.get(key) : undefined;
  if (session) {
    void onSessionActivated(session);
  }
}

/** The window regained focus: re-apply its front tab, since another window
 *  may have moved the (machine-wide) sidebar state meanwhile. */
export function onWindowFocused(): void {
  const session = lastActiveSession();
  if (session?.isPanelActive) {
    void onSessionActivated(session);
  }
}
