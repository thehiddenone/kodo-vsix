import * as assert from 'assert';

import {
  BEDROCK_REFRESH_FRACTION,
  parseStoredToken,
  refreshDueAt,
  tokenFreshness,
  tokenFromReply,
  type StoredBedrockToken,
} from '../bedrock-token-policy';
import { CUSTOM_PROFILE_VALUE, DEFAULT_CHAIN_VALUE, selectedProfileValue } from '../settings-webview/bedrockProfile';
import { initial, reducer } from '../settings-webview/reducer';

const token: StoredBedrockToken = {
  token: 'bedrock-api-key-t',
  issuedAt: 1000,
  expiresAt: 4600,
  profile: 'work',
  region: 'us-east-1',
};

suite('Bedrock token refresh rules', () => {
  test('a token is due at 75% of its lifetime', () => {
    assert.strictEqual(BEDROCK_REFRESH_FRACTION, 0.75);
    assert.strictEqual(refreshDueAt(token), 3700);
  });

  test('the refresh point follows a shorter real lifetime', () => {
    // An AWS session that ends in 20 minutes gives a 20-minute token, which an
    // assumed hour would only refresh long after it died.
    assert.strictEqual(refreshDueAt({ ...token, expiresAt: 2200 }), 1900);
  });

  test('a token is fresh before the refresh point', () => {
    assert.strictEqual(tokenFreshness(token, 'work', 'us-east-1', 3699), 'fresh');
  });

  test('a token is aging from the refresh point until it expires', () => {
    assert.strictEqual(tokenFreshness(token, 'work', 'us-east-1', 3700), 'aging');
    assert.strictEqual(tokenFreshness(token, 'work', 'us-east-1', 4599), 'aging');
  });

  test('an expired token is unusable', () => {
    assert.strictEqual(tokenFreshness(token, 'work', 'us-east-1', 4600), 'unusable');
  });

  test('a missing token is unusable', () => {
    assert.strictEqual(tokenFreshness(undefined, 'work', 'us-east-1', 0), 'unusable');
  });

  test('a token from another profile is unusable', () => {
    assert.strictEqual(tokenFreshness(token, 'personal', 'us-east-1', 1000), 'unusable');
  });

  test('a token from another region is unusable', () => {
    assert.strictEqual(tokenFreshness(token, 'work', 'eu-west-1', 1000), 'unusable');
  });
});

suite('Bedrock token storage', () => {
  test('a stored token reads back with its timestamps', () => {
    assert.deepStrictEqual(parseStoredToken(JSON.stringify(token)), token);
  });

  for (const [label, raw] of [
    ['nothing', undefined],
    ['an empty string', ''],
    ['text that is not JSON', 'not json'],
    ['JSON null', 'null'],
    ['a token without timestamps', '{"token":"t","profile":"","region":"r"}'],
    ['an empty token', JSON.stringify({ ...token, token: '' })],
  ] as const) {
    test(`${label} reads as no token`, () => {
      assert.strictEqual(parseStoredToken(raw), undefined);
    });
  }

  test('a server reply is labelled with what was requested', () => {
    const reply = { token: 't', issued_at: 10, expires_at: 20 };
    assert.deepStrictEqual(tokenFromReply(reply, 'work', 'eu-west-1'), {
      token: 't', issuedAt: 10, expiresAt: 20, profile: 'work', region: 'eu-west-1',
    });
  });

  test('a server reply without a token gives none', () => {
    assert.strictEqual(tokenFromReply({ error: 'expired' }, 'work', 'eu-west-1'), undefined);
  });
});

suite('Bedrock profile dropdown', () => {
  const listed = ['default', 'work'];

  test('no saved profile selects the default credential chain', () => {
    assert.strictEqual(selectedProfileValue('', listed, false), DEFAULT_CHAIN_VALUE);
  });

  test('a listed profile selects itself', () => {
    assert.strictEqual(selectedProfileValue('work', listed, false), 'work');
  });

  test('a saved profile that is not listed comes back as Custom', () => {
    assert.strictEqual(selectedProfileValue('other', listed, false), CUSTOM_PROFILE_VALUE);
  });

  test('picking Custom selects it before any name is typed', () => {
    assert.strictEqual(selectedProfileValue('', listed, true), CUSTOM_PROFILE_VALUE);
  });
});

suite('settings reducer — Bedrock', () => {
  test('a fresh panel starts on the default credential chain with no token', () => {
    assert.strictEqual(initial.bedrockProfile, '');
    assert.deepStrictEqual(initial.bedrockProfiles, []);
    assert.strictEqual(initial.bedrockToken.hasToken, false);
  });

  test('a patch carrying the Bedrock fields reaches the state', () => {
    const bedrockToken = { hasToken: true, expiresAt: 5, error: '' };
    const next = reducer(initial, {
      type: 'patch',
      data: { bedrockProfile: 'work', bedrockProfiles: ['work'], bedrockToken },
    });
    assert.strictEqual(next.bedrockProfile, 'work');
    assert.deepStrictEqual(next.bedrockProfiles, ['work']);
    assert.deepStrictEqual(next.bedrockToken, bedrockToken);
  });

  test('going back to the default chain is not mistaken for a missing field', () => {
    const custom = reducer(initial, { type: 'patch', data: { bedrockProfile: 'work' } });
    const next = reducer(custom, { type: 'patch', data: { bedrockProfile: '' } });
    assert.strictEqual(next.bedrockProfile, '');
  });
});
