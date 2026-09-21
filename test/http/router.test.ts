import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { newId } from '../../src/ids.ts';
import { MAX_BODY_BYTES } from '../../src/http/body.ts';
import { matchPattern, matchRoute } from '../../src/http/router.ts';
import { ROUTES } from '../../src/http/app.ts';
import { call, makeApp, seedLifecycleOrg, tokenFor } from '../support/http.ts';

/**
 * The request pipeline of D-023, over `dispatch` — no socket. Every absence assertion (no
 * message in a 500, no `405`) has its presence companion in the same test.
 */

function setUp() {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  return { db, app, seed, token: tokenFor(seed.org.id, seed.buyer.id) };
}

test('matchPattern binds a UUID parameter and refuses anything else', () => {
  const id = newId();
  assert.deepEqual(matchPattern('/api/v1/requisitions/:id', `/api/v1/requisitions/${id}`), { id });
  assert.equal(matchPattern('/api/v1/requisitions/:id', '/api/v1/requisitions/not-a-uuid'), null);
  assert.equal(matchPattern('/api/v1/requisitions/:id', '/api/v1/requisitions'), null);
  assert.deepEqual(matchPattern('/api/v1/rules', '/api/v1/rules'), {});
});

test('matchRoute is method-aware and has no 405 to give away', () => {
  const found = matchRoute(ROUTES, 'GET', '/api/v1/rules');
  assert.ok(found !== null, 'presence: the rules route matches its own method');
  assert.equal(matchRoute(ROUTES, 'DELETE', '/api/v1/rules'), null);
  assert.equal(matchRoute(ROUTES, 'POST', '/api/v1/rules'), null);
});

test('an unknown path, a wrong method and a malformed id are all one 404', () => {
  const { app, token } = setUp();
  const bodies: string[] = [];
  for (const [method, path] of [
    ['GET', '/api/v1/nothing'],
    ['DELETE', '/api/v1/rules'],
    ['GET', '/api/v1/requisitions/not-a-uuid'],
    ['POST', '/api/v1/requisitions/not-a-uuid/approve'],
  ] as const) {
    const answer = call(app, { method, path, token, key: 'k-1' });
    assert.equal(answer.status, 404, `${method} ${path}`);
    assert.equal(answer.json['code'], 'not_found');
    bodies.push(JSON.stringify({ ...answer.json, request_id: null }));
  }
  assert.equal(new Set(bodies).size, 1, 'the four answers must be indistinguishable');
  // presence: a real route with a real id is not a 404.
  const ok = call(app, { method: 'GET', path: '/api/v1/rules', token });
  assert.equal(ok.status, 200);
});

test('a missing or malformed bearer token is 401 with WWW-Authenticate', () => {
  const { app } = setUp();
  for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer nonsense' }]) {
    const answer = call(app, { method: 'GET', path: '/api/v1/rules', headers });
    assert.equal(answer.status, 401);
    assert.equal(answer.json['code'], 'unauthenticated');
    assert.equal(answer.headers['WWW-Authenticate'], 'Bearer');
  }
});

test('a well-signed token for a person who is not in that organisation is 401, not 403', () => {
  const { app, seed } = setUp();
  const ghost = tokenFor(seed.org.id, newId());
  const answer = call(app, { method: 'GET', path: '/api/v1/rules', token: ghost });
  assert.equal(answer.status, 401);
  assert.equal(answer.json['code'], 'unauthenticated');
});

test('auth runs before the body and before the idempotency key', () => {
  const { app, seed } = setUp();
  // A mutating call with no key and no token must answer 401, not 400: a caller without an
  // identity may not learn anything about keys (T4).
  const answer = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    body: { costCentreId: seed.costCentre.id, lines: [] },
  });
  assert.equal(answer.status, 401);
});

test('the body limit is exactly 65 536 bytes', () => {
  const { app, seed, token } = setUp();
  const base = {
    pad: '',
    costCentreId: seed.costCentre.id,
    lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
  };
  const overhead = Buffer.byteLength(JSON.stringify(base), 'utf8');
  const atLimit = { ...base, pad: 'x'.repeat(MAX_BODY_BYTES - overhead) };
  const atLimitRaw = Buffer.from(JSON.stringify(atLimit), 'utf8');
  assert.equal(atLimitRaw.length, MAX_BODY_BYTES, 'presence: the body is exactly at the limit');
  const accepted = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-limit',
    raw: atLimitRaw,
  });
  assert.equal(accepted.status, 201);

  const overRaw = Buffer.from(JSON.stringify({ ...base, pad: 'x'.repeat(MAX_BODY_BYTES - overhead + 1) }), 'utf8');
  assert.equal(overRaw.length, MAX_BODY_BYTES + 1);
  const refused = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-over',
    raw: overRaw,
  });
  assert.equal(refused.status, 400);
  assert.match(String(refused.json['detail']), /at most 65536 bytes/);
});

test('a body that is not a JSON object, or carries a prototype key, is refused', () => {
  const { app, token } = setUp();
  for (const raw of ['[]', '"a string"', '42', 'null', 'not json at all']) {
    const answer = call(app, {
      method: 'POST',
      path: '/api/v1/requisitions',
      token,
      key: `k-${raw.slice(0, 3)}`,
      raw: Buffer.from(raw, 'utf8'),
    });
    assert.equal(answer.status, 400, raw);
    assert.equal(answer.json['code'], 'validation_failed');
  }
  const polluted = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-proto',
    raw: Buffer.from('{"__proto__":{"admin":true},"lines":[]}', 'utf8'),
  });
  assert.equal(polluted.status, 400);
  assert.match(String(polluted.json['detail']), /forbidden key/);
  const nested = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-proto-2',
    raw: Buffer.from('{"lines":[{"constructor":{"x":1}}]}', 'utf8'),
  });
  assert.equal(nested.status, 400);
  assert.match(String(nested.json['detail']), /forbidden key/);
});

test('a non-empty body must announce itself as application/json', () => {
  const { app, seed, token } = setUp();
  const answer = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-ct',
    raw: Buffer.from(JSON.stringify({ costCentreId: seed.costCentre.id, lines: [] }), 'utf8'),
    contentType: null,
  });
  assert.equal(answer.status, 400);
  assert.match(String(answer.json['detail']), /application\/json/);
  // presence: with the header, the same bytes get past the body step.
  const typed = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-ct-2',
    raw: Buffer.from(JSON.stringify({ costCentreId: seed.costCentre.id, lines: [] }), 'utf8'),
    contentType: 'application/json; charset=utf-8',
  });
  assert.equal(typed.status, 400);
  assert.match(String(typed.json['detail']), /at least one line/);
});

test('an empty body on a POST is an empty object', () => {
  const { app, seed, token } = setUp();
  const made = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-empty-1',
    body: { costCentreId: seed.costCentre.id, lines: [{ description: 'L', quantity: 1, unitPriceMinor: 900_000 }] },
  });
  assert.equal(made.status, 201);
  const submitted = call(app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(made.json['id'])}/submit`,
    token,
    key: 'k-empty-2',
  });
  assert.equal(submitted.status, 200, submitted.body);
});

test('every response carries a server-generated X-Request-Id, and the client cannot set it', () => {
  const { app, token } = setUp();
  const first = call(app, { method: 'GET', path: '/api/v1/rules', token });
  const second = call(app, {
    method: 'GET',
    path: '/api/v1/rules',
    token,
    headers: { 'x-request-id': 'attacker-chosen' },
  });
  for (const answer of [first, second]) {
    assert.match(
      String(answer.headers['X-Request-Id']),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  }
  assert.notEqual(first.headers['X-Request-Id'], second.headers['X-Request-Id']);
  assert.notEqual(second.headers['X-Request-Id'], 'attacker-chosen');
  const notFound = call(app, { method: 'GET', path: '/api/v1/nothing', token });
  assert.ok(notFound.headers['X-Request-Id'] !== undefined, '404 carries one too');
});

test('a throw becomes a 500 that carries the request id and nothing else', () => {
  const { db, app, seed, token } = setUp();
  const made = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-500-1',
    body: {
      costCentreId: seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 250_000 }],
    },
  });
  assert.equal(made.status, 201, 'presence: the same route works before the fault');

  db.exec(
    `CREATE TRIGGER boom BEFORE INSERT ON audit_log
     BEGIN SELECT RAISE(ABORT, 'a secret detail nobody may read'); END`,
  );
  const answer = call(app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(made.json['id'])}/submit`,
    token,
    key: 'k-500-2',
  });
  assert.equal(answer.status, 500);
  assert.deepEqual(Object.keys(answer.json).sort(), ['request_id', 'status', 'title', 'type']);
  assert.equal(answer.json['type'], 'about:blank');
  assert.ok(!answer.body.includes('secret detail'), 'the 500 body leaked the error message');
  assert.equal(answer.headers['Content-Type'], 'application/problem+json');
  assert.equal(db.isTransaction, false);
});

test('success bodies are camelCase JSON, problem bodies are the snake_case problem shape', () => {
  const { app, seed, token } = setUp();
  const made = call(app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: 'k-shape',
    body: {
      costCentreId: seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 250_000 }],
    },
  });
  assert.equal(made.headers['Content-Type'], 'application/json');
  assert.equal(made.headers['Location'], `/api/v1/requisitions/${String(made.json['id'])}`);
  assert.ok('buyerPersonId' in made.json && 'costCentreId' in made.json);

  const refused = call(app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(made.json['id'])}/approve`,
    token,
    key: 'k-shape-2',
    body: { version: 1 },
  });
  assert.equal(refused.headers['Content-Type'], 'application/problem+json');
  assert.ok('request_id' in refused.json);
  assert.ok(!('requestId' in refused.json));
});

test('every response carries X-Content-Type-Options: nosniff', () => {
  const fixture = setUp();
  const ok = call(fixture.app, {
    method: 'GET',
    path: '/api/v1/rules',
    token: fixture.token,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['X-Content-Type-Options'], 'nosniff');

  // and on every refusal shape too: unauthenticated, not_found and validation_failed
  for (const options of [
    { method: 'GET', path: '/api/v1/rules' },
    { method: 'GET', path: '/api/v1/nothing', token: fixture.token },
    {
      method: 'POST',
      path: '/api/v1/requisitions',
      token: fixture.token,
      key: 'nosniff-1',
      raw: Buffer.from('not json', 'utf8'),
    },
  ] as const) {
    const refused = call(fixture.app, options);
    assert.ok(refused.status >= 400, `${options.path} was expected to refuse`);
    assert.equal(refused.headers['X-Content-Type-Options'], 'nosniff', options.path);
  }
});
