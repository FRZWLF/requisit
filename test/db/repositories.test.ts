import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefusal } from '../../src/refusal.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';
import { costCentresRepo } from '../../src/db/repos/cost-centres.ts';
import { catalogueRepo } from '../../src/db/repos/catalogue.ts';
import { requisitionsRepo } from '../../src/db/repos/requisitions.ts';
import { sumMoney, lineTotal } from '../../src/domain/money.ts';
import { makeDb } from '../support/db.ts';
import { must, seedOrg, TEST_CLOCK } from '../support/seed.ts';

function fixture() {
  const db = makeDb();
  const { org, scope, buyer } = seedOrg(db);
  const costCentreId = withTransaction(db, (tx) =>
    must(
      costCentresRepo(db, scope, TEST_CLOCK).insert(tx, {
        code: 'CC-1',
        name: 'Ops',
        ownerPersonId: buyer.id,
      }),
    ).id,
  );
  return { db, org, scope, buyer, costCentreId };
}

test('requisition numbers come from the organisation counter and are stable per organisation', () => {
  const { db, scope, buyer, costCentreId } = fixture();
  const numbers = withTransaction(db, (tx) => {
    const repo = requisitionsRepo(db, scope, TEST_CLOCK);
    return [1, 2, 3].map(
      () =>
        must(
          repo.insertDraft(tx, {
            buyerPersonId: buyer.id,
            costCentreId,
            lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
          }),
        ).number,
    );
  });
  assert.deepEqual(numbers, ['REQ-2026-000001', 'REQ-2026-000002', 'REQ-2026-000003']);

  // A second organisation starts at 1 again — the counter is per organisation (D-017).
  const other = seedOrg(db, { name: 'Org B' });
  const otherCostCentre = withTransaction(db, (tx) =>
    must(
      costCentresRepo(db, other.scope, TEST_CLOCK).insert(tx, {
        code: 'CC-1',
        name: 'Ops',
        ownerPersonId: other.buyer.id,
      }),
    ).id,
  );
  const first = withTransaction(db, (tx) =>
    must(
      requisitionsRepo(db, other.scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: other.buyer.id,
        costCentreId: otherCostCentre,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
      }),
    ),
  );
  assert.equal(first.number, 'REQ-2026-000001');
});

test('a draft takes the organisation currency and refuses an unusable line', () => {
  const { db, org, scope, buyer, costCentreId } = fixture();
  const draft = withTransaction(db, (tx) =>
    must(
      requisitionsRepo(db, scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: buyer.id,
        costCentreId,
        lines: [
          { description: 'Laptop', quantity: 2, unitPriceMinor: 129_900 },
          { description: 'Dock', quantity: 1, unitPriceMinor: 19_900 },
        ],
      }),
    ),
  );
  assert.equal(draft.currency, org.currency);
  assert.equal(draft.state, 'draft');
  assert.equal(draft.lines.length, 2);
  assert.deepEqual(
    draft.lines.map((line) => line.seq),
    [1, 2],
  );

  // The total is computed from the lines, never stored (D-003).
  const total = sumMoney(
    draft.currency,
    draft.lines.map((line) => must(lineTotal(line.unitPriceMinor, line.quantity, line.currency))),
  );
  assert.deepEqual(total, { amountMinor: 279_700, currency: 'EUR' });
  assert.ok(!Object.hasOwn(draft, 'total'));

  for (const lines of [
    [],
    [{ description: '', quantity: 1, unitPriceMinor: 100 }],
    [{ description: 'x', quantity: 0, unitPriceMinor: 100 }],
    [{ description: 'x', quantity: 1.5, unitPriceMinor: 100 }],
    [{ description: 'x', quantity: 1, unitPriceMinor: -1 }],
    [{ description: 'x', quantity: Number.NaN, unitPriceMinor: 100 }],
  ]) {
    withTransaction(db, (tx) => {
      const result = requisitionsRepo(db, scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: buyer.id,
        costCentreId,
        lines,
      });
      assert.ok(isRefusal(result), `expected a refusal for ${JSON.stringify(lines)}`);
      assert.equal(isRefusal(result) ? result.code : '', 'validation_failed');
    });
  }
});

test('byId returns the lines in order and list filters within the organisation', () => {
  const { db, scope, buyer, costCentreId } = fixture();
  const draft = withTransaction(db, (tx) =>
    must(
      requisitionsRepo(db, scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: buyer.id,
        costCentreId,
        lines: [
          { description: 'A', quantity: 1, unitPriceMinor: 100 },
          { description: 'B', quantity: 2, unitPriceMinor: 200 },
        ],
      }),
    ),
  );
  const repo = requisitionsRepo(db, scope, TEST_CLOCK);
  const read = must(repo.byId(draft.id));
  assert.deepEqual(
    read.lines.map((line) => line.description),
    ['A', 'B'],
  );
  assert.equal(repo.list({ state: 'draft' }).length, 1);
  assert.equal(repo.list({ state: 'approved' }).length, 0);
  assert.equal(repo.list({ buyerPersonId: buyer.id }).length, 1);
  assert.equal(repo.list({ buyerPersonId: 'someone-else' }).length, 0);
});

test('a catalogue item is validated before it is stored', () => {
  const { db, scope } = fixture();
  withTransaction(db, (tx) => {
    const repo = catalogueRepo(db, scope, TEST_CLOCK);
    assert.ok(
      isRefusal(repo.insert(tx, { sku: '', name: 'x', unitPriceMinor: 1, currency: 'EUR' })),
    );
    assert.ok(
      isRefusal(repo.insert(tx, { sku: 'S', name: 'x', unitPriceMinor: -1, currency: 'EUR' })),
    );
    assert.ok(
      isRefusal(repo.insert(tx, { sku: 'S', name: 'x', unitPriceMinor: 1, currency: 'XXX' })),
    );
    const ok = must(
      repo.insert(tx, { sku: 'S', name: 'Laptop', unitPriceMinor: 1, currency: 'EUR' }),
    );
    assert.equal(ok.active, true);
    const inactive = must(
      repo.insert(tx, {
        sku: 'S2',
        name: 'Old',
        unitPriceMinor: 1,
        currency: 'EUR',
        active: false,
      }),
    );
    assert.equal(inactive.active, false);
  });
  const repo = catalogueRepo(db, scope, TEST_CLOCK);
  assert.equal(repo.list().length, 2);
  assert.equal(repo.list({ activeOnly: true }).length, 1);
});

test('people and roles round-trip, and an unknown person is not_found', () => {
  const { db, scope, buyer } = fixture();
  const repo = peopleRepo(db, scope, TEST_CLOCK);
  assert.equal(must(repo.byId(buyer.id)).email, 'bea@example.test');
  assert.ok(isRefusal(repo.byId('no-such-person')));
  assert.deepEqual([...repo.rolesOf(buyer.id)], ['buyer']);
  assert.deepEqual([...repo.rolesOf('no-such-person')], []);
  withTransaction(db, (tx) => {
    // Granting twice is not a conflict — the grant is the state, not the event.
    must(repo.grantRole(tx, buyer.id, 'buyer'));
  });
  assert.deepEqual([...repo.rolesOf(buyer.id)], ['buyer']);
  assert.equal(repo.list().length, 1);
});

test('a repository refuses a transaction from another connection', () => {
  const { db, scope } = fixture();
  const other = makeDb();
  assert.throws(
    () =>
      withTransaction(other, (tx) =>
        peopleRepo(db, scope, TEST_CLOCK).insert(tx, { name: 'x', email: 'x@example.test' }),
      ),
    /different database connection/,
  );
});

/* The lifecycle writes split 02 adds (D-008…D-010). */

function draftFor(context: ReturnType<typeof fixture>, unitPriceMinor: number) {
  return withTransaction(context.db, (tx) =>
    must(
      requisitionsRepo(context.db, context.scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: context.buyer.id,
        costCentreId: context.costCentreId,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor }],
      }),
    ),
  );
}

test('replaceDraft swaps the whole line set, bumps the version and keeps the id', () => {
  const context = fixture();
  const repo = requisitionsRepo(context.db, context.scope, TEST_CLOCK);
  const made = draftFor(context, 1_000);
  const changed = withTransaction(context.db, (tx) =>
    must(
      repo.replaceDraft(tx, made.id, {
        lines: [
          { description: 'Monitor', quantity: 2, unitPriceMinor: 30_000 },
          { description: 'Cable', quantity: 1, unitPriceMinor: 500 },
        ],
      }),
    ),
  );
  assert.equal(changed.id, made.id);
  assert.equal(changed.version, made.version + 1);
  assert.deepEqual(
    changed.lines.map((line) => [line.seq, line.description]),
    [
      [1, 'Monitor'],
      [2, 'Cable'],
    ],
  );
  assert.equal(must(repo.byId(made.id)).lines.length, 2, 'the old lines survived');
});

test('replaceDraft refuses a bad line before it writes anything', () => {
  const context = fixture();
  const repo = requisitionsRepo(context.db, context.scope, TEST_CLOCK);
  const made = draftFor(context, 1_000);
  const refused = withTransaction(context.db, (tx) =>
    repo.replaceDraft(tx, made.id, {
      lines: [
        { description: 'Fine', quantity: 1, unitPriceMinor: 1 },
        { description: '  ', quantity: 1, unitPriceMinor: 1 },
      ],
    }),
  );
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'validation_failed');
  const after = must(repo.byId(made.id));
  assert.equal(after.version, made.version, 'the version moved on a refusal');
  assert.deepEqual(after.lines.map((line) => line.description), ['Laptop']);
});

test('transition moves the row under its version guard and throws when the guard misses', () => {
  const context = fixture();
  const repo = requisitionsRepo(context.db, context.scope, TEST_CLOCK);
  const made = draftFor(context, 1_000);
  const moved = withTransaction(context.db, (tx) =>
    repo.transition(tx, {
      id: made.id,
      expectedVersion: made.version,
      toState: 'submitted',
      ruleId: null,
      ruleCode: 'R9',
      submittedAt: '2026-09-21T10:00:00.000Z',
      decidedAt: null,
    }),
  );
  assert.equal(moved.state, 'submitted');
  assert.equal(moved.version, made.version + 1);
  assert.equal(moved.ruleCode, 'R9');

  assert.throws(
    () =>
      withTransaction(context.db, (tx) =>
        repo.transition(tx, {
          id: made.id,
          expectedVersion: made.version,
          toState: 'approved',
          ruleId: null,
          ruleCode: 'R9',
          submittedAt: null,
          decidedAt: null,
        }),
      ),
    /expected exactly one row/,
  );
  assert.equal(must(repo.byId(made.id)).state, 'submitted');
  assert.equal(context.db.isTransaction, false);
});

test('copyForward makes a new row with the same lines and leaves the source alone', () => {
  const context = fixture();
  const repo = requisitionsRepo(context.db, context.scope, TEST_CLOCK);
  const made = draftFor(context, 1_000);
  const before = JSON.stringify(must(repo.byId(made.id)));
  const copy = withTransaction(context.db, (tx) => must(repo.copyForward(tx, made.id)));
  assert.notEqual(copy.id, made.id);
  assert.equal(copy.copiedFromId, made.id);
  assert.equal(copy.version, 1);
  assert.notEqual(copy.number, made.number, 'the copy takes the next number');
  assert.deepEqual(
    copy.lines.map((line) => [line.seq, line.description, line.unitPriceMinor]),
    made.lines.map((line) => [line.seq, line.description, line.unitPriceMinor]),
  );
  assert.equal(JSON.stringify(must(repo.byId(made.id))), before);
});

test('listWithLines returns every line of every row, in seq order, in one pass', () => {
  const context = fixture();
  const repo = requisitionsRepo(context.db, context.scope, TEST_CLOCK);
  draftFor(context, 1_000);
  const second = withTransaction(context.db, (tx) =>
    must(
      repo.insertDraft(tx, {
        buyerPersonId: context.buyer.id,
        costCentreId: context.costCentreId,
        lines: [
          { description: 'A', quantity: 1, unitPriceMinor: 1 },
          { description: 'B', quantity: 1, unitPriceMinor: 2 },
        ],
      }),
    ),
  );
  const listed = repo.listWithLines();
  assert.equal(listed.length, 2);
  const found = listed.find((row) => row.id === second.id);
  assert.deepEqual(found?.lines.map((line) => line.description), ['A', 'B']);
  assert.equal(repo.listWithLines({ state: 'submitted' }).length, 0);
  // presence: the same filter finds the rows in the state they are actually in.
  assert.equal(repo.listWithLines({ state: 'draft' }).length, 2);
});
