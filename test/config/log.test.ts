import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REDACTED, redactFields } from '../../src/log.ts';

/**
 * The redacting logger is one of the two places a secret could reach an output stream
 * (D-018); the other is `ConfigError`, covered in `startup.test.ts`.
 */
test('secret-shaped field names are redacted, everything else is kept', () => {
  const fields = redactFields({
    REQUISIT_TOKEN_SECRET: 'super-secret-value',
    token: 'v1.abc.def',
    authorization: 'Bearer abc',
    sessionCookie: 'c',
    password: 'p',
    orgId: 'org-1',
    count: 3,
  });
  for (const key of ['REQUISIT_TOKEN_SECRET', 'token', 'authorization', 'sessionCookie', 'password']) {
    assert.equal(fields[key], REDACTED, `${key} must be redacted`);
  }
  // presence: the redaction is selective, not a blanket that would hide the bug too.
  assert.equal(fields['orgId'], 'org-1');
  assert.equal(fields['count'], 3);
  assert.ok(!JSON.stringify(fields).includes('super-secret-value'));
});

test('redaction reaches nested objects, bearer-shaped keys and token-shaped values', () => {
  const fields = redactFields({
    orgId: 'org-1',
    bearer: 'abc',
    authHeader: 'Bearer abc',
    credential: 'c',
    // A value that looks like a personal token is redacted whatever the field is called.
    upstream: 'v1.eyJzdWIiOiJhIn0.abcDEF-_123',
    ctx: {
      requestId: 'req-1',
      token: 'v1.abc.def',
      inner: { authorization: 'Bearer x', note: 'keep me' },
    },
    headers: [{ cookie: 'c' }, 'v1.abc.def', 'plain'],
  });
  const printed = JSON.stringify(fields);
  for (const secret of ['Bearer abc', 'v1.abc.def', 'v1.eyJzdWIiOiJhIn0.abcDEF-_123', 'Bearer x']) {
    assert.ok(!printed.includes(secret), `a secret reached the log line: ${secret}`);
  }
  for (const key of ['bearer', 'authHeader', 'credential', 'upstream']) {
    assert.equal(fields[key], REDACTED, `${key} must be redacted`);
  }
  // presence: the surrounding context — the reason the line exists — is still printed.
  assert.ok(printed.includes('req-1'));
  assert.ok(printed.includes('keep me'));
  assert.ok(printed.includes('plain'));
  assert.equal(fields['orgId'], 'org-1');
});

test('a self-referential field does not hang the logger', () => {
  const cycle: Record<string, unknown> = { orgId: 'org-1' };
  cycle['self'] = cycle;
  const printed = JSON.stringify(redactFields(cycle));
  assert.ok(printed.includes('org-1'));
  assert.ok(printed.includes(REDACTED));
});
