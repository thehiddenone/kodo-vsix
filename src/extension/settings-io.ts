/**
 * Read/write access to `~/.kodo/etc/settings.json` (server-mirrored) and
 * `~/.kodo/etc/ui-settings.json` (kodo-vsix-only), plus the small derived
 * readers (mode, active local/cloud model, folder map) built on top of them.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeRequest } from '../envelope';
import type { UiSettings } from '../settings-panel/types';
import { sendControl } from './control-send';
import { showTransientNotification } from './server-lifecycle';
import { DEFAULT_CLOUD_VENDOR, DEFAULT_LOCAL_MODEL, state } from './state';
import { broadcastSamplingContext } from './sampling-context';
import { broadcastThinkingContext } from './thinking-context';

function kodoHomeDir(): string {
  return path.join(os.homedir(), '.kodo');
}

function settingsPath(): string {
  return path.join(kodoHomeDir(), 'etc', 'settings.json');
}

export function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Merge a patch into the global ~/.kodo/etc/settings.json, preserving other keys. */
export function writeSettings(patch: Record<string, unknown>): void {
  const settings = readSettings();
  Object.assign(settings, patch);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

const DEFAULT_UI_SETTINGS: UiSettings = {
  showTimestamps: false,
  timezone: 'system',
  clockFormat: 'ymd_24h',
  enterSubmits: true,
  pinnedLocalModels: [],
  pinnedCloudVendors: [],
  dismissedLocalLaunchWarnings: [],
  lastAttachDir: '',
};

/**
 * `~/.kodo/etc/ui-settings.json` — kodo-vsix's own "Show Timestamps" flags
 * (Kōdo Settings' "General" section). Deliberately a **separate file** from
 * `settings.json`: that one mirrors state the kodo server also reads/writes
 * (mode, active models, …); this one is pure client-side display preference
 * the server never sees, so it gets its own file rather than sharing that
 * wire-format-adjacent one.
 */
function uiSettingsPath(): string {
  return path.join(kodoHomeDir(), 'etc', 'ui-settings.json');
}

/** Read `ui-settings.json`, filling in defaults for a missing file or any
 *  malformed/missing field (never throws). */
export function readUiSettings(): UiSettings {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(uiSettingsPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return DEFAULT_UI_SETTINGS;
  }
  return {
    showTimestamps: typeof raw.showTimestamps === 'boolean' ? raw.showTimestamps : DEFAULT_UI_SETTINGS.showTimestamps,
    timezone: typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : DEFAULT_UI_SETTINGS.timezone,
    clockFormat: typeof raw.clockFormat === 'string' && raw.clockFormat ? raw.clockFormat : DEFAULT_UI_SETTINGS.clockFormat,
    enterSubmits: typeof raw.enterSubmits === 'boolean' ? raw.enterSubmits : DEFAULT_UI_SETTINGS.enterSubmits,
    pinnedLocalModels: Array.isArray(raw.pinnedLocalModels)
      ? raw.pinnedLocalModels.filter((n): n is string => typeof n === 'string')
      : DEFAULT_UI_SETTINGS.pinnedLocalModels,
    pinnedCloudVendors: Array.isArray(raw.pinnedCloudVendors)
      ? raw.pinnedCloudVendors.filter((n): n is string => typeof n === 'string')
      : DEFAULT_UI_SETTINGS.pinnedCloudVendors,
    dismissedLocalLaunchWarnings: Array.isArray(raw.dismissedLocalLaunchWarnings)
      ? raw.dismissedLocalLaunchWarnings.filter((n): n is string => typeof n === 'string')
      : DEFAULT_UI_SETTINGS.dismissedLocalLaunchWarnings,
    lastAttachDir: typeof raw.lastAttachDir === 'string' ? raw.lastAttachDir : DEFAULT_UI_SETTINGS.lastAttachDir,
  };
}

/** Overwrite `ui-settings.json` with `settings` (the whole object — unlike
 *  `writeSettings`'s patch-merge, there are no other keys in this file to
 *  preserve) and return it, so the caller can push the same value onward
 *  without a redundant re-read. */
export function writeUiSettings(settings: UiSettings): UiSettings {
  fs.mkdirSync(path.dirname(uiSettingsPath()), { recursive: true });
  fs.writeFileSync(uiSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}

/** Pin/unpin a local LLM registry entry for the sidebar's card ordering.
 *  Newly pinned names are appended, so `pinnedLocalModels` is in pin order
 *  (oldest pin first/topmost) — see `sidebar-provider.ts`'s `renderLocalCards`. */
export function togglePinnedLocalModel(name: string): UiSettings {
  const settings = readUiSettings();
  const pinnedLocalModels = settings.pinnedLocalModels.includes(name)
    ? settings.pinnedLocalModels.filter((n) => n !== name)
    : [...settings.pinnedLocalModels, name];
  return writeUiSettings({ ...settings, pinnedLocalModels });
}

/** Same as `togglePinnedLocalModel` but for cloud vendor keys. */
export function togglePinnedCloudVendor(vendor: string): UiSettings {
  const settings = readUiSettings();
  const pinnedCloudVendors = settings.pinnedCloudVendors.includes(vendor)
    ? settings.pinnedCloudVendors.filter((v) => v !== vendor)
    : [...settings.pinnedCloudVendors, vendor];
  return writeUiSettings({ ...settings, pinnedCloudVendors });
}

/** Permanently suppress the pre-launch memory/llama.cpp-version warning
 *  dialog (`confirmLocalLlamaLaunch`, `extension/local-llm-registry.ts`) for
 *  one local registry entry — the "Start anyway, don't ask again" button's
 *  effect. One-way (unlike `togglePinnedLocalModel`, this never removes
 *  `name` again) and idempotent (a no-op write if already dismissed). */
export function dismissLocalLaunchWarnings(name: string): UiSettings {
  const settings = readUiSettings();
  if (settings.dismissedLocalLaunchWarnings.includes(name)) {
    return settings;
  }
  return writeUiSettings({
    ...settings,
    dismissedLocalLaunchWarnings: [...settings.dismissedLocalLaunchWarnings, name],
  });
}

/** Remember the directory the "+" attach-file dialog last opened into, so
 *  the next attach opens there instead of VS Code's own last-used default.
 *  Host-only; see `UiSettings.lastAttachDir`'s doc comment. */
export function setLastAttachDir(dir: string): UiSettings {
  return writeUiSettings({ ...readUiSettings(), lastAttachDir: dir });
}

/** Push the current "Show Timestamps" flags to every open session tab in
 *  this window — called right after `set_ui_settings` writes them, mirroring
 *  `broadcastThinkingContext`. */
export function broadcastUiSettings(settings: UiSettings): void {
  for (const s of state.sessions.values()) {
    s.updateUiSettings(settings);
  }
}

/** Logical-root folder map: VS-Code-disambiguated name → physical path. */
export function buildFolderMap(): Record<string, string> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const byName = new Map<string, vscode.WorkspaceFolder[]>();
  for (const f of folders) {
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }
  const map: Record<string, string> = {};
  for (const [name, list] of byName) {
    if (list.length === 1) {
      map[name] = list[0].uri.fsPath;
    } else {
      for (const f of list) {
        const parent = path.basename(path.dirname(f.uri.fsPath));
        map[`${name} (${parent})`] = f.uri.fsPath;
      }
    }
  }
  return map;
}

/**
 * Absolute path of the `.code-workspace` file the window was opened from, or
 * `undefined` for a plain folder workspace. Deliberately excludes VS Code's
 * own in-memory `untitled:` scheme (minted for a brand-new multi-root
 * workspace, e.g. right after `addWorkspaceFolder` promotes a folder-less
 * window past its first folder) — there is no file on disk a future session
 * could reopen, so remembering it would be actively wrong.
 */
export function codeWorkspaceFile(): string | undefined {
  const file = vscode.workspace.workspaceFile;
  return file?.scheme === 'file' ? file.fsPath : undefined;
}

export function readMode(): 'local' | 'cloud' {
  return readSettings()['mode'] === 'cloud' ? 'cloud' : 'local';
}

export function readActiveLocalModel(): string {
  const models = readSettings()['models'] as Record<string, unknown> | undefined;
  return typeof models?.['local'] === 'string' ? models['local'] : DEFAULT_LOCAL_MODEL;
}

export function readActiveCloudVendor(): string {
  const value = readSettings()['active_cloud_vendor'];
  return typeof value === 'string' && value ? value : DEFAULT_CLOUD_VENDOR;
}

/**
 * Display-only fallback for vendors/efforts not yet present in
 * ~/.kodo/etc/settings.json — mirrors the kodo server's own
 * `_DEFAULT_USER_SETTINGS["models"]["cloud"]` (kodo/src/kodo/server/_config.py).
 * The server is the sole writer of that file's defaults (`_ensure_user_settings`,
 * run at server startup); this just keeps the webview's radios from rendering
 * unselected in the window before that has happened, or before the user has
 * changed anything for a given vendor. Never written to disk from here.
 */
const DEFAULT_CLOUD_MODELS: Record<string, Record<string, string>> = {
  anthropic: {
    low: 'claude-haiku-4-5-20251001',
    medium: 'claude-sonnet-5',
    high: 'claude-opus-5',
    max: 'claude-fable-5',
  },
};

/** vendor -> effort -> model_id, mirrors settings.json's `models.cloud`, filled in with defaults. */
export function readCloudModels(): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [vendor, defaults] of Object.entries(DEFAULT_CLOUD_MODELS)) {
    result[vendor] = { ...defaults };
  }
  const models = readSettings()['models'] as Record<string, unknown> | undefined;
  const cloud = models?.['cloud'];
  if (cloud && typeof cloud === 'object') {
    for (const [vendor, effortMap] of Object.entries(cloud as Record<string, unknown>)) {
      if (effortMap && typeof effortMap === 'object') {
        const clean: Record<string, string> = { ...result[vendor] };
        for (const [effort, modelId] of Object.entries(effortMap as Record<string, unknown>)) {
          if (typeof modelId === 'string') {
            clean[effort] = modelId;
          }
        }
        result[vendor] = clean;
      }
    }
  }
  return result;
}

export function setMode(mode: 'cloud' | 'local'): void {
  writeSettings({ mode });
  sendControl(makeRequest('config.reload'));
  state.modeState = mode;
  state.sidebarProvider?.update({ mode });
  const label = mode === 'cloud' ? 'cloud AI (API key required)' : 'local AI via llama.cpp';
  showTransientNotification(`Kōdo: switched to ${label}.`);
  broadcastThinkingContext();
  broadcastSamplingContext();
}
