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
