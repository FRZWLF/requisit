import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixedClock } from '../../src/clock.ts';
import { isRefusal } from '../../src/refusal.ts';
import { closeDatabase, openDatabase } from '../../src/db/open.ts';
import { migrate } from '../../src/db/migrate.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { orgScope } from '../../src/db/scope.ts';
import { instanceCreateOrg } from '../../src/db/instance.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';
import { verifyToken } from '../../src/auth/token.ts';
import { must } from '../support/seed.ts';
import { MAX_TTL_SECONDS, main } from '../../scripts/mint-token.ts';

const SECRET = 'a'.repeat(32);
const CLOCK = fixedClock('2026-09-21T10:00:00.000Z');
const OTHER_ID = '44444444-4444-4444-8444-444444444444';

interface Fixture {
  readonly dbPath: string;
  readonly orgId: string;
  readonly personId: string;
  readonly env: NodeJS.ProcessEnv;
}

function withFixture(fn: (f: Fixture) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'requisit-mint-'));
  const dbPath = join(dir, 'requisit.db');
  try {
    const db = openDatabase(dbPath);
    migrate(db, undefined, CLOCK);
    const { orgId, personId } = withTransaction(db, (tx) => {
      const org = must(instanceCreateOrg(tx, { name: 'Acme', currency: 'EUR' }, CLOCK));
      const scope = orgScope(org.id, { personId: null, kind: 'system', roles: new Set() });
      const person = must(
        peopleRepo(db, scope, CLOCK).insert(tx, { name: 'Bea', email: 'bea@example.test' }),
      );
      return { orgId: org.id, personId: person.id };
    });
    closeDatabase(db);
    fn({
      dbPath,
      orgId,
      personId,
      env: { REQUISIT_TOKEN_SECRET: SECRET, REQUISIT_DB_PATH: dbPath },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the CLI mints a token that verifies against the configured secret', () => {
  withFixture((f) => {
    const result = main(['--org', f.orgId, '--person', f.personId], f.env, CLOCK);
    assert.equal(result.code, 0, result.err);
    const claims = verifyToken(
      new Map([['1', Buffer.from(SECRET, 'utf8')]]),
      result.out.trim(),
      CLOCK,
    );
    assert.ok(!isRefusal(claims));
    assert.equal(claims.sub, f.personId);
    assert.equal(claims.org, f.orgId);
    assert.equal(claims.exp - claims.iat, 86_400);
  });
});

test('--ttl is honoured', () => {
  withFixture((f) => {
    const result = main(['--org', f.orgId, '--person', f.personId, '--ttl', '60'], f.env, CLOCK);
    assert.equal(result.code, 0, result.err);
    const claims = verifyToken(
      new Map([['1', Buffer.from(SECRET, 'utf8')]]),
      result.out.trim(),
      CLOCK,
    );
    assert.ok(!isRefusal(claims));
    assert.equal(claims.exp - claims.iat, 60);
  });
});

test('a person who is not in that organisation gets exit code 2 and no token', () => {
  withFixture((f) => {
    const result = main(['--org', f.orgId, '--person', OTHER_ID], f.env, CLOCK);
    assert.equal(result.code, 2);
    assert.equal(result.out, '');
    assert.match(result.err, /not a member/);
  });
});

test('bad usage exits 1 without touching the database', () => {
  withFixture((f) => {
    for (const argv of [
      [],
      ['--org', f.orgId],
      ['--org', 'not-a-uuid', '--person', f.personId],
      ['--org', f.orgId, '--person', f.personId, '--ttl', '0'],
      ['--org', f.orgId, '--person', f.personId, '--ttl', 'soon'],
      ['whatever'],
    ]) {
      const result = main(argv, f.env, CLOCK);
      assert.equal(result.code, 1, `expected usage failure for ${JSON.stringify(argv)}`);
      assert.equal(result.out, '');
    }
  });
});

test('a short secret stops the CLI and the value never reaches the output', () => {
  withFixture((f) => {
    const result = main(['--org', f.orgId, '--person', f.personId], {
      REQUISIT_TOKEN_SECRET: 'short',
      REQUISIT_DB_PATH: f.dbPath,
    }, CLOCK);
    assert.equal(result.code, 1);
    assert.match(result.err, /REQUISIT_TOKEN_SECRET/);
    assert.ok(!result.err.includes('short'));
  });
});

/**
 * Revocation is still open (G-013), so a token that outlives the org's secret is
 * unrecoverable. The cap turns a typo into a refusal instead of a 3 000-year credential.
 */
test('--ttl is capped, and the cap refuses without touching the database', () => {
  withFixture((f) => {
    const tooLong = main(
      ['--org', f.orgId, '--person', f.personId, '--ttl', String(MAX_TTL_SECONDS + 1)],
      f.env,
      CLOCK,
    );
    assert.equal(tooLong.code, 1);
    assert.equal(tooLong.out, '');
    assert.match(tooLong.err, /--ttl must be at most/);
    // presence: exactly at the cap still mints.
    const atCap = main(
      ['--org', f.orgId, '--person', f.personId, '--ttl', String(MAX_TTL_SECONDS)],
      f.env,
      CLOCK,
    );
    assert.equal(atCap.code, 0);
    assert.notEqual(atCap.out, '');
  });
});
