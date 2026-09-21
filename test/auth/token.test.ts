import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { fixedClock } from '../../src/clock.ts';
import { isRefusal } from '../../src/refusal.ts';
import {
  IAT_SKEW_SECONDS,
  MAX_TOKEN_LENGTH,
  mintToken,
  verifyToken,
} from '../../src/auth/token.ts';

const SECRET = Buffer.from('a'.repeat(32), 'utf8');
const OTHER_SECRET = Buffer.from('b'.repeat(32), 'utf8');
const KEYS = new Map([['1', SECRET]]);
const NOW = fixedClock('2026-09-21T10:00:00.000Z');
const SUB = '11111111-1111-4111-8111-111111111111';
/** 2026-09-21T10:00:00Z as integer Unix seconds, derived independently of the token code. */
const NOW_SECONDS = 1_789_984_800;
const ORG = '22222222-2222-4222-8222-222222222222';

function mint(clock = NOW, secret = SECRET, ttlSeconds = 3600): string {
  return mintToken({ kid: '1', secret }, { sub: SUB, org: ORG, ttlSeconds }, clock);
}

function assertUnauthenticated(token: unknown, label: string, clock = NOW): void {
  let result: unknown;
  assert.doesNotThrow(() => {
    result = verifyToken(KEYS, token, clock);
  }, `${label}: verification must never throw`);
  assert.ok(isRefusal(result), `${label}: expected a refusal, got ${JSON.stringify(result)}`);
  assert.equal(isRefusal(result) ? result.code : '', 'unauthenticated', label);
}

test('a minted token round-trips to its claims', () => {
  const token = mint();
  assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const claims = verifyToken(KEYS, token, NOW);
  assert.ok(!isRefusal(claims));
  assert.equal(NOW_SECONDS, Math.floor(Date.parse('2026-09-21T10:00:00.000Z') / 1000));
  assert.deepEqual(claims, {
    sub: SUB,
    org: ORG,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 3600,
    kid: '1',
  });
});

test('roles are not in the token (D-005)', () => {
  const payload = JSON.parse(
    Buffer.from(mint().split('.')[1] as string, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'kid', 'org', 'sub']);
});

test('a tampered payload is refused, not thrown', () => {
  const [version, payloadB64, signature] = mint().split('.') as [string, string, string];
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
    org: string;
  };
  payload.org = '33333333-3333-4333-8333-333333333333';
  const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  assertUnauthenticated(`${version}.${forged}.${signature}`, 'tampered payload');
});

test('a tampered signature is refused', () => {
  const parts = mint().split('.') as [string, string, string];
  const flipped = parts[2].startsWith('A') ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;
  assertUnauthenticated(`${parts[0]}.${parts[1]}.${flipped}`, 'tampered signature');
});

test('a token signed with another secret is refused', () => {
  assertUnauthenticated(mint(NOW, OTHER_SECRET), 'foreign secret');
});

test('an expired token is refused, and one second before expiry is not', () => {
  const token = mint(NOW, SECRET, 60);
  assertUnauthenticated(token, 'expired', fixedClock('2026-09-21T10:01:00.000Z'));
  assert.ok(!isRefusal(verifyToken(KEYS, token, fixedClock('2026-09-21T10:00:59.000Z'))));
});

test('a token issued too far in the future is refused; the skew window is not', () => {
  const future = mint(fixedClock('2026-09-21T10:02:00.000Z'));
  assertUnauthenticated(future, 'issued in the future');
  const withinSkew = mint(
    fixedClock(new Date(Date.parse('2026-09-21T10:00:00.000Z') + IAT_SKEW_SECONDS * 1000).toISOString()),
  );
  assert.ok(!isRefusal(verifyToken(KEYS, withinSkew, NOW)));
});

test('the version is inside the signature: a prefix swap does not verify', () => {
  const parts = mint().split('.') as [string, string, string];
  assertUnauthenticated(`v2.${parts[1]}.${parts[2]}`, 'version swap');
});

test('an unknown kid is refused', () => {
  const token = mintToken({ kid: '9', secret: SECRET }, { sub: SUB, org: ORG, ttlSeconds: 60 }, NOW);
  assertUnauthenticated(token, 'unknown kid');
});

test('malformed input of every shape is refused and never throws', () => {
  const parts = mint().split('.') as [string, string, string];
  const cases: [unknown, string][] = [
    ['', 'empty string'],
    ['v1', 'one part'],
    [`v1.${parts[1]}`, 'two parts'],
    [`v1.${parts[1]}.${parts[2]}.extra`, 'four parts'],
    [`v1.${parts[1]}.not+base64/url=`, 'non base64url characters'],
    ['v1...', 'empty parts'],
    [`v1.${Buffer.from('[1,2,3]', 'utf8').toString('base64url')}.${parts[2]}`, 'json array'],
    [`v1.${Buffer.from('"hello"', 'utf8').toString('base64url')}.${parts[2]}`, 'json string'],
    [`v1.${Buffer.from('not json', 'utf8').toString('base64url')}.${parts[2]}`, 'not json'],
    [
      `v1.${Buffer.from(JSON.stringify({ sub: SUB, org: ORG, iat: 1, exp: 2 }), 'utf8').toString('base64url')}.${parts[2]}`,
      'missing kid',
    ],
    [
      `v1.${Buffer.from(JSON.stringify({ sub: SUB, org: ORG, iat: 1, exp: 2, kid: '1', extra: 1 }), 'utf8').toString('base64url')}.${parts[2]}`,
      'extra field',
    ],
    [
      `v1.${Buffer.from(JSON.stringify({ sub: SUB, org: ORG, iat: '1', exp: 2, kid: '1' }), 'utf8').toString('base64url')}.${parts[2]}`,
      'iat not an integer',
    ],
    [`v1.${'A'.repeat(MAX_TOKEN_LENGTH)}.${parts[2]}`, 'over the length cap'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, 'a number'],
    [{ sub: SUB }, 'an object'],
  ];
  assert.ok(cases.length >= 15, 'presence: the malformed table has cases');
  for (const [token, label] of cases) {
    assertUnauthenticated(token, label);
  }
});

test('the signature comparison goes through timingSafeEqual', () => {
  const spy = mock.method(crypto, 'timingSafeEqual');
  try {
    const token = mint();
    assert.ok(!isRefusal(verifyToken(KEYS, token, NOW)));
    assert.ok(spy.mock.callCount() >= 1, 'timingSafeEqual was never called on the happy path');

    const parts = token.split('.') as [string, string, string];
    const before = spy.mock.callCount();
    verifyToken(KEYS, `${parts[0]}.${parts[1]}.${parts[2]}x`, NOW);
    assert.ok(
      spy.mock.callCount() === before,
      'a wrong-length signature must not reach timingSafeEqual, which throws on a length mismatch',
    );
  } finally {
    spy.mock.restore();
  }
});

test('an unknown kid still pays for one HMAC', () => {
  const hmacSpy = mock.method(crypto, 'createHmac');
  try {
    const token = mintToken(
      { kid: '9', secret: SECRET },
      { sub: SUB, org: ORG, ttlSeconds: 60 },
      NOW,
    );
    hmacSpy.mock.resetCalls();
    assert.ok(isRefusal(verifyToken(KEYS, token, NOW)));
    assert.equal(hmacSpy.mock.callCount(), 1, 'an unknown kid must cost the same as a known one');
  } finally {
    hmacSpy.mock.restore();
  }
});

test('mintToken refuses a nonsensical ttl loudly — that is a bug, not a refusal', () => {
  assert.throws(() => mint(NOW, SECRET, 0), RangeError);
  assert.throws(() => mint(NOW, SECRET, -1), RangeError);
  assert.throws(() => mint(NOW, SECRET, 1.5), RangeError);
});
