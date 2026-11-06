/**
 * When a stored AWS Bedrock bearer token can be used and when it must be
 * replaced (kodo/doc/LLM_REGISTRY.md §3b). Pure on purpose: no `vscode` import,
 * so the rules can be tested on their own. `extension/bedrock-token.ts` owns
 * the secret and the timer.
 *
 * All times are epoch seconds, as the server sends them.
 */

/** Replace a token once it has used this fraction of its lifetime. */
export const BEDROCK_REFRESH_FRACTION = 0.75;

/** What SecretStorage holds. `profile` and `region` are stored with the token
 *  because it is only good for what it was minted from: a short-term key works
 *  only in its own region, and it carries the identity of its own profile. */
export interface StoredBedrockToken {
  token: string;
  issuedAt: number;
  expiresAt: number;
  profile: string;
  region: string;
}

/**
 * - `fresh`: use it as is.
 * - `aging`: past the refresh point but still working, so replace it, and fall
 *   back on it if replacing fails.
 * - `unusable`: never send it, because it is missing, expired, or minted from a
 *   different profile or region.
 */
export type BedrockTokenFreshness = 'fresh' | 'aging' | 'unusable';

/** When *token* becomes due for replacement. Measured from its own lifetime,
 *  which is shorter than an hour when the AWS session behind it ends sooner. */
export function refreshDueAt(token: StoredBedrockToken): number {
  return token.issuedAt + (token.expiresAt - token.issuedAt) * BEDROCK_REFRESH_FRACTION;
}

export function tokenFreshness(
  token: StoredBedrockToken | undefined,
  profile: string,
  region: string,
  now: number,
): BedrockTokenFreshness {
  if (!token || token.profile !== profile || token.region !== region || now >= token.expiresAt) {
    return 'unusable';
  }
  return now >= refreshDueAt(token) ? 'aging' : 'fresh';
}

/** Read a stored secret back; anything malformed counts as no token. */
export function parseStoredToken(raw: string | undefined): StoredBedrockToken | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const value = JSON.parse(raw) as Partial<StoredBedrockToken> | null;
    if (
      value
      && typeof value.token === 'string' && value.token
      && typeof value.issuedAt === 'number'
      && typeof value.expiresAt === 'number'
      && typeof value.profile === 'string'
      && typeof value.region === 'string'
    ) {
      return value as StoredBedrockToken;
    }
  } catch {
    // Falls through to "no token": the next use mints a new one.
  }
  return undefined;
}

/** The token in a `bedrock.token.generate.ack`, labelled with what it was
 *  requested for. `undefined` when the reply has no usable token. */
export function tokenFromReply(
  reply: Record<string, unknown>,
  profile: string,
  region: string,
): StoredBedrockToken | undefined {
  const { token, issued_at: issuedAt, expires_at: expiresAt } = reply;
  if (typeof token !== 'string' || !token || typeof issuedAt !== 'number' || typeof expiresAt !== 'number') {
    return undefined;
  }
  return { token, issuedAt, expiresAt, profile, region };
}
