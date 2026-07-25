/**
 * HuggingFace access token management for gated model repositories.
 *
 * HF tokens are optional — only needed when pulling gated repos.
 *
 * `~/.kodo/etc/hf_tokens.json` holds the (public) uuid -> name map and
 * which UUID is active; the UUID is also the VS Code SecretStorage key
 * under which the actual token lives.
 *
 * Mirrors the pattern from cloud-credentials.ts but single-purpose
 * (no vendor nesting).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface HfTokenEntry {
  name: string;
  uuid: string;
  active: boolean;
}

interface HfTokensData {
  tokens: Record<string, string>;
  active: string | null;
}

function _hfTokensPath(): string {
  return path.join(os.homedir(), '.kodo', 'etc', 'hf_tokens.json');
}

function _readHfTokens(): HfTokensData {
  try {
    return JSON.parse(fs.readFileSync(_hfTokensPath(), 'utf8')) as HfTokensData;
  } catch {
    return { tokens: {}, active: null };
  }
}

function _writeHfTokens(data: HfTokensData): void {
  const p = _hfTokensPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/** All configured HF tokens, in insertion order, with the active one flagged. */
export function listTokens(): HfTokenEntry[] {
  const data = _readHfTokens();
  return Object.entries(data.tokens).map(([uuid, name]) => ({
    name,
    uuid,
    active: uuid === data.active,
  }));
}

/** The active token's secret, or `undefined` if none is configured. */
export async function getActiveToken(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const data = _readHfTokens();
  if (!data.active) {
    return undefined;
  }
  return context.secrets.get(data.active);
}

/** Store a new named HF token and mark it active. */
export async function addToken(
  context: vscode.ExtensionContext,
  name: string,
  secret: string,
): Promise<void> {
  const trimmedName = name.trim();
  const trimmedSecret = secret.trim();
  const uuid = crypto.randomUUID();

  await context.secrets.store(uuid, trimmedSecret);

  const data = _readHfTokens();
  data.tokens[uuid] = trimmedName;
  data.active = uuid;
  _writeHfTokens(data);
}

/**
 * Remove a token by UUID; clears active if it was the active one, otherwise
 * picks the first remaining token as the new active (or null if none left).
 */
export async function removeToken(
  context: vscode.ExtensionContext,
  uuid: string,
): Promise<void> {
  await context.secrets.delete(uuid);

  const data = _readHfTokens();
  delete data.tokens[uuid];

  if (data.active === uuid) {
    const remaining = Object.keys(data.tokens);
    data.active = remaining.length > 0 ? remaining[0] : null;
  }

  _writeHfTokens(data);
}

/** Mark an existing token as active. No-op if `uuid` isn't a configured token. */
export function setActiveToken(uuid: string): void {
  const data = _readHfTokens();
  if (!(uuid in data.tokens)) {
    return;
  }
  data.active = uuid;
  _writeHfTokens(data);
}

/** Forget whichever token is currently active (server-initiated revoke). */
export async function revokeActiveToken(context: vscode.ExtensionContext): Promise<void> {
  const data = _readHfTokens();
  if (data.active) {
    await removeToken(context, data.active);
  }
}
