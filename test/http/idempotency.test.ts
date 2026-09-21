import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fixedClock } from '../../src/clock.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { orgScope } from '../../src/db/scope.ts';
import { auditRepo } from '../../src/db/repos/audit.ts';
import { idempotencyKeysRepo } from '../../src/db/repos/idempotency.ts';
import { instanceSweepIdempotencyKeys } from '../../src/db/instance.ts';
import { endpointOf, fingerprintOf } from '../../src/http/idempotency.ts';
import { makeDb } from '../support/db.ts';
import { TEST_CLOCK } from '../support/seed.ts';
import { call, makeApp, seedLifecycleOrg, tokenFor, type CallResult } from '../support/http.ts';

/** D-010 over `dispatch`: the ledger, the replay, the reuse refusal and the sweep. */

function setUp() {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  const token = tokenFor(seed.org.id, seed.buyer.id);
  const scope = orgScope(seed.org.id, { personId: seed.buyer.id, kind: 'user', roles: new Set() });
  return { db, app, seed, token, scope };
}

function draftBodyOf(costCentreId: string, unitPriceMinor: number): Record<string, unknown> {
  return {
    costCentreId,
    lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor }],
  };
}

function auditCount(fixture: ReturnType<typeof setUp>): number {
  return auditRepo(fixture.db, fixture.scope, TEST_CLOCK).list().length;
}

function makeDraft(fixture: ReturnType<typeof setUp>, key: string, total = 250_000): CallResult {
  return call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.token,
    key,
    body: draftBodyOf(fixture.seed.costCentre.id, total),
  });
}

test('the same key and the same body replay the first response byte-for-byte', () => {
  const fixture = setUp();
  const first = makeDraft(fixture, 'k-same');
  assert.equal(first.status, 201);
  const linesAfterFirst = auditCount(fixture);

  const second = makeDraft(fixture, 'k-same');
  assert.equal(second.status, 201);
  assert.equal(second.body, first.body, 'the replayed body must be the stored bytes');
  assert.equal(second.headers['Idempotent-Replayed'], 'true');
  assert.equal(first.headers['Idempotent-Replayed'], undefined);
  assert.equal(second.headers['Location'], first.headers['Location']);
  // the body still carries the original request id; the header carries the new one
  assert.notEqual(second.headers['X-Request-Id'], first.headers['X-Request-Id']);
  assert.equal(auditCount(fixture), linesAfterFirst, 'the replay wrote a second audit line');
});

test('the same key with a different body is 409 idempotency_key_reuse and stores nothing', () => {
  const fixture = setUp();
  const first = makeDraft(fixture, 'k-reuse', 250_000);
  assert.equal(first.status, 201);

  const clash = makeDraft(fixture, 'k-reuse', 250_001);
  assert.equal(clash.status, 409);
  assert.equal(clash.json['code'], 'idempotency_key_reuse');

  // presence: the original answer is still the one the key owns.
  const again = makeDraft(fixture, 'k-reuse', 250_000);
  assert.equal(again.body, first.body);
  assert.equal(again.headers['Idempotent-Replayed'], 'true');
});

test('the same key on another requisition is a reuse, because the path is in the fingerprint', () => {
  const fixture = setUp();
  const one = makeDraft(fixture, 'k-a');
  const two = makeDraft(fixture, 'k-b');
  const submitOne = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(one.json['id'])}/submit`,
    token: fixture.token,
    key: 'shared-key',
  });
  assert.equal(submitOne.status, 200);

  const submitTwo = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(two.json['id'])}/submit`,
    token: fixture.token,
    key: 'shared-key',
  });
  assert.equal(submitTwo.status, 409, 'the same key on a second requisition must be a reuse');
  assert.equal(submitTwo.json['code'], 'idempotency_key_reuse');

  // and the second requisition really did not move
  const detail = call(fixture.app, {
    method: 'GET',
    path: `/api/v1/requisitions/${String(two.json['id'])}`,
    token: fixture.token,
  });
  assert.equal(detail.json['state'], 'draft');
});

test('the endpoint column is the route pattern, not the concrete path', () => {
  const fixture = setUp();
  const one = makeDraft(fixture, 'k-pattern');
  call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(one.json['id'])}/submit`,
    token: fixture.token,
    key: 'pattern-key',
  });
  const stored = idempotencyKeysRepo(fixture.db, fixture.scope, TEST_CLOCK).find(
    endpointOf('POST', '/api/v1/requisitions/:id/submit'),
    'pattern-key',
  );
  assert.ok(stored !== undefined, 'the key row must be filed under the pattern');
  assert.equal(stored?.endpoint, 'POST /api/v1/requisitions/:id/submit');
});

test('a missing, oversized or badly shaped idempotency key is validation_failed', () => {
  const fixture = setUp();
  const bodies = draftBodyOf(fixture.seed.costCentre.id, 1000);
  for (const key of [undefined, '', 'x'.repeat(201), 'has spaces', 'has/slash', 'héllo']) {
    const answer = call(fixture.app, {
      method: 'POST',
      path: '/api/v1/requisitions',
      token: fixture.token,
      ...(key === undefined ? {} : { key }),
      body: bodies,
    });
    assert.equal(answer.status, 400, `key ${String(key)}`);
    assert.equal(answer.json['code'], 'validation_failed');
  }
  // presence: a key of exactly 200 allowed characters is accepted.
  const accepted = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.token,
    key: `${'a'.repeat(196)}_.:-`,
    body: bodies,
  });
  assert.equal(accepted.status, 201);
});

test('a refusal is stored and replayed like a success', () => {
  const fixture = setUp();
  const draft = makeDraft(fixture, 'k-refusal-1');
  const first = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(draft.json['id'])}/approve`,
    token: fixture.token,
    key: 'k-refusal-2',
    body: { version: 1 },
  });
  assert.equal(first.status, 409, first.body);
  const second = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(draft.json['id'])}/approve`,
    token: fixture.token,
    key: 'k-refusal-2',
    body: { version: 1 },
  });
  assert.equal(second.status, first.status);
  assert.equal(second.body, first.body);
  assert.equal(second.headers['Idempotent-Replayed'], 'true');
  assert.equal(second.headers['Content-Type'], 'application/problem+json');
});

test('an injected fault on the key table leaves neither the key nor the state change', () => {
  const fixture = setUp();
  const draft = makeDraft(fixture, 'k-fault-1');
  const before = auditCount(fixture);

  fixture.db.exec(
    `CREATE TRIGGER no_keys BEFORE INSERT ON idempotency_keys
     BEGIN SELECT RAISE(ABORT, 'injected fault'); END`,
  );
  const answer = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(draft.json['id'])}/submit`,
    token: fixture.token,
    key: 'k-fault-2',
  });
  assert.equal(answer.status, 500);
  assert.equal(fixture.db.isTransaction, false);
  assert.equal(auditCount(fixture), before, 'an audit line survived the rollback');
  assert.equal(
    idempotencyKeysRepo(fixture.db, fixture.scope, TEST_CLOCK).find(
      endpointOf('POST', '/api/v1/requisitions/:id/submit'),
      'k-fault-2',
    ),
    undefined,
    'a key row survived the rollback',
  );
  const stillDraft = call(fixture.app, {
    method: 'GET',
    path: `/api/v1/requisitions/${String(draft.json['id'])}`,
    token: fixture.token,
  });
  assert.equal(stillDraft.json['state'], 'draft');

  // presence: drop the trigger and the same request succeeds, key and all.
  fixture.db.exec('DROP TRIGGER no_keys');
  const ok = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(draft.json['id'])}/submit`,
    token: fixture.token,
    key: 'k-fault-2',
  });
  assert.equal(ok.status, 200);
  assert.ok(
    idempotencyKeysRepo(fixture.db, fixture.scope, TEST_CLOCK).find(
      endpointOf('POST', '/api/v1/requisitions/:id/submit'),
      'k-fault-2',
    ) !== undefined,
  );
});

test('the fingerprint is over the method, the concrete path and the raw bytes', () => {
  const body = Buffer.from('{"a":1}', 'utf8');
  const base = fingerprintOf('POST', '/api/v1/requisitions/1/submit', body);
  assert.equal(base, fingerprintOf('POST', '/api/v1/requisitions/1/submit', body));
  assert.notEqual(base, fingerprintOf('PATCH', '/api/v1/requisitions/1/submit', body));
  assert.notEqual(base, fingerprintOf('POST', '/api/v1/requisitions/2/submit', body));
  assert.notEqual(base, fingerprintOf('POST', '/api/v1/requisitions/1/submit', Buffer.from('{"a":2}', 'utf8')));
  // a separator that cannot be forged by moving bytes between the parts
  assert.notEqual(
    fingerprintOf('POST', '/a\n/b', body),
    fingerprintOf('POST\n/a', '/b', body),
  );
  assert.match(base, /^[0-9a-f]{64}$/);
});

test('the sweep removes rows older than the cutoff, in every organisation, and nothing newer', () => {
  const db = makeDb();
  const orgA = seedLifecycleOrg(db, { name: 'Org A' });
  const orgB = seedLifecycleOrg(db, { name: 'Org B' });
  const old = fixedClock('2026-09-20T09:00:00.000Z');
  const recent = fixedClock('2026-09-21T09:30:00.000Z');

  for (const [seed, clock, key] of [
    [orgA, old, 'old-a'],
    [orgA, recent, 'new-a'],
    [orgB, old, 'old-b'],
    [orgB, recent, 'new-b'],
  ] as const) {
    const scope = orgScope(seed.org.id, {
      personId: seed.buyer.id,
      kind: 'user',
      roles: new Set(),
    });
    withTransaction(db, (tx) => {
      idempotencyKeysRepo(db, scope, clock).insert(tx, {
        endpoint: 'POST /api/v1/requisitions',
        key,
        fingerprint: 'f',
        status: 201,
        body: '{}',
      });
    });
  }

  const cutoff = '2026-09-20T10:00:00.000Z';
  const removed = withTransaction(db, (tx) => instanceSweepIdempotencyKeys(tx, cutoff));
  assert.equal(removed, 2, 'both organisations lost exactly their stale row');

  for (const seed of [orgA, orgB]) {
    const scope = orgScope(seed.org.id, {
      personId: seed.buyer.id,
      kind: 'user',
      roles: new Set(),
    });
    const repo = idempotencyKeysRepo(db, scope, TEST_CLOCK);
    const suffix = seed === orgA ? 'a' : 'b';
    assert.equal(repo.find('POST /api/v1/requisitions', `old-${suffix}`), undefined);
    // presence: the recent row is untouched.
    assert.ok(repo.find('POST /api/v1/requisitions', `new-${suffix}`) !== undefined);
  }
});
