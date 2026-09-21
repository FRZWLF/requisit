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
