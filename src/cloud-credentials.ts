/**
 * Named, multi-key, per-vendor cloud API credential management.
 *
 * Owned entirely by the extension (kodo/doc/LLM_REGISTRY.md §6) — the Python
 * server's `api_key.request`/`api_key.revoke` pull protocol
 * (WS_PROTOCOL.md §6.3/§6.4) is unchanged and never sees key names, UUIDs, or
 * how many keys are configured, only the resolved secret this module hands
 * back.
 *
 * `~/.kodo/etc/cloud_settings.json` holds the (public) name -> UUID map and
 * which UUID is active per vendor; the UUID is also the VS Code SecretStorage
 * key under which the actual secret lives. This replaces the old
 * single-secret-per-vendor scheme (`kodo.apiKey.<vendor>`) outright.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ApiKeyEntry {
  name: string;
  uuid: string;
  active: boolean;
}

interface VendorKeyMap {
  keys: Record<string, string>;
  active: string | null;
}

type CloudSettings = Record<string, VendorKeyMap>;

function _cloudSettingsPath(): string {
  return path.join(os.homedir(), '.kodo', 'etc', 'cloud_settings.json');
}

function _readCloudSettings(): CloudSettings {
  try {
    return JSON.parse(fs.readFileSync(_cloudSettingsPath(), 'utf8')) as CloudSettings;
  } catch {
    return {};
  }
}

function _writeCloudSettings(settings: CloudSettings): void {
  const p = _cloudSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf8');
}

function _vendorMap(settings: CloudSettings, vendor: string): VendorKeyMap {
  return settings[vendor] ?? { keys: {}, active: null };
}

/** All keys configured for *vendor*, in insertion order, with the active one flagged. */
export function listKeys(vendor: string): ApiKeyEntry[] {
  const vendorMap = _vendorMap(_readCloudSettings(), vendor);
  return Object.entries(vendorMap.keys).map(([name, uuid]) => ({
    name,
    uuid,
    active: uuid === vendorMap.active,
  }));
}

/** The active key's secret for *vendor*, or `undefined` if none is configured. */
export async function getActiveKey(
  context: vscode.ExtensionContext,
  vendor: string,
): Promise<string | undefined> {
  const vendorMap = _vendorMap(_readCloudSettings(), vendor);
  if (!vendorMap.active) {
    return undefined;
  }
  return context.secrets.get(vendorMap.active);
}

/** Store a new named key for *vendor* and mark it active. */
export async function addKey(
  context: vscode.ExtensionContext,
  vendor: string,
  name: string,
  secret: string,
): Promise<void> {
  const uuid = crypto.randomUUID();
  await context.secrets.store(uuid, secret.trim());

  const settings = _readCloudSettings();
  const vendorMap = _vendorMap(settings, vendor);
  vendorMap.keys[name.trim()] = uuid;
  vendorMap.active = uuid;
  settings[vendor] = vendorMap;
  _writeCloudSettings(settings);
}

/**
 * Prompt for a friendly name and the secret, store both, and mark the new key
 * active. Returns `true` on success, `false` if the user cancelled either
 * prompt.
 */
export async function addKeyInteractive(
  context: vscode.ExtensionContext,
  vendor: string,
): Promise<boolean> {
  const name = await vscode.window.showInputBox({
    title: `Kōdo: New API key for ${vendor}`,
    prompt: 'Name this key (e.g. "work", "personal") so you can tell it apart later',
    placeHolder: 'Key name',
    ignoreFocusOut: true,
  });
  if (!name?.trim()) {
    return false;
  }

  const secret = await vscode.window.showInputBox({
    title: 'Kōdo: API key required',
    prompt: `Enter the API key for ${vendor}`,
    password: true,
    placeHolder: `${vendor} API key`,
    ignoreFocusOut: true,
  });
  if (!secret?.trim()) {
    return false;
  }

  await addKey(context, vendor, name, secret);
  return true;
}

/**
 * Resolve the vendor's active key, falling back to the interactive add flow
 * when none is configured yet — preserves the original "ask when nothing is
 * configured" behavior while layering proactive management on top. Returns
 * `undefined` if the user cancels the fallback prompt.
 */
export async function resolveApiKey(
  context: vscode.ExtensionContext,
  vendor: string,
): Promise<string | undefined> {
  const existing = await getActiveKey(context, vendor);
  if (existing) {
    return existing;
  }
  const added = await addKeyInteractive(context, vendor);
  return added ? getActiveKey(context, vendor) : undefined;
}

/** Delete a key's secret and forget it; clears `active` if it was the active one. */
export async function forgetKey(
  context: vscode.ExtensionContext,
  vendor: string,
  uuid: string,
): Promise<void> {
  await context.secrets.delete(uuid);
  const settings = _readCloudSettings();
  const vendorMap = settings[vendor];
  if (!vendorMap) {
    return;
  }
  for (const [name, id] of Object.entries(vendorMap.keys)) {
    if (id === uuid) {
      delete vendorMap.keys[name];
    }
  }
  if (vendorMap.active === uuid) {
    vendorMap.active = null;
  }
  _writeCloudSettings(settings);
}

/** Forget whichever key is currently active for *vendor* (server-initiated revoke). */
export async function revokeActiveKey(context: vscode.ExtensionContext, vendor: string): Promise<void> {
  const vendorMap = _vendorMap(_readCloudSettings(), vendor);
  if (vendorMap.active) {
    await forgetKey(context, vendor, vendorMap.active);
  }
}

/** Mark an existing key active for *vendor*. No-op if `uuid` isn't a configured key. */
export function makeActive(vendor: string, uuid: string): void {
  const settings = _readCloudSettings();
  const vendorMap = settings[vendor];
  if (!vendorMap || !Object.values(vendorMap.keys).includes(uuid)) {
    return;
  }
  vendorMap.active = uuid;
  _writeCloudSettings(settings);
}
