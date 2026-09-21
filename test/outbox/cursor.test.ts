import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POLL_LIMIT } from '../../src/db/repos/outbox.ts';
import { call, makeApp, seedLifecycleOrg, tokenFor, type CallResult } from '../support/http.ts';

/**
 * `outbox/cursor` (D-011, D-010): ordering, `after`, `limit` and its cap, the empty feed, the
 * replayability an at-least-once feed depends on, and the two directions of an idempotent
 * acknowledgement.
 */

function setUp() {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  return {
    db,
    app,
    seed,
    buyer: tokenFor(seed.org.id, seed.buyer.id),
    owner: tokenFor(seed.org.id, seed.owner.id),
    merchant: tokenFor(seed.org.id, seed.merchant.id),
  };
}

type Fixture = ReturnType<typeof setUp>;

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `c-${String(keySeq)}`;
}

/** Draft → submit → approve by the cost-centre owner, so exactly one order is emitted. */
function approvedRequisition(fixture: Fixture, unitPriceMinor = 125_000): string {
  const made = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.buyer,
    key: nextKey(),
    body: {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 2, unitPriceMinor }],
    },
  });
  assert.equal(made.status, 201, made.body);
  const id = String(made.json['id']);
  const submitted = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${id}/submit`,
    token: fixture.buyer,
    key: nextKey(),
    body: {},
  });
  assert.equal(submitted.status, 200, submitted.body);
  const approved = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${id}/approve`,
    token: fixture.owner,
    key: nextKey(),
    body: { version: submitted.json['version'] },
  });
  assert.equal(approved.status, 200, approved.body);
  return id;
}

function pollFeed(fixture: Fixture, query = '?after=0'): CallResult {
  return call(fixture.app, {
    method: 'GET',
    path: `/api/v1/outbox${query}`,
    token: fixture.merchant,
  });
}

interface FeedItem {
  readonly id: number;
  readonly requisitionId: string;
  readonly payload: { readonly totalMinor: number };
  readonly deliveredAt: string | null;
}

function itemsOf(answer: CallResult): FeedItem[] {
  return answer.json['items'] as unknown as FeedItem[];
}

function ack(fixture: Fixture, throughId: number, key = nextKey()): CallResult {
  return call(fixture.app, {
    method: 'POST',
    path: '/api/v1/outbox/ack',
    token: fixture.merchant,
    key,
    body: { through_id: throughId },
  });
}

test('an empty feed is an empty list, not an error', () => {
  const fixture = setUp();
  const answer = pollFeed(fixture);
  assert.equal(answer.status, 200, answer.body);
  assert.deepEqual(itemsOf(answer), []);
  assert.equal(answer.json['cursor'], 0);
  assert.equal(answer.json['nextAfter'], 0);
});

test('the feed comes back in id order and a cursor returns the remainder', () => {
  const fixture = setUp();
  const first = approvedRequisition(fixture);
  const second = approvedRequisition(fixture);
  const third = approvedRequisition(fixture);

  const all = itemsOf(pollFeed(fixture));
  assert.deepEqual(
    all.map((item) => item.requisitionId),
    [first, second, third],
  );
  assert.deepEqual(
    all.map((item) => item.id),
    [...all].sort((a, b) => a.id - b.id).map((item) => item.id),
  );

  const firstId = all[0]?.id ?? 0;
  const remainder = itemsOf(pollFeed(fixture, `?after=${String(firstId)}`));
  assert.deepEqual(
    remainder.map((item) => item.requisitionId),
    [second, third],
  );
  const past = itemsOf(pollFeed(fixture, `?after=${String(all.at(-1)?.id ?? 0)}`));
  assert.deepEqual(past, []);
});

test('a merchant paging on nothing but `nextAfter` drains the feed and stops', () => {
  // The paging contract, driven the way a client drives it (#5 fix round): every poll's
  // `after` is the previous answer's `nextAfter` and nothing else. A `nextAfter` that does
  // not advance — the mutation that left the tree green — loops here forever, and a
  // `nextAfter` past the last id loses the row.
  const fixture = setUp();
  const expected = [approvedRequisition(fixture), approvedRequisition(fixture), approvedRequisition(fixture)];

  const seen: string[] = [];
  let after = 0;
  for (let poll = 0; poll < 10; poll += 1) {
    const answer = pollFeed(fixture, `?after=${String(after)}&limit=1`);
    assert.equal(answer.status, 200, answer.body);
    const items = itemsOf(answer);
    const next = answer.json['nextAfter'];
    assert.equal(typeof next, 'number');
    if (items.length === 0) {
      // The empty answer hands back the cursor it was given, so the loop terminates.
      assert.equal(next, after);
      break;
    }
    assert.ok((next as number) > after, '`nextAfter` moved forward');
    assert.equal(next, items.at(-1)?.id);
    seen.push(...items.map((item) => item.requisitionId));
    after = next as number;
  }
  assert.deepEqual(seen, expected);
});

test('a requisition never appears twice in one drain', () => {
  const fixture = setUp();
  const ids = [approvedRequisition(fixture), approvedRequisition(fixture)];
  const seen = itemsOf(pollFeed(fixture)).map((item) => item.requisitionId);
  assert.deepEqual([...new Set(seen)].sort(), [...ids].sort());
  assert.equal(seen.length, new Set(seen).size);
});

test('limit is honoured, and capped', () => {
  const fixture = setUp();
  approvedRequisition(fixture);
  approvedRequisition(fixture);
  approvedRequisition(fixture);

  assert.equal(itemsOf(pollFeed(fixture, '?after=0&limit=2')).length, 2);
  assert.equal(itemsOf(pollFeed(fixture, '?after=0&limit=1')).length, 1);
  // Over the ceiling the answer is the ceiling, not a refusal — and with three rows that is
  // all three. The cap itself is asserted against the constant, not against a magic number.
  const huge = pollFeed(fixture, `?after=0&limit=${String(MAX_POLL_LIMIT * 10)}`);
  assert.equal(huge.status, 200, huge.body);
  assert.equal(itemsOf(huge).length, 3);
  assert.ok(MAX_POLL_LIMIT >= 1);
});

test('after and limit must be decimal integers', () => {
  const fixture = setUp();
  for (const query of ['?after=-1', '?after=abc', '?after=0x2', '?limit=0', '?limit=1e3', '?after= 1']) {
    const answer = pollFeed(fixture, query);
    assert.equal(answer.status, 400, `${query} was accepted: ${answer.body}`);
    assert.equal(answer.json['code'], 'validation_failed');
  }
  // presence: the well-formed versions of the same parameters are accepted.
  assert.equal(pollFeed(fixture, '?after=1&limit=10').status, 200);
});

test('re-polling from an older cursor returns the same rows with the same payloads', () => {
  const fixture = setUp();
  approvedRequisition(fixture);
  approvedRequisition(fixture);
  const before = itemsOf(pollFeed(fixture));
  const acked = ack(fixture, before.at(-1)?.id ?? 0);
  assert.equal(acked.status, 200, acked.body);

  const after = itemsOf(pollFeed(fixture));
  assert.deepEqual(
    after.map((item) => item.id),
    before.map((item) => item.id),
  );
  assert.deepEqual(
    after.map((item) => JSON.stringify(item.payload)),
    before.map((item) => JSON.stringify(item.payload)),
  );
  // The rows are stamped, not deleted — that is what keeps an older cursor replayable.
  assert.ok(after.every((item) => item.deliveredAt !== null));
});

test('the acknowledgement moves every covered requisition to ordered and stamps its row', () => {
  const fixture = setUp();
  const id = approvedRequisition(fixture);
  const feed = itemsOf(pollFeed(fixture));
  const answer = ack(fixture, feed[0]?.id ?? 0);
  assert.equal(answer.status, 200, answer.body);
  assert.deepEqual(answer.json['ordered'], [id]);
  assert.equal(answer.json['cursor'], feed[0]?.id);

  const detail = call(fixture.app, {
    method: 'GET',
    path: `/api/v1/requisitions/${id}`,
    token: fixture.buyer,
  });
  assert.equal(detail.json['state'], 'ordered');
  const history = detail.json['history'] as { action: string; toState: string | null }[];
  const orderLines = history.filter((line) => line.action === 'order');
  assert.equal(orderLines.length, 1, 'exactly one audit line per ordered requisition (D-007)');
  assert.equal(orderLines[0]?.toState, 'ordered');

  const stamped = itemsOf(pollFeed(fixture))[0];
  assert.ok(stamped?.deliveredAt !== null);
});

/**
 * The two halves of "acking twice changes nothing": a genuine retry carries the same key and
 * is answered with the first call's bytes (D-010), and a *fresh* acknowledgement of an
 * already acknowledged cursor is a no-op that says so.
 */
test('a retry of an acknowledgement replays the first answer byte for byte', () => {
  const fixture = setUp();
  approvedRequisition(fixture);
  const throughId = itemsOf(pollFeed(fixture)).at(-1)?.id ?? 0;
  const key = nextKey();

  const first = ack(fixture, throughId, key);
  const retry = ack(fixture, throughId, key);
  assert.equal(retry.status, first.status);
  assert.equal(retry.body, first.body);
  assert.equal(retry.headers['Idempotent-Replayed'], 'true');
});

test('a fresh acknowledgement of an already acknowledged cursor moves and changes nothing', () => {
  const fixture = setUp();
  approvedRequisition(fixture);
  const throughId = itemsOf(pollFeed(fixture)).at(-1)?.id ?? 0;

  const first = ack(fixture, throughId);
  assert.equal((first.json['ordered'] as string[]).length, 1);
  const stampedAt = itemsOf(pollFeed(fixture))[0]?.deliveredAt;
  assert.ok(stampedAt !== null);

  // A *different* idempotency key, so this is the endpoint's own idempotence and not the
  // stored-response replay above — both must hold, and they are tested separately.
  const second = ack(fixture, throughId);
  assert.equal(second.status, 200, second.body);
  assert.equal(second.headers['Idempotent-Replayed'], undefined);
  assert.deepEqual(second.json['ordered'], [], 'the second ack ordered something again');
  assert.equal(second.json['cursor'], first.json['cursor']);
  assert.equal(
    itemsOf(pollFeed(fixture))[0]?.deliveredAt,
    stampedAt,
    'the second ack rewrote delivered_at',
  );
});

test('a through_id below the cursor is a no-op, not an error, and never moves it back', () => {
  const fixture = setUp();
  approvedRequisition(fixture);
  approvedRequisition(fixture);
  const ids = itemsOf(pollFeed(fixture)).map((item) => item.id);
  const high = ids.at(-1) ?? 0;
  const low = ids[0] ?? 0;

  assert.equal(ack(fixture, high).json['cursor'], high);
  const backwards = ack(fixture, low);
  assert.equal(backwards.status, 200, backwards.body);
  assert.equal(backwards.json['cursor'], high, 'the cursor moved backwards');
  assert.deepEqual(backwards.json['ordered'], [], 'a backwards ack ordered something');

  // through_id 0 covers nothing and is still not an error.
  const zero = ack(fixture, 0);
  assert.equal(zero.status, 200);
  assert.deepEqual(zero.json['ordered'], []);
  assert.equal(zero.json['cursor'], high);
});

test('a through_id the caller never received is validation_failed', () => {
  const fixture = setUp();
  approvedRequisition(fixture);
  const last = itemsOf(pollFeed(fixture)).at(-1)?.id ?? 0;

  const beyond = ack(fixture, last + 1);
  assert.equal(beyond.status, 400, beyond.body);
  assert.equal(beyond.json['code'], 'validation_failed');
  // presence: the id one below it is accepted.
  assert.equal(ack(fixture, last).status, 200);

  for (const value of [-1, 1.5, 'x', null]) {
    const answer = call(fixture.app, {
      method: 'POST',
      path: '/api/v1/outbox/ack',
      token: fixture.merchant,
      key: nextKey(),
      body: { through_id: value },
    });
    assert.equal(answer.status, 400, `${String(value)} was accepted`);
  }
});

test('neither outbox route is open to a buyer or an approver token', () => {
  const fixture = setUp();
  approvedRequisition(fixture);
  for (const token of [fixture.buyer, fixture.owner]) {
    const polled = call(fixture.app, { method: 'GET', path: '/api/v1/outbox?after=0', token });
    assert.equal(polled.status, 403, polled.body);
    assert.equal(polled.json['code'], 'not_authorised');
    const acked = call(fixture.app, {
      method: 'POST',
      path: '/api/v1/outbox/ack',
      token,
      key: nextKey(),
      body: { through_id: 1 },
    });
    assert.equal(acked.status, 403, acked.body);
    assert.equal(acked.json['code'], 'not_authorised');
  }
  // presence: the merchant token reaches both.
  assert.equal(pollFeed(fixture).status, 200);
  assert.equal(ack(fixture, 0).status, 200);
  // and nothing was ordered by the refused calls
  assert.equal(itemsOf(pollFeed(fixture))[0]?.deliveredAt, null);
});

test('the acknowledgement needs an idempotency key like every other mutating route', () => {
  const fixture = setUp();
  const answer = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/outbox/ack',
    token: fixture.merchant,
    body: { through_id: 0 },
  });
  assert.equal(answer.status, 400, answer.body);
  assert.equal(answer.json['code'], 'validation_failed');
});
