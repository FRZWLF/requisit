import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { newId } from '../../src/ids.ts';
import { REFUSAL_CODES, type RefusalCode } from '../../src/refusal.ts';
import { STATUS_BY_CODE } from '../../src/http/problem.ts';
import { call, makeApp, seedLifecycleOrg, tokenFor, type CallResult } from '../support/http.ts';

/**
 * Every code in `RefusalCode` is produced by at least one route, with the status the one
 * table gives it (D-016, D-023). Adding a code to the type without a row in `STATUS_BY_CODE`
 * does not compile; adding one without a route here fails this suite.
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
  };
}

type Fixture = ReturnType<typeof setUp>;

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `r-${String(keySeq)}`;
}

function draft(fixture: Fixture, total: number): CallResult {
  return call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.buyer,
    key: nextKey(),
    body: {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: total }],
    },
  });
}

interface CodeCase {
  readonly code: RefusalCode;
  readonly produce: (fixture: Fixture) => CallResult;
}

const CASES: readonly CodeCase[] = [
  {
    code: 'validation_failed',
    produce: (fixture) =>
      call(fixture.app, {
        method: 'POST',
        path: '/api/v1/requisitions',
        token: fixture.buyer,
        key: nextKey(),
        body: { costCentreId: fixture.seed.costCentre.id, lines: [] },
      }),
  },
  {
    code: 'unauthenticated',
    produce: (fixture) => call(fixture.app, { method: 'GET', path: '/api/v1/rules' }),
  },
  {
    code: 'not_authorised',
    produce: (fixture) => {
      const made = draft(fixture, 250_000);
      const moved = call(fixture.app, {
        method: 'POST',
        path: `/api/v1/requisitions/${String(made.json['id'])}/submit`,
        token: fixture.buyer,
        key: nextKey(),
      });
      return call(fixture.app, {
        method: 'POST',
        path: `/api/v1/requisitions/${String(made.json['id'])}/approve`,
        token: fixture.buyer,
        key: nextKey(),
        body: { version: moved.json['version'] },
      });
    },
  },
  {
    code: 'not_found',
    produce: (fixture) =>
      call(fixture.app, {
        method: 'GET',
        path: `/api/v1/requisitions/${newId()}`,
        token: fixture.buyer,
      }),
  },
  {
    code: 'wrong_state',
    produce: (fixture) => {
      const made = draft(fixture, 250_000);
      return call(fixture.app, {
        method: 'POST',
        path: `/api/v1/requisitions/${String(made.json['id'])}/approve`,
        token: fixture.owner,
        key: nextKey(),
        body: { version: 1 },
      });
    },
  },
  {
    code: 'conflict',
    produce: (fixture) => {
      const made = draft(fixture, 250_000);
      call(fixture.app, {
        method: 'POST',
        path: `/api/v1/requisitions/${String(made.json['id'])}/submit`,
        token: fixture.buyer,
        key: nextKey(),
      });
      return call(fixture.app, {
        method: 'POST',
        path: `/api/v1/requisitions/${String(made.json['id'])}/approve`,
        token: fixture.owner,
        key: nextKey(),
        body: { version: 1 },
      });
    },
  },
  {
    code: 'idempotency_key_reuse',
    produce: (fixture) => {
      const key = nextKey();
      call(fixture.app, {
        method: 'POST',
        path: '/api/v1/requisitions',
        token: fixture.buyer,
        key,
        body: {
          costCentreId: fixture.seed.costCentre.id,
          lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1_000 }],
        },
      });
      return call(fixture.app, {
        method: 'POST',
        path: '/api/v1/requisitions',
        token: fixture.buyer,
        key,
        body: {
          costCentreId: fixture.seed.costCentre.id,
          lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 2_000 }],
        },
      });
    },
  },
  {
    code: 'no_rule_matched',
    produce: (fixture) => {
      fixture.db.exec("DELETE FROM approval_rules WHERE rule_code = 'R3'");
      const made = draft(fixture, 900_000);
      return call(fixture.app, {
        method: 'POST',
        path: `/api/v1/requisitions/${String(made.json['id'])}/submit`,
        token: fixture.buyer,
        key: nextKey(),
      });
    },
  },
];

test('the case table and the refusal type have exactly the same members', () => {
  const covered = new Set(CASES.map((testCase) => testCase.code));
  const mapped = new Set(Object.keys(STATUS_BY_CODE));
  const declared = new Set<string>(REFUSAL_CODES);
  assert.deepEqual([...covered].sort(), [...declared].sort(), 'a code has no route that produces it');
  assert.deepEqual([...mapped].sort(), [...declared].sort(), 'the status table drifted from the type');
});

for (const testCase of CASES) {
  test(`${testCase.code} is produced by a route and mapped to ${String(STATUS_BY_CODE[testCase.code])}`, () => {
    const fixture = setUp();
    const answer = testCase.produce(fixture);
    assert.equal(answer.json['code'], testCase.code, answer.body);
    assert.equal(answer.status, STATUS_BY_CODE[testCase.code]);
    assert.equal(answer.json['status'], STATUS_BY_CODE[testCase.code]);
    assert.equal(answer.json['type'], `urn:requisit:problem:${testCase.code}`);
    assert.equal(answer.headers['Content-Type'], 'application/problem+json');
    assert.ok(typeof answer.json['request_id'] === 'string');
    assert.ok(typeof answer.json['title'] === 'string' && answer.json['title'] !== '');
  });
}

test('an unknown code cannot reach the mapper: a throw is 500, never a 200', () => {
  const fixture = setUp();
  const made = draft(fixture, 250_000);
  assert.equal(made.status, 201, 'presence: the route works before the fault');
  fixture.db.exec(
    `CREATE TRIGGER boom BEFORE INSERT ON audit_log
     BEGIN SELECT RAISE(ABORT, 'boom'); END`,
  );
  const answer = call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${String(made.json['id'])}/submit`,
    token: fixture.buyer,
    key: nextKey(),
    raw: Buffer.alloc(0),
  });
  assert.equal(answer.status, 500);
  assert.equal(answer.json['code'], undefined, 'a 500 carries no refusal code');
});
