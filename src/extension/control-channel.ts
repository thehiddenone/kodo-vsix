/**
 * Inbound dispatcher for the session-less control WebSocket: `hello.ack`
 * (window-global LLM/registry state), llama.cpp events, local-LLM registry
 * events, and HuggingFace-token requests/revokes. The outbound half
 * (`sendControl`/`sendControlAwait`) lives in `control-send.ts`, imported
 * from here rather than the other way around.
 */

import * as vscode from 'vscode';
import { makeResponse } from '../envelope';
import type { Envelope } from '../envelope';
import * as hfTokens from '../hf-tokens';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { CloudRegistry } from '../llm-registry-types';
import { pushCloudAiSettingsState } from './cloud-ai-settings';
import { sendControl } from './control-send';
import { resumePendingCreateProjectPrompt } from './create-project';
import { applyLlamaState, onLlamaProgress } from './llamacpp';
import { mergeLocalRegistry, onLocalLlmRegistryState, onLocalLlmUpdatesAvailable, pushLocalInferenceState } from './local-llm-registry';
import { resumePendingResumeSession } from './session-resume';
import { state } from './state';
import { broadcastThinkingContext, parseThinkingFamilies } from './thinking-context';
import { reconcileOpenSessions } from './window-sessions';

export async function handleControlEnvelope(env: Envelope): Promise<void> {
  if (env.kind === 'response' && env.correlation_id) {
    const resolver = state.pendingControl.get(env.correlation_id);
    if (resolver) {
      state.pendingControl.delete(env.correlation_id);
      resolver(env.payload);
      return;
    }
  }

  const evtType = String(env.payload.type ?? '');

  // Server-initiated HF token request on the control connection.
  // The extension resolves the active HF token and responds; empty string
  // is returned when no token is configured (public repos don't need one).
  if (env.kind === 'request' && evtType === 'hf_token.request') {
    if (!state.extensionContext) {
      return;
    }
    const token = await hfTokens.getActiveToken(state.extensionContext);
    sendControl(makeResponse(env.id, { hf_token: token ?? '' }));
    return;
  }

  // Server-initiated HF token revoke — the active token was rejected
  // (e.g. 401 on a gated repo). Forget it so the next download re-prompts.
  if (env.kind === 'event' && evtType === 'hf_token.revoke') {
    if (!state.extensionContext) {
      return;
    }
    await hfTokens.revokeActiveToken(state.extensionContext);
    KodoSettingsPanel.instance?.update({ hfTokens: hfTokens.listTokens() });
    vscode.window.showWarningMessage(
      'Kōdo: HuggingFace access token was rejected. ' +
        'Add a valid token in Kōdo Settings → HuggingFace to download gated models.',
    );
    return;
  }

  if (env.kind === 'response' && evtType === 'hello.ack') {
    if (env.payload.cloud_registry && typeof env.payload.cloud_registry === 'object') {
      state.cloudRegistryState = env.payload.cloud_registry as CloudRegistry;
    }
    if (typeof env.payload.active_cloud_vendor === 'string') {
      state.activeCloudVendorState = env.payload.active_cloud_vendor;
    }
    state.localRegistryState = mergeLocalRegistry(env.payload.local_registry);
    state.llamaServerOverridePathState =
      typeof env.payload.llama_server_override_path === 'string' ? env.payload.llama_server_override_path : null;
    state.llamaInstalledState = Boolean(env.payload.llama_installed);
    state.llamaVersionState = typeof env.payload.llama_version === 'string' ? env.payload.llama_version : '';
    state.llamaRunningState = Boolean(env.payload.llama_running);
    state.llamaRunningModelState =
      state.llamaRunningState && typeof env.payload.llama_model === 'string' ? env.payload.llama_model : '';
    state.detectedVramGbState =
      typeof env.payload.detected_vram_gb === 'number' ? env.payload.detected_vram_gb : null;
    state.detectedRamGbState =
      typeof env.payload.detected_ram_gb === 'number' ? env.payload.detected_ram_gb : null;
    state.thinkingFamiliesState = parseThinkingFamilies(env.payload.thinking_families);
    state.sidebarProvider?.update({
      cloudRegistry: state.cloudRegistryState,
      activeCloudVendor: state.activeCloudVendorState,
      localRegistry: state.localRegistryState,
      effectiveLocalModel: state.effectiveLocalModelState,
      llamaInstalled: state.llamaInstalledState,
      llamaVersion: state.llamaVersionState,
      llamaRunning: state.llamaRunningState,
      llamaRunningModel: state.llamaRunningModelState,
      detectedVramGb: state.detectedVramGbState,
      detectedRamGb: state.detectedRamGbState,
    });
    pushLocalInferenceState();
    pushCloudAiSettingsState();
    broadcastThinkingContext();
    // The server is provably reachable now — reopen any of this window's
    // sessions that the panel serializer could not restore (see
    // window-sessions.ts's open-session-memory block).
    void reconcileOpenSessions();
    // Resume a `pickSession()`/reconnect-workspace flow that reloaded this
    // window into a session's remembered workspace — see
    // `resumeSessionIntoWorkspace`/`reconnectSessionWorkspace` in
    // session-resume.ts. Awaited (not fire-and-forget) and sequenced BEFORE
    // the create-project resume below: `promptReconnectForCreateProject`'s
    // reconnect-then-create-project flow arms both markers for the same
    // reload, and `resumePendingCreateProjectPrompt` (via
    // `promptCreateProjectName`) finds its target session through a generic
    // "active session" lookup — if it ran first, it would find no active tab
    // yet and spawn a spurious new session instead of using the one this
    // reload just reconnected.
    await resumePendingResumeSession();
    // Resume a "Create Project" flow that reloaded this window to open its
    // first workspace folder/file, or to reconnect a disconnected session's
    // workspace — see create-project.ts's `promptOpenWorkspaceForNewProject`/
    // `promptReconnectForCreateProject`.
    void resumePendingCreateProjectPrompt();
    return;
  }

  if (env.kind === 'event' && evtType === 'llama.state') {
    applyLlamaState(env.payload);
    return;
  }

  if (env.kind === 'event' && evtType === 'local_llm.registry_state') {
    onLocalLlmRegistryState(env.payload);
    return;
  }

  if (env.kind === 'event' && evtType === 'local_llm.updates_available') {
    onLocalLlmUpdatesAvailable(env.payload);
    return;
  }

  if (env.kind === 'event' && evtType === 'llamacpp.install.progress') {
    onLlamaProgress(
      Number(env.payload.percent ?? 0),
      String(env.payload.message ?? ''),
      Boolean(env.payload.up_to_date),
    );
    return;
  }

  if (env.kind === 'event' && evtType === 'error') {
    const message = typeof env.payload.message === 'string' ? env.payload.message : 'Unknown error';
    if (env.payload.code === 'local_llm_error') {
      vscode.window.showErrorMessage(`Kōdo: ${message}`);
    }
    return;
  }
}
