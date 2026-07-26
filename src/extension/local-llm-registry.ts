/**
 * The "Local Inference" tab's data: merging server-reported registry state
 * with the client-authoritative custom_file installed-state cache, pushing
 * that state into the Kōdo Settings panel, and the handful of actions that
 * change the active local model/flavor or touch a registry entry's files
 * (doc/LLM_REGISTRY.md §4).
 */

import * as fs from 'fs';
import * as vscode from 'vscode';
import { makeRequest } from '../envelope';
import { KodoSettingsPanel } from '../settings-panel/panel';
import type { LocalRegistryEntry } from '../llm-registry-types';
import { hardwareFitWarningForFlavor, isDownloadableLocalEntry } from '../llm-registry-types';
import { sendControl } from './control-send';
import { readSettings, writeSettings } from './settings-io';
import { state } from './state';
import { broadcastThinkingContext, parseThinkingFamilies } from './thinking-context';

/** Merge server-reported local_registry entries with the client-authoritative
 * custom_file installed-state cache (see doc/LLM_REGISTRY.md §4). */
export function mergeLocalRegistry(raw: unknown): LocalRegistryEntry[] {
  if (!Array.isArray(raw)) {
    return state.localRegistryState;
  }
  return (raw as LocalRegistryEntry[]).map((entry) => {
    if (entry.kind !== 'custom_file') {
      return entry;
    }
    let installed = state.customFileInstalledCache.get(entry.name);
    if (installed === undefined) {
      installed = fs.existsSync(entry.path);
      state.customFileInstalledCache.set(entry.name, installed);
    }
    return { ...entry, installed };
  });
}

/** Push the "Local Inference" tab's fields into the Kōdo Settings panel — a
 * no-op if the panel isn't open, same pattern as `pushCloudAiSettingsState`
 * in cloud-ai-settings.ts. Named after the tab now, not a standalone panel
 * (that standalone "Local Inference Settings" panel was folded into Kōdo
 * Settings). */
export function pushLocalInferenceState(): void {
  KodoSettingsPanel.instance?.update({
    localRegistry: state.localRegistryState,
    llamaServerOverridePath: state.llamaServerOverridePathState,
    detectedVramGb: state.detectedVramGbState,
    detectedRamGb: state.detectedRamGbState,
    downloads: state.localDownloadsState,
    isMac: process.platform === 'darwin',
    updatableNames: state.localUpdatableNamesState,
  });
}

export function onLocalLlmRegistryState(payload: Record<string, unknown>): void {
  state.localRegistryState = mergeLocalRegistry(payload.local_registry);
  state.llamaServerOverridePathState =
    typeof payload.llama_server_override_path === 'string' ? payload.llama_server_override_path : null;
  state.thinkingFamiliesState = parseThinkingFamilies(payload.thinking_families);
  state.sidebarProvider?.update({
    localRegistry: state.localRegistryState,
  });
  pushLocalInferenceState();
  broadcastThinkingContext();
}

/** Reply to `local_llm.check_updates` (doc/LOCAL_MODEL_MANAGER.md §12) —
 * replaces (not merges) `localUpdatableNamesState` with this scan's result,
 * so a model that no longer differs from its remote drops off the banner. */
export function onLocalLlmUpdatesAvailable(payload: Record<string, unknown>): void {
  const raw = payload.updatable;
  state.localUpdatableNamesState = Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string') : [];
  pushLocalInferenceState();
}

/**
 * Fire-and-forget `local_llm.check_updates` — sent every time the Local
 * Inference Settings panel opens, carrying every currently-installed
 * HF-backed model's name. The server checks each one's on-disk ETag against
 * HuggingFace in the background and replies later with
 * `local_llm.updates_available`; this call does not wait for that reply (see
 * `onLocalLlmUpdatesAvailable`).
 */
export function sendCheckLocalLlmUpdates(): void {
  const names = state.localRegistryState
    .filter((e) => isDownloadableLocalEntry(e.kind) && e.installed)
    .map((e) => e.name);
  if (names.length === 0) {
    return;
  }
  sendControl(makeRequest('local_llm.check_updates', { names }));
}

export function setActiveLocalModel(name: string): void {
  const models = (readSettings()['models'] as Record<string, unknown> | undefined) ?? {};
  models['local'] = name;
  writeSettings({ models });
  sendControl(makeRequest('config.reload'));
  state.activeLocalModelState = name;
  state.sidebarProvider?.update({ activeLocalModel: name });
  broadcastThinkingContext();
}

/**
 * Selecting a flavor whose `min_ram`/`min_vram` exceed this machine's
 * detected hardware is allowed, but gated behind a native "I understand the
 * risk, proceed" / "Cancel" confirmation — proceeding anyway may crash
 * llama.cpp with an OOM. See `hardwareFitWarningForFlavor` for the
 * detection-vs-threshold comparison (kodo/doc/LLM_REGISTRY.md §4.6a).
 * Cancelling never contacts the server — the sidebar's flavor `<select>`
 * is reset to the real active flavor by re-pushing the unchanged state.
 */
export async function setActiveFlavor(name: string, flavorId: string): Promise<void> {
  const entry = state.localRegistryState.find((e) => e.name === name);
  const flavor = entry?.flavors.find((f) => f.id === flavorId);
  const warning = flavor
    ? hardwareFitWarningForFlavor(
        flavor,
        state.detectedVramGbState,
        state.detectedRamGbState,
        process.platform === 'darwin',
      )
    : null;
  if (warning) {
    const proceedLabel = 'I understand the risk, proceed';
    const choice = await vscode.window.showWarningMessage(warning, { modal: true }, proceedLabel);
    if (choice !== proceedLabel) {
      state.sidebarProvider?.update({});
      return;
    }
  }
  sendControl(makeRequest('local_llm.set_active_flavor', { name, flavor_id: flavorId }));
}

/** "Show me local files" — reveal the installed model's file in Finder/Explorer/etc.
 * `installed_path` comes straight from the server's registry payload (resolved via
 * LocalModelManager/entry.path — see doc/LLM_REGISTRY.md §4), no extra WS round trip. */
export function revealLocalLlmFiles(name: string): void {
  const entry = state.localRegistryState.find((e) => e.name === name);
  if (!entry?.installed_path) { return; }
  void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.installed_path));
}

export async function pickGgufFile(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Kōdo: Select a GGUF file',
    canSelectMany: false,
    filters: { 'GGUF model': ['gguf'] },
  });
  KodoSettingsPanel.instance?.postGgufFilePicked(picked?.[0]?.fsPath ?? null);
}

export async function setLlamaServerOverride(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Kōdo: Set llama.cpp override',
    canSelectMany: false,
  });
  const filePath = picked?.[0]?.fsPath;
  if (!filePath) { return; }
  sendControl(makeRequest('llama_server_override.set', { path: filePath }));
}
