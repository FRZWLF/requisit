import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { MAX_SAFE_MINOR } from '../../src/domain/money.ts';
import { newId } from '../../src/ids.ts';
import { call, makeApp, seedLifecycleOrg, tokenFor } from '../support/http.ts';

/**
 * The line set whose members are each summable but whose **sum** is not (#3 review 🔴 1).
 * Before the fix the rows were written, the refusal was returned instead of thrown, the
 * transaction committed a requisition with no audit line, the `400` was stored under the
 * caller's idempotency key and every later `GET /api/v1/requisitions` in that organisation
 * answered `400` for every member.
 */

function setUp() {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  return { db, app, seed, token: tokenFor(seed.org.id, seed.buyer.id) };
}

function counts(db: DatabaseSync): { requisitions: number; lines: number; audit: number } {
  const one = (sql: string): number =>
    (db.prepare(sql).get() as { n: number } | undefined)?.n ?? -1;
  return {
    requisitions: one('SELECT COUNT(*) AS n FROM requisitions'),
    lines: one('SELECT COUNT(*) AS n FROM requisition_lines'),
    audit: one('SELECT COUNT(*) AS n FROM audit_log'),
  };
}

const OVERFLOWING = [
  { description: 'A', quantity: 1, unitPriceMinor: MAX_SAFE_MINOR },
  { description: 'B', quantity: 1, unitPriceMinor: MAX_SAFE_MINOR },
];

test('two lines that are each safe but overflow together are refused before any write', () => {
  const fixture = setUp();
  const before = counts(fixture.db);

  const made = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.token,
    key: 'overflow-1',
    body: { costCentreId: fixture.seed.costCentre.id, lines: OVERFLOWING },
  });

  assert.equal(made.status, 400);
  assert.equal(made.json['code'], 'validation_failed');
  assert.match(String(made.json['detail']), /ceiling/);
  assert.deepEqual(counts(fixture.db), before, 'a refused create must write no row at all');

  // and the organisation's shared queue still answers
  const listed = call(fixture.app, {
    method: 'GET',
    path: '/api/v1/requisitions',
    token: fixture.token,
  });
  assert.equal(listed.status, 200);
});

test('a PATCH whose new lines overflow together leaves the draft exactly as it was', () => {
  const fixture = setUp();
  const made = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.token,
    key: 'overflow-2',
    body: {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 250_000 }],
    },
  });
  assert.equal(made.status, 201);
  const id = String(made.json['id']);
  const before = counts(fixture.db);

  const patched = call(fixture.app, {
    method: 'PATCH',
    path: `/api/v1/requisitions/${id}`,
    token: fixture.token,
    key: 'overflow-3',
    body: { lines: OVERFLOWING },
  });
  assert.equal(patched.status, 400);
  assert.deepEqual(counts(fixture.db), before, 'a refused edit must not replace the line set');

  const read = call(fixture.app, {
    method: 'GET',
    path: `/api/v1/requisitions/${id}`,
    token: fixture.token,
  });
  assert.equal(read.status, 200);
  assert.equal(read.json['version'], 1, 'the version must not have moved');
  assert.deepEqual(read.json['total'], { amountMinor: 250_000, currency: 'EUR' });
});

test('a row whose lines cannot be totalled is skipped by the list, not fatal to the page', () => {
  const fixture = setUp();
  const healthy = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.token,
    key: 'healthy-1',
    body: {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 250_000 }],
    },
  });
  assert.equal(healthy.status, 201);
  const good = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.token,
    key: 'healthy-2',
    body: {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Chair', quantity: 1, unitPriceMinor: 10_000 }],
    },
  });
  assert.equal(good.status, 201);

  // No route can produce such a row any more, so it is forged directly in the table — the
  // point of the check is that one corrupt row cannot answer 400 for the whole organisation.
  fixture.db
    .prepare(
      `UPDATE requisition_lines SET unit_price_minor = ?
        WHERE requisition_id = ?`,
    )
    .run(MAX_SAFE_MINOR, String(healthy.json['id']));
  fixture.db
    .prepare(
      `INSERT INTO requisition_lines
         (id, org_id, requisition_id, seq, catalogue_item_id, description, quantity, unit_price_minor, currency)
       VALUES (?, ?, ?, 2, NULL, 'forged', 1, ?, 'EUR')`,
    )
    .run(newId(), fixture.seed.org.id, String(healthy.json['id']), MAX_SAFE_MINOR);

  const listed = call(fixture.app, {
    method: 'GET',
    path: '/api/v1/requisitions',
    token: fixture.token,
  });
  assert.equal(listed.status, 200);
  const items = listed.json['items'] as { id: string }[];
  assert.deepEqual(
    items.map((item) => item.id),
    [String(good.json['id'])],
    'the healthy row is still listed and the corrupt one is skipped',
  );
});
