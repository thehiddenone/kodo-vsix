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
import type { LocalLaunchWarning, LocalRegistryEntry } from '../llm-registry-types';
import { hardwareFitWarningForFlavor, isDownloadableLocalEntry, localLaunchWarnings } from '../llm-registry-types';
import { sendControl } from './control-send';
import { dismissLocalLaunchWarnings, readSettings, readUiSettings, writeSettings } from './settings-io';
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

/** The active local model entry plus its outstanding memory/llama.cpp-version
 * warnings, or `null` when there's no active entry or it has none — reads
 * window-global state only, since the active local model and the installed
 * llama.cpp build are both machine-wide, not per-session. */
function activeLocalLaunchWarnings(): { entry: LocalRegistryEntry; warnings: LocalLaunchWarning[] } | null {
  const entry = state.localRegistryState.find((e) => e.name === state.activeLocalModelState);
  if (!entry) { return null; }
  const installedVersion = state.llamaInstalledState && state.llamaVersionState ? state.llamaVersionState : null;
  const warnings = localLaunchWarnings(
    entry,
    state.detectedVramGbState,
    state.detectedRamGbState,
    installedVersion,
    process.platform === 'darwin',
  );
  return warnings.length > 0 ? { entry, warnings } : null;
}

/**
 * Before actually launching llama-server — the sidebar's explicit
 * Start/Restart button, or a local-mode prompt about to trigger the engine's
 * automatic launch — warn the user about every outstanding memory/llama.cpp-
 * version warning on the active model and let them cancel (the dialog's
 * implicit Cancel/Escape, same convention as `setActiveFlavor` below), start
 * anyway, or — only when a llama.cpp version warning is present — jump to
 * Kōdo Settings to update llama.cpp instead of starting.
 *
 * A `'platform'` warning (kodo/doc/LLM_REGISTRY.md §4.6b) is handled first
 * and separately from the two above: unlike memory/version, there is no
 * "proceed anyway" for it — none of the active model's flavors can launch on
 * this host at all — so it shows a plain OK-only error and always cancels,
 * checked *before* `dismissedLocalLaunchWarnings` (a model dismissed for
 * memory/version reasons must not thereby bypass a platform block, and the
 * platform fact doesn't become launchable just because a warning was
 * dismissed once).
 *
 * `openSettings` is injected rather than imported directly (e.g. from
 * kodo-settings-bridge.ts) to avoid a circular import: kodo-settings-bridge.ts
 * already imports from this module and from window-sessions.ts, both of
 * which need to call this gate.
 *
 * A "Start anyway, don't ask again for this model" choice permanently
 * suppresses the dialog for this exact registry entry (`dismissLocalLaunchWarnings`,
 * `settings-io.ts` — persisted in `~/.kodo/etc/ui-settings.json`), checked
 * up front on every call (after the platform check): once set, EVERY future
 * launch of this quant skips the memory/version dialog no matter what
 * warnings apply then, and there is no UI to unset it.
 *
 * Returns `true` to proceed with the launch, `false` to cancel — always
 * `true` when the active model has no outstanding warnings, or was
 * previously dismissed (and isn't platform-blocked).
 */
export async function confirmLocalLlamaLaunch(openSettings: () => void): Promise<boolean> {
  const found = activeLocalLaunchWarnings();
  const platformWarning = found?.warnings.find((w) => w.kind === 'platform');
  if (platformWarning) {
    await vscode.window.showErrorMessage(`Kōdo: ${platformWarning.text}`, { modal: true });
    return false;
  }
  if (readUiSettings().dismissedLocalLaunchWarnings.includes(state.activeLocalModelState)) {
    return true;
  }
  if (!found) { return true; }
  const { entry, warnings } = found;
  const message = [
    `Starting llama.cpp with "${entry.name}" may cause problems:`,
    ...warnings.map((w) => w.text),
  ].join('\n\n');
  const proceedLabel = 'Start anyway';
  const dontAskLabel = "Start anyway, don't ask again for this model";
  const settingsLabel = 'Update llama.cpp…';
  const needsUpdate = warnings.some((w) => w.kind === 'version');
  const items = needsUpdate
    ? [proceedLabel, dontAskLabel, settingsLabel]
    : [proceedLabel, dontAskLabel];
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, ...items);
  if (choice === settingsLabel) {
    openSettings();
    return false;
  }
  if (choice === dontAskLabel) {
    dismissLocalLaunchWarnings(entry.name);
    return true;
  }
  return choice === proceedLabel;
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
