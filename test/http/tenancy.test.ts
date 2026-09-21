import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../../src/ids.ts';
import { ROUTES } from '../../src/http/app.ts';
import { call, makeApp, seedLifecycleOrg, tokenFor, type CallResult } from '../support/http.ts';

/**
 * Cross-organisation, at the boundary (D-004, D-016, D-014). For every route, organisation
 * B's token against organisation A's id must answer exactly what a genuinely unknown id
 * answers — the unknown id is the control, and the two bodies are compared field by field
 * with only `request_id` allowed to differ.
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
    tokenA: tokenFor(a.org.id, a.buyer.id),
    tokenB: tokenFor(b.org.id, b.buyer.id),
    ownerA: tokenFor(a.org.id, a.owner.id),
  };
}

type Fixture = ReturnType<typeof setUp>;

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `t-${String(keySeq)}`;
}

function draftIn(fixture: Fixture, seedIndex: 'a' | 'b', token: string, total = 250_000): string {
  const answer = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: nextKey(),
    body: {
      costCentreId: fixture[seedIndex].costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: total }],
    },
  });
  assert.equal(answer.status, 201, answer.body);
  return String(answer.json['id']);
}

function withoutRequestId(answer: CallResult): string {
  return JSON.stringify({ ...answer.json, request_id: null });
}

interface RouteProbe {
  readonly method: string;
  readonly suffix: string;
  readonly body?: unknown;
}

const PROBES: readonly RouteProbe[] = [
  { method: 'GET', suffix: '' },
  { method: 'PATCH', suffix: '', body: { lines: [{ description: 'X', quantity: 1, unitPriceMinor: 1 }] } },
  { method: 'POST', suffix: '/submit', body: {} },
  { method: 'POST', suffix: '/approve', body: { version: 1 } },
  { method: 'POST', suffix: '/reject', body: { version: 1, reason: 'no' } },
  { method: 'POST', suffix: '/cancel', body: {} },
  { method: 'POST', suffix: '/copy', body: {} },
];

test('the probe table covers every id-bearing route', () => {
  const idRoutes = ROUTES.filter((route) => route.pattern.includes(':id'));
  assert.equal(PROBES.length, idRoutes.length, 'a route was added without a tenancy probe');
});

for (const probe of PROBES) {
  test(`cross-org: ${probe.method} /requisitions/:id${probe.suffix} answers like an unknown id`, () => {
    const fixture = setUp();
    const idOfA = draftIn(fixture, 'a', fixture.tokenA);
    const unknown = newId();

    const foreign = call(fixture.app, {
      method: probe.method,
      path: `/api/v1/requisitions/${idOfA}${probe.suffix}`,
      token: fixture.tokenB,
      key: nextKey(),
      ...(probe.body === undefined ? {} : { body: probe.body }),
    });
    const control = call(fixture.app, {
      method: probe.method,
      path: `/api/v1/requisitions/${unknown}${probe.suffix}`,
      token: fixture.tokenB,
      key: nextKey(),
      ...(probe.body === undefined ? {} : { body: probe.body }),
    });

    assert.equal(foreign.status, 404, foreign.body);
    assert.equal(control.status, 404);
    assert.equal(withoutRequestId(foreign), withoutRequestId(control));

    // presence: organisation A sees its own row on the very same route.
    const own = call(fixture.app, {
      method: probe.method,
      path: `/api/v1/requisitions/${idOfA}${probe.suffix}`,
      token: fixture.tokenA,
      key: nextKey(),
      ...(probe.body === undefined ? {} : { body: probe.body }),
    });
    assert.notEqual(own.status, 404, `${probe.method}${probe.suffix}: A cannot see its own row`);
  });
}

test('a mutating cross-org call stores its refusal under the key like any other outcome', () => {
  const fixture = setUp();
  const idOfA = draftIn(fixture, 'a', fixture.tokenA);
  const key = nextKey();
  const first = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${idOfA}/submit`,
    token: fixture.tokenB,
    key,
    body: {},
  });
  assert.equal(first.status, 404);
  const second = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${idOfA}/submit`,
    token: fixture.tokenB,
    key,
    body: {},
  });
  assert.equal(second.body, first.body);
  assert.equal(second.headers['Idempotent-Replayed'], 'true');
  // and nothing of A moved
  const stillDraft = call(fixture.app, {
    method: 'GET',
    path: `/api/v1/requisitions/${idOfA}`,
    token: fixture.tokenA,
  });
  assert.equal(stillDraft.json['state'], 'draft');
});

test('the list shows B nothing of A, and A its own rows', () => {
  const fixture = setUp();
  const idOfA = draftIn(fixture, 'a', fixture.tokenA);
  const idOfB = draftIn(fixture, 'b', fixture.tokenB);

  for (const query of ['', '?mine=1', '?state=draft', '?awaiting_me=1']) {
    const asB = call(fixture.app, {
      method: 'GET',
      path: `/api/v1/requisitions${query}`,
      token: fixture.tokenB,
    });
    const ids = (asB.json['items'] as { id: string }[]).map((item) => item.id);
    assert.ok(!ids.includes(idOfA), `B saw A's requisition with ${query || '(no filter)'}`);
  }
  // presence: B does see its own, and A sees A's.
  const asB = call(fixture.app, { method: 'GET', path: '/api/v1/requisitions', token: fixture.tokenB });
  assert.deepEqual((asB.json['items'] as { id: string }[]).map((item) => item.id), [idOfB]);
  const asA = call(fixture.app, { method: 'GET', path: '/api/v1/requisitions', token: fixture.tokenA });
  assert.deepEqual((asA.json['items'] as { id: string }[]).map((item) => item.id), [idOfA]);
});

test('GET /rules shows each organisation only its own table', () => {
  const fixture = setUp();
  const asA = call(fixture.app, { method: 'GET', path: '/api/v1/rules', token: fixture.tokenA });
  const asB = call(fixture.app, { method: 'GET', path: '/api/v1/rules', token: fixture.tokenB });
  const idsA = new Set((asA.json['items'] as { id: string }[]).map((rule) => rule.id));
  const idsB = (asB.json['items'] as { id: string }[]).map((rule) => rule.id);
  assert.equal(idsA.size, 3, 'presence: A has its three rules');
  assert.equal(idsB.length, 3);
  for (const id of idsB) {
    assert.ok(!idsA.has(id), 'B saw a rule row of A');
  }
});

test('a cost centre of another organisation is not_found on creation, not 403', () => {
  const fixture = setUp();
  const answer = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.tokenB,
    key: nextKey(),
    body: {
      costCentreId: fixture.a.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1_000 }],
    },
  });
  assert.equal(answer.status, 404);
  assert.equal(answer.json['code'], 'not_found');
});

test('an idempotency key of one organisation is invisible to another', () => {
  const fixture = setUp();
  const key = 'shared-across-orgs';
  const madeByA = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.tokenA,
    key,
    body: {
      costCentreId: fixture.a.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1_000 }],
    },
  });
  assert.equal(madeByA.status, 201);
  const madeByB = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.tokenB,
    key,
    body: {
      costCentreId: fixture.b.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1_000 }],
    },
  });
  assert.equal(madeByB.status, 201, 'B was blocked by a key it cannot see');
  assert.notEqual(madeByB.json['id'], madeByA.json['id']);
});
