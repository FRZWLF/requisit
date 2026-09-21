import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fixedClock } from '../../src/clock.ts';
import { isRefusal } from '../../src/refusal.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';
import { mintToken, verifyToken } from '../../src/auth/token.ts';
import { resolveScope } from '../../src/auth/scope.ts';
import { makeDb } from '../support/db.ts';
import { must, seedOrg, TEST_CLOCK } from '../support/seed.ts';
import type { OrgScope } from '../../src/db/scope.ts';

const SECRET = Buffer.from('a'.repeat(32), 'utf8');
const KEYS = new Map([['1', SECRET]]);
const CLOCK = fixedClock('2026-09-21T10:00:00.000Z');

function rolesFor(scope: OrgScope): string[] {
  return [...scope.actor.roles].sort();
}

test('the same token follows the roles in the database, at the moment it is used', () => {
  const db = makeDb();
  const { org, buyer } = seedOrg(db, { roles: ['buyer'] });
  const token = mintToken(
    { kid: '1', secret: SECRET },
    { sub: buyer.id, org: org.id, ttlSeconds: 3600 },
    CLOCK,
  );
  const claims = verifyToken(KEYS, token, CLOCK);
  assert.ok(!isRefusal(claims));

  const first = resolveScope(db, claims);
  assert.ok(!isRefusal(first));
  assert.deepEqual(rolesFor(first), ['buyer']);
  assert.equal(first.actor.kind, 'user');
  assert.equal(first.actor.personId, buyer.id);

  withTransaction(db, (tx) => {
    must(peopleRepo(db, first, TEST_CLOCK).grantRole(tx, buyer.id, 'approver'));
  });
  const second = resolveScope(db, claims);
  assert.ok(!isRefusal(second));
  assert.deepEqual(rolesFor(second), ['approver', 'buyer'], 'nothing may be cached');

  withTransaction(db, (tx) => {
    const repo = peopleRepo(db, second, TEST_CLOCK);
    must(repo.revokeRole(tx, buyer.id, 'approver'));
    must(repo.revokeRole(tx, buyer.id, 'buyer'));
  });
  const third = resolveScope(db, claims);
  assert.ok(!isRefusal(third), 'an identity with no authority is still an identity');
  assert.deepEqual(rolesFor(third), []);
});

test('a person who is gone from the organisation is unauthenticated, not not_authorised', () => {
  const db = makeDb();
  const { org, buyer, scope } = seedOrg(db);
  const claims = verifyToken(
    KEYS,
    mintToken({ kid: '1', secret: SECRET }, { sub: buyer.id, org: org.id, ttlSeconds: 3600 }, CLOCK),
    CLOCK,
  );
  assert.ok(!isRefusal(claims));
  // presence: before the deletion the very same claims resolve.
  assert.ok(!isRefusal(resolveScope(db, claims)));

  withTransaction(db, (tx) => {
    must(peopleRepo(db, scope, TEST_CLOCK).revokeRole(tx, buyer.id, 'buyer'));
    tx.db.prepare('DELETE FROM people WHERE org_id = ? AND id = ?').run(org.id, buyer.id);
  });

  const refused = resolveScope(db, claims);
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'unauthenticated');
});

test('a token for another organisation resolves to nothing', () => {
  const db = makeDb();
  const a = seedOrg(db, { name: 'Org A' });
  const b = seedOrg(db, { name: 'Org B' });
  const claims = verifyToken(
    KEYS,
    mintToken(
      { kid: '1', secret: SECRET },
      { sub: a.buyer.id, org: b.org.id, ttlSeconds: 3600 },
      CLOCK,
    ),
    CLOCK,
  );
  assert.ok(!isRefusal(claims));
  const refused = resolveScope(db, claims);
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'unauthenticated');
  // presence: the same person resolves inside their own organisation.
  const ownClaims = verifyToken(
    KEYS,
    mintToken(
      { kid: '1', secret: SECRET },
      { sub: a.buyer.id, org: a.org.id, ttlSeconds: 3600 },
      CLOCK,
    ),
    CLOCK,
  );
  assert.ok(!isRefusal(ownClaims));
  assert.ok(!isRefusal(resolveScope(db, ownClaims)));
});
