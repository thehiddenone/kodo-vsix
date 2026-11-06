/**
 * The AWS Bedrock bearer token: minted by the server, kept here.
 *
 * `bedrock.token.generate` (kodo/doc/WS_PROTOCOL.md §7.6n) produces the token
 * and the server forgets it. It lives in VS Code SecretStorage with its
 * timestamps, and this module replaces it at 75% of its lifetime, so it reaches
 * the server through the same `api_key.request` pull as every other vendor's
 * key. The rules themselves are in `bedrock-token-policy.ts`.
 *
 * SecretStorage is shared by every window of this VS Code, and each window runs
 * its own timer. Two windows can mint at the same moment, which is harmless:
 * both tokens work, and the last one stored wins.
 */

import * as vscode from 'vscode';
import {
  parseStoredToken,
  refreshDueAt,
  tokenFreshness,
  tokenFromReply,
  type StoredBedrockToken,
} from '../bedrock-token-policy';
import { kodoDiagnostics } from '../diagnostics';
import { sendControlAwait } from './control-send';
import { readBedrockProfile, readBedrockRegion } from './settings-io';
import { state } from './state';

const SECRET_KEY = 'kodo.bedrock.token';
// Over the server's own 60 s limit, so its "timed out" message is what arrives.
const MINT_TIMEOUT_MS = 75_000;
const RETRY_DELAY_MS = 60_000;

/** AWS or the helper refused, as opposed to the server being unreachable. */
class BedrockTokenRefused extends Error {}

let refreshTimer: NodeJS.Timeout | undefined;
let inFlight: { key: string; promise: Promise<StoredBedrockToken> } | undefined;
let warned = false;
let notifyChanged: () => void = () => undefined;

function nowSeconds(): number {
  return Date.now() / 1000;
}

async function readStored(): Promise<StoredBedrockToken | undefined> {
  return parseStoredToken(await state.extensionContext?.secrets.get(SECRET_KEY));
}

/** Mint and store a token. Concurrent callers for one profile and region share
 *  a request: a turn's sub-agents can all ask at the moment the token ages. */
function mint(profile: string, region: string): Promise<StoredBedrockToken> {
  const key = `${profile}\n${region}`;
  if (inFlight?.key === key) {
    return inFlight.promise;
  }
  const promise: Promise<StoredBedrockToken> = (async () => {
    const reply = await sendControlAwait('bedrock.token.generate', { profile, region }, MINT_TIMEOUT_MS);
    if (typeof reply.error === 'string' && reply.error) {
      throw new BedrockTokenRefused(reply.error);
    }
    const token = tokenFromReply(reply, profile, region);
    if (!token) {
      throw new BedrockTokenRefused('The Kōdo server returned no token.');
    }
    await state.extensionContext?.secrets.store(SECRET_KEY, JSON.stringify(token));
    return token;
  })().finally(() => {
    if (inFlight?.promise === promise) {
      inFlight = undefined;
    }
  });
  inFlight = { key, promise };
  return promise;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function recordFailure(err: unknown): void {
  const message = errorText(err);
  kodoDiagnostics().appendLine(`[kodo] AWS Bedrock token: ${message}`);
  state.bedrockTokenState = { ...state.bedrockTokenState, error: message };
  notifyChanged();
}

function schedule(token: StoredBedrockToken | undefined): void {
  clearTimeout(refreshTimer);
  refreshTimer = undefined;
  const freshness = tokenFreshness(token, readBedrockProfile(), readBedrockRegion(), nowSeconds());
  // An unusable token is left alone: nothing mints until Bedrock is next used,
  // so a window that stopped using it doesn't keep minting forever.
  if (token && freshness !== 'unusable') {
    const delayMs = Math.max(0, (refreshDueAt(token) - nowSeconds()) * 1000);
    refreshTimer = setTimeout(() => void refreshIfDue(), delayMs);
  }
}

async function refreshIfDue(): Promise<void> {
  const profile = readBedrockProfile();
  const region = readBedrockRegion();
  const stored = await readStored();
  // Another window may have got here first, which `schedule` picks up.
  if (tokenFreshness(stored, profile, region, nowSeconds()) !== 'aging') {
    schedule(stored);
    return;
  }
  try {
    await mint(profile, region);
    warned = false;
  } catch (err) {
    recordFailure(err);
    // One message per streak of failures, and only for an answer from AWS: an
    // unreachable server is usually a restart, which the retry rides out.
    if (err instanceof BedrockTokenRefused && !warned) {
      warned = true;
      void vscode.window.showWarningMessage(
        `Kōdo: could not refresh the AWS Bedrock token — ${err.message}`,
      );
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refreshIfDue(), RETRY_DELAY_MS);
  }
}

/** Bring the panel-facing status and the timer in line with what is stored. */
export async function syncBedrockToken(): Promise<void> {
  const stored = await readStored();
  const usable =
    tokenFreshness(stored, readBedrockProfile(), readBedrockRegion(), nowSeconds()) !== 'unusable';
  state.bedrockTokenState = {
    hasToken: usable,
    expiresAt: usable && stored ? stored.expiresAt : 0,
    error: usable ? '' : state.bedrockTokenState.error,
  };
  schedule(stored);
  notifyChanged();
}

/**
 * The token to use right now, minting one if the stored one can't serve.
 *
 * A token past its refresh point is replaced here too, because a laptop that
 * slept through the timer shouldn't start a turn on a nearly dead token. If that
 * replacement fails, the old token is still good, so it is used.
 *
 * @throws When no usable token exists and none can be minted. The message is
 *   for the user, e.g. an expired SSO login.
 */
export async function getBedrockToken(): Promise<string> {
  const profile = readBedrockProfile();
  const region = readBedrockRegion();
  const stored = await readStored();
  const freshness = tokenFreshness(stored, profile, region, nowSeconds());
  if (stored && freshness === 'fresh') {
    return stored.token;
  }
  try {
    const minted = await mint(profile, region);
    warned = false;
    return minted.token;
  } catch (err) {
    recordFailure(err);
    if (stored && freshness === 'aging') {
      return stored.token;
    }
    throw err;
  }
}

/** The stored token if it can be used, without ever minting one. */
export async function peekBedrockToken(): Promise<string | undefined> {
  const stored = await readStored();
  const freshness = tokenFreshness(stored, readBedrockProfile(), readBedrockRegion(), nowSeconds());
  return freshness === 'unusable' ? undefined : stored?.token;
}

/** Forget the stored token (the server reported it rejected by AWS). */
export async function clearBedrockToken(): Promise<void> {
  await state.extensionContext?.secrets.delete(SECRET_KEY);
  await syncBedrockToken();
}

/** Whether this window's user is on Bedrock. Nothing mints unattended for
 *  anyone else: a user of another vendor must not get AWS errors. */
export function isBedrockInUse(): boolean {
  return state.activeCloudVendorState === 'bedrock' || state.bedrockTokenState.hasToken;
}

/**
 * Start the auto-refresh for this window.
 *
 * @param context Owns the SecretStorage and the teardown of the timer.
 * @param onChanged Called whenever the status in `state.bedrockTokenState`
 *   changes. Injected because the panel push lives in `cloud-ai-settings.ts`,
 *   which imports this module.
 */
export function startBedrockTokenRefresher(context: vscode.ExtensionContext, onChanged: () => void): void {
  notifyChanged = onChanged;
  context.subscriptions.push(
    context.secrets.onDidChange((event) => {
      if (event.key === SECRET_KEY) {
        void syncBedrockToken();
      }
    }),
    { dispose: () => clearTimeout(refreshTimer) },
  );
  void syncBedrockToken();
}
