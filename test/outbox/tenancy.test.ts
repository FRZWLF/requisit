import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp, seedLifecycleOrg, tokenFor, type CallResult } from '../support/http.ts';

/**
 * `outbox/tenancy` (D-004, D-011) at the boundary: a merchant token of organisation B must
 * see none of organisation A's orders and must change none of them. The feed carries amounts
 * and line descriptions of every approval an organisation ever made, so it is the sharpest
 * cross-tenant surface in the service — and the cursor is an *integer*, which is exactly the
 * shape an attacker would enumerate if the organisation were not bound first.
 *
 * The companion cases at the repository level live in `test/db/tenancy-leak.test.ts`.
 */

function setUp() {
  const { db, app } = makeApp();
  const a = seedLifecycleOrg(db, { name: 'Org A' });
  const b = seedLifecycleOrg(db, { name: 'Org B' });
  return {
    db,
    app,
    a,
    b,
    buyerA: tokenFor(a.org.id, a.buyer.id),
    ownerA: tokenFor(a.org.id, a.owner.id),
    merchantA: tokenFor(a.org.id, a.merchant.id),
    merchantB: tokenFor(b.org.id, b.merchant.id),
  };
}

type Fixture = ReturnType<typeof setUp>;

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `x-${String(keySeq)}`;
}

function approvedInA(fixture: Fixture): string {
  const made = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.buyerA,
    key: nextKey(),
    body: {
      costCentreId: fixture.a.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 2, unitPriceMinor: 125_000 }],
    },
  });
  const id = String(made.json['id']);
  const submitted = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${id}/submit`,
    token: fixture.buyerA,
    key: nextKey(),
    body: {},
  });
  const approved = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${id}/approve`,
    token: fixture.ownerA,
    key: nextKey(),
    body: { version: submitted.json['version'] },
  });
  assert.equal(approved.status, 200, approved.body);
  return id;
}

function feedFor(fixture: Fixture, token: string): CallResult {
  return call(fixture.app, { method: 'GET', path: '/api/v1/outbox?after=0', token });
}

test("a merchant token of org B sees nothing of org A's feed", () => {
  const fixture = setUp();
  const idOfA = approvedInA(fixture);

  const asB = feedFor(fixture, fixture.merchantB);
  assert.equal(asB.status, 200, asB.body);
  assert.deepEqual(asB.json['items'], []);
  assert.equal(asB.json['cursor'], 0);

  // presence: A's own merchant does see it, so the empty answer above is tenancy, not silence.
  const asA = feedFor(fixture, fixture.merchantA);
  const items = asA.json['items'] as { requisitionId: string }[];
  assert.deepEqual(
    items.map((item) => item.requisitionId),
    [idOfA],
  );
});

test("a merchant token of org B cannot acknowledge org A's rows", () => {
  const fixture = setUp();
  const idOfA = approvedInA(fixture);
  const idOfA2 = approvedInA(fixture);
  const rowsOfA = feedFor(fixture, fixture.merchantA).json['items'] as { id: number }[];
  const throughId = rowsOfA.at(-1)?.id ?? 0;
  assert.ok(throughId > 0, 'presence: A has rows to steal');

  // B asks to acknowledge through A's highest id. B's own feed is empty, so that id is
  // beyond the end of *B's* feed — the answer is a refusal and, crucially, a no-op for A.
  const stolen = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/outbox/ack',
    token: fixture.merchantB,
    key: nextKey(),
    body: { through_id: throughId },
  });
  assert.equal(stolen.status, 400, stolen.body);
  assert.equal(stolen.json['code'], 'validation_failed');

  const stillOpen = feedFor(fixture, fixture.merchantA).json['items'] as {
    deliveredAt: string | null;
  }[];
  assert.equal(stillOpen.length, 2);
  assert.ok(
    stillOpen.every((row) => row.deliveredAt === null),
    "B stamped A's rows",
  );
  for (const id of [idOfA, idOfA2]) {
    const detail = call(fixture.app, {
      method: 'GET',
      path: `/api/v1/requisitions/${id}`,
      token: fixture.buyerA,
    });
    assert.equal(detail.json['state'], 'approved', "B moved A's requisition to ordered");
  }

  // presence: A's own merchant acknowledges the same ids and both move.
  const own = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/outbox/ack',
    token: fixture.merchantA,
    key: nextKey(),
    body: { through_id: throughId },
  });
  assert.equal(own.status, 200, own.body);
  assert.deepEqual(own.json['ordered'], [idOfA, idOfA2]);
});

/**
 * The sharper half of the previous case: B has a feed of its own, so A's ids are *within*
 * B's range and the `through_id` guard cannot be what protects A. Only `org_id` can.
 */
test("a merchant of org B with a feed of its own still cannot reach org A's rows", () => {
  const fixture = setUp();
  approvedInA(fixture);

  const buyerB = tokenFor(fixture.b.org.id, fixture.b.buyer.id);
  const ownerB = tokenFor(fixture.b.org.id, fixture.b.owner.id);
  const made = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: buyerB,
    key: nextKey(),
    body: {
      costCentreId: fixture.b.costCentre.id,
      lines: [{ description: 'Monitor', quantity: 1, unitPriceMinor: 250_000 }],
    },
  });
  const idOfB = String(made.json['id']);
  const submitted = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${idOfB}/submit`,
    token: buyerB,
    key: nextKey(),
    body: {},
  });
  call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${idOfB}/approve`,
    token: ownerB,
    key: nextKey(),
    body: { version: submitted.json['version'] },
  });

  const rowsOfA = feedFor(fixture, fixture.merchantA).json['items'] as { id: number }[];
  const rowsOfB = feedFor(fixture, fixture.merchantB).json['items'] as {
    id: number;
    requisitionId: string;
  }[];
  assert.equal(rowsOfB.length, 1);
  assert.equal(rowsOfB[0]?.requisitionId, idOfB);
  const highestOfA = rowsOfA.at(-1)?.id ?? 0;
  const highestOfB = rowsOfB.at(-1)?.id ?? 0;
  assert.ok(highestOfB > highestOfA, 'presence: A\'s id is inside B\'s range');

  // B acknowledges through an id that covers A's row numerically. A must be untouched.
  const acked = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/outbox/ack',
    token: fixture.merchantB,
    key: nextKey(),
    body: { through_id: highestOfB },
  });
  assert.equal(acked.status, 200, acked.body);
  assert.deepEqual(acked.json['ordered'], [idOfB]);

  const afterA = feedFor(fixture, fixture.merchantA).json['items'] as {
    deliveredAt: string | null;
  }[];
  assert.equal(afterA.length, 1);
  assert.equal(afterA[0]?.deliveredAt, null, "B's acknowledgement stamped A's row");
});
