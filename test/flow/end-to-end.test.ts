import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, closeDatabase } from '../../src/db/open.ts';
import { migrate } from '../../src/db/migrate.ts';
import { orgScope } from '../../src/db/scope.ts';
import { costCentresRepo } from '../../src/db/repos/cost-centres.ts';
import { mintToken } from '../../src/auth/token.ts';
import { createApp, dispatch, type App } from '../../src/http/app.ts';
import type { Org } from '../../src/domain/types.ts';
import { seed, type SeededOrganisation } from '../../scripts/seed.ts';
import { TEST_CLOCK } from '../support/seed.ts';
import { ACTIVE_KID, TEST_SECRET } from '../support/http.ts';

/**
 * `flow/end-to-end` — the README quickstart as code, and the Arc 1 exit criterion: from a
 * seeded database, draft → submit → reject with a reason → copy forward → approve → poll →
 * acknowledge → `ordered`, over the real route table.
 *
 * It runs against a temp-file database (removed afterwards) because that is what the README
 * tells a reader to do, and in-process through `dispatch` because a listening port would buy
 * nothing here — `test/http/server.test.ts` is the one suite that binds a socket (D-014).
 * If this suite goes red, the README is wrong.
 */

interface Demo {
  readonly app: App;
  readonly organisations: readonly SeededOrganisation[];
  readonly costCentreOf: (org: Org) => string;
}

function startDemo(t: { after: (fn: () => void) => void }): Demo {
  const dir = mkdtempSync(join(tmpdir(), 'requisit-flow-'));
  const db = openDatabase(join(dir, 'requisit.db'));
  migrate(db);
  const secret = Buffer.from(TEST_SECRET, 'utf8');
  const result = seed(
    db,
    (org, personId) =>
      mintToken(
        { kid: ACTIVE_KID, secret },
        { sub: personId, org: org.id, ttlSeconds: 3_600 },
        TEST_CLOCK,
      ),
    TEST_CLOCK,
  );
  t.after(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    app: createApp({ db, tokenKeys: new Map([[ACTIVE_KID, secret]]), clock: TEST_CLOCK }),
    organisations: result.organisations,
    costCentreOf: (org) => {
      const scope = orgScope(org.id, { personId: null, kind: 'system', roles: new Set() });
      const centre = costCentresRepo(db, scope, TEST_CLOCK).list()[0];
      assert.ok(centre !== undefined, 'the seed made a cost centre');
      return centre.id;
    },
  };
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `flow-${String(keySeq)}`;
}

interface Answer {
  readonly status: number;
  readonly json: Record<string, unknown>;
  readonly body: string;
}

function api(
  demo: Demo,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Answer {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (method !== 'GET') {
    headers['idempotency-key'] = nextKey();
  }
  const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8');
  if (raw.length > 0) {
    headers['content-type'] = 'application/json';
  }
  const response = dispatch(demo.app, { method, url: path, headers, body: raw });
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(response.body);
    json = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: response.status, json, body: response.body };
}

function tokenOf(entry: SeededOrganisation, label: string): string {
  const who = entry.people.find((person) => person.label === label);
  assert.ok(who !== undefined, `the seed has a ${label}`);
  return who.token;
}

test('the README walkthrough, end to end, against a seeded database', (t) => {
  const demo = startDemo(t);
  const acme = demo.organisations[0];
  assert.ok(acme !== undefined);
  assert.equal(acme.org.currency, 'EUR');
  const buyer = tokenOf(acme, 'buyer');
  const approver = tokenOf(acme, 'approver');
  const merchant = tokenOf(acme, 'merchant');
  const costCentreId = demo.costCentreOf(acme.org);

  // 1 · the buyer drafts two laptops: 2 × 1 299,00 EUR = 2 598,00 EUR (D-003, minor units).
  const draft = api(demo, 'POST', '/api/v1/requisitions', buyer, {
    costCentreId,
    lines: [{ description: 'Laptop 13"', quantity: 2, unitPriceMinor: 129_900 }],
  });
  assert.equal(draft.status, 201, draft.body);
  const id = String(draft.json['id']);
  assert.deepEqual(draft.json['total'], { amountMinor: 259_800, currency: 'EUR' });

  // 2 · submitted: above the `self` threshold, so the cost-centre owner decides (D-008).
  const submitted = api(demo, 'POST', `/api/v1/requisitions/${id}/submit`, buyer, {});
  assert.equal(submitted.status, 200, submitted.body);
  assert.equal(submitted.json['state'], 'submitted');
  assert.equal((submitted.json['rule'] as { ruleCode: string }).ruleCode, 'R2-owner-to-5000');

  // 3 · the approver rejects, with a reason the buyer sees verbatim (D-009).
  const rejected = api(demo, 'POST', `/api/v1/requisitions/${id}/reject`, approver, {
    version: submitted.json['version'],
    reason: 'Use the standard 14" model',
  });
  assert.equal(rejected.status, 200, rejected.body);
  assert.equal(rejected.json['state'], 'rejected');

  // 4 · the buyer copies it forward: a new draft, the rejected row untouched.
  const copied = api(demo, 'POST', `/api/v1/requisitions/${id}/copy`, buyer);
  assert.equal(copied.status, 201, copied.body);
  const copyId = String(copied.json['id']);
  assert.notEqual(copyId, id);
  assert.equal(copied.json['copiedFromId'], id);
  assert.equal(
    api(demo, 'GET', `/api/v1/requisitions/${id}`, buyer).json['state'],
    'rejected',
    'the copy changed the source',
  );

  // 5 · submitted again, 6 · and approved this time.
  const resubmitted = api(demo, 'POST', `/api/v1/requisitions/${copyId}/submit`, buyer, {});
  assert.equal(resubmitted.status, 200, resubmitted.body);
  const approved = api(demo, 'POST', `/api/v1/requisitions/${copyId}/approve`, approver, {
    version: resubmitted.json['version'],
  });
  assert.equal(approved.status, 200, approved.body);
  assert.equal(approved.json['state'], 'approved');

  // 7 · the merchant polls. Exactly one order, and its total is the recomputed line sum.
  const feed = api(demo, 'GET', '/api/v1/outbox?after=0', merchant);
  assert.equal(feed.status, 200, feed.body);
  const items = feed.json['items'] as {
    id: number;
    requisitionId: string;
    payload: { totalMinor: number; currency: string; lines: { lineTotalMinor: number }[] };
  }[];
  assert.equal(items.length, 1);
  const order = items[0];
  assert.ok(order !== undefined);
  assert.equal(order.requisitionId, copyId);
  assert.equal(order.payload.currency, 'EUR');
  assert.equal(order.payload.totalMinor, 259_800);
  assert.equal(
    order.payload.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    order.payload.totalMinor,
  );

  // 8 · the merchant acknowledges through that cursor, 9 · and the requisition is ordered.
  const acked = api(demo, 'POST', '/api/v1/outbox/ack', merchant, { through_id: order.id });
  assert.equal(acked.status, 200, acked.body);
  assert.deepEqual(acked.json['ordered'], [copyId]);
  assert.equal(acked.json['cursor'], order.id);

  const final = api(demo, 'GET', `/api/v1/requisitions/${copyId}`, buyer);
  assert.equal(final.json['state'], 'ordered');
  const history = final.json['history'] as { action: string; toState: string | null }[];
  assert.deepEqual(
    history.map((line) => line.action),
    ['draft.copied', 'submit', 'approve', 'order'],
  );
});

/**
 * The exponent-0 half of the demo (D-003). 8 000 JPY is under the organisation's `self`
 * threshold, so it approves at submission and reaches the feed without a human — and the
 * amount travels as 8 000 minor units, never as 80.00 of anything.
 */
test('the JPY organisation orders a self-approved requisition end to end', (t) => {
  const demo = startDemo(t);
  const kabuki = demo.organisations[1];
  assert.ok(kabuki !== undefined);
  assert.equal(kabuki.org.currency, 'JPY');
  const buyer = tokenOf(kabuki, 'buyer');
  const merchant = tokenOf(kabuki, 'merchant');

  const draft = api(demo, 'POST', '/api/v1/requisitions', buyer, {
    costCentreId: demo.costCentreOf(kabuki.org),
    lines: [{ description: 'Gloves, 500', quantity: 2, unitPriceMinor: 3_500 }],
  });
  assert.equal(draft.status, 201, draft.body);
  const id = String(draft.json['id']);

  const submitted = api(demo, 'POST', `/api/v1/requisitions/${id}/submit`, buyer, {});
  assert.equal(submitted.json['state'], 'approved', 'the self rule approves at submission');

  const items = api(demo, 'GET', '/api/v1/outbox?after=0', merchant).json['items'] as {
    id: number;
    payload: { totalMinor: number; currency: string };
  }[];
  assert.equal(items.length, 1);
  assert.equal(items[0]?.payload.currency, 'JPY');
  assert.equal(items[0]?.payload.totalMinor, 7_000);

  const acked = api(demo, 'POST', '/api/v1/outbox/ack', merchant, {
    through_id: items[0]?.id ?? 0,
  });
  assert.equal(acked.status, 200, acked.body);
  assert.equal(api(demo, 'GET', `/api/v1/requisitions/${id}`, buyer).json['state'], 'ordered');

  // Each organisation's feed is its own, even inside one seeded instance (D-004).
  const acme = demo.organisations[0];
  assert.ok(acme !== undefined);
  const otherFeed = api(demo, 'GET', '/api/v1/outbox?after=0', tokenOf(acme, 'merchant'));
  assert.deepEqual(otherFeed.json['items'], []);
});
