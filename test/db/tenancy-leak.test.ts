import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { isRefusal } from '../../src/refusal.ts';
import { withTransaction } from '../../src/db/tx.ts';
import type { OrgScope } from '../../src/db/scope.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';
import { costCentresRepo } from '../../src/db/repos/cost-centres.ts';
import { catalogueRepo } from '../../src/db/repos/catalogue.ts';
import { rulesRepo } from '../../src/db/repos/rules.ts';
import { requisitionsRepo } from '../../src/db/repos/requisitions.ts';
import { auditRepo } from '../../src/db/repos/audit.ts';
import { makeDb } from '../support/db.ts';
import { must, seedOrg, TEST_CLOCK } from '../support/seed.ts';

/**
 * The cross-org leak suite (D-004, D-014). It is a table so that split 02 can *append* a
 * case for every path it adds; the rule is that rows are added, never removed or weakened.
 *
 * Every case does the same three things: write as A, assert B cannot see it, and — the
 * presence companion — assert A *can*. Without the third assertion the whole table would
 * pass by producing nothing at all.
 */
interface Fixture {
  readonly db: DatabaseSync;
  readonly a: OrgScope;
  readonly b: OrgScope;
}

interface LeakCase {
  readonly name: string;
  /** Returns an id written inside organisation A. */
  readonly writeAsA: (f: Fixture) => string;
  /** What B sees; must be `[]` or a refusal. */
  readonly readAsB: (f: Fixture, id: string) => unknown;
  /** What A sees; must be the row — the presence companion. */
  readonly readAsA: (f: Fixture, id: string) => unknown;
}

function setUp(): Fixture {
  const db = makeDb();
  const a = seedOrg(db, { name: 'Org A', currency: 'EUR' }).scope;
  const b = seedOrg(db, { name: 'Org B', currency: 'EUR' }).scope;
  return { db, a, b };
}

function found(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Set) {
    return value.size > 0;
  }
  return value !== undefined && !isRefusal(value);
}

function seedCostCentre(f: Fixture, scope: OrgScope): string {
  return withTransaction(f.db, (tx) => {
    const owner = must(
      peopleRepo(f.db, scope, TEST_CLOCK).insert(tx, {
        name: 'Otto Owner',
        email: `otto-${scope.orgId}@example.test`,
      }),
    );
    return must(
      costCentresRepo(f.db, scope, TEST_CLOCK).insert(tx, {
        code: 'CC-1',
        name: 'Ops',
        ownerPersonId: owner.id,
      }),
    ).id;
  });
}

function seedRequisition(f: Fixture, scope: OrgScope): string {
  const costCentreId = seedCostCentre(f, scope);
  return withTransaction(f.db, (tx) => {
    const buyer = must(
      peopleRepo(f.db, scope, TEST_CLOCK).insert(tx, {
        name: 'Bea Buyer',
        email: `bea2-${scope.orgId}@example.test`,
      }),
    );
    const requisition = must(
      requisitionsRepo(f.db, scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: buyer.id,
        costCentreId,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 129_900 }],
      }),
    );
    return requisition.id;
  });
}

const CASES: readonly LeakCase[] = [
  {
    name: 'people.byId',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) =>
        must(
          peopleRepo(f.db, f.a, TEST_CLOCK).insert(tx, {
            name: 'Paula',
            email: 'paula@example.test',
          }),
        ).id,
      ),
    readAsB: (f, id) => peopleRepo(f.db, f.b, TEST_CLOCK).byId(id),
    readAsA: (f, id) => peopleRepo(f.db, f.a, TEST_CLOCK).byId(id),
  },
  {
    name: 'people.rolesOf',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) => {
        const repo = peopleRepo(f.db, f.a, TEST_CLOCK);
        const person = must(repo.insert(tx, { name: 'Rita', email: 'rita@example.test' }));
        must(repo.grantRole(tx, person.id, 'approver'));
        return person.id;
      }),
    readAsB: (f, id) => peopleRepo(f.db, f.b, TEST_CLOCK).rolesOf(id),
    readAsA: (f, id) => peopleRepo(f.db, f.a, TEST_CLOCK).rolesOf(id),
  },
  {
    name: 'costCentres.byId',
    writeAsA: (f) => seedCostCentre(f, f.a),
    readAsB: (f, id) => costCentresRepo(f.db, f.b, TEST_CLOCK).byId(id),
    readAsA: (f, id) => costCentresRepo(f.db, f.a, TEST_CLOCK).byId(id),
  },
  {
    name: 'costCentres.list',
    writeAsA: (f) => seedCostCentre(f, f.a),
    readAsB: (f) => costCentresRepo(f.db, f.b, TEST_CLOCK).list(),
    readAsA: (f) => costCentresRepo(f.db, f.a, TEST_CLOCK).list(),
  },
  {
    name: 'catalogue.byId',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) =>
        must(
          catalogueRepo(f.db, f.a, TEST_CLOCK).insert(tx, {
            sku: 'SKU-1',
            name: 'Laptop',
            unitPriceMinor: 129_900,
            currency: 'EUR',
          }),
        ).id,
      ),
    readAsB: (f, id) => catalogueRepo(f.db, f.b, TEST_CLOCK).byId(id),
    readAsA: (f, id) => catalogueRepo(f.db, f.a, TEST_CLOCK).byId(id),
  },
  {
    name: 'rules.listBySeq',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) =>
        must(
          rulesRepo(f.db, f.a).insert(tx, {
            seq: 1,
            maxTotalMinor: 100_000,
            approverKind: 'self',
            ruleCode: 'self-under-1000',
          }),
        ).id,
      ),
    readAsB: (f) => rulesRepo(f.db, f.b).listBySeq(),
    readAsA: (f) => rulesRepo(f.db, f.a).listBySeq(),
  },
  {
    name: 'requisitions.byId',
    writeAsA: (f) => seedRequisition(f, f.a),
    readAsB: (f, id) => requisitionsRepo(f.db, f.b, TEST_CLOCK).byId(id),
    readAsA: (f, id) => requisitionsRepo(f.db, f.a, TEST_CLOCK).byId(id),
  },
  {
    name: 'requisitions.list',
    writeAsA: (f) => seedRequisition(f, f.a),
    readAsB: (f) => requisitionsRepo(f.db, f.b, TEST_CLOCK).list(),
    readAsA: (f) => requisitionsRepo(f.db, f.a, TEST_CLOCK).list(),
  },
  {
    name: 'audit.listForRequisition',
    writeAsA: (f) => {
      const requisitionId = seedRequisition(f, f.a);
      withTransaction(f.db, (tx) => {
        auditRepo(f.db, f.a, TEST_CLOCK).writeAudit(tx, {
          requisitionId,
          actorPersonId: f.a.actor.personId,
          actorKind: 'user',
          action: 'draft.created',
          fromState: null,
          toState: 'draft',
          ruleId: null,
          totalMinor: 129_900,
          currency: 'EUR',
          reason: null,
          requestId: null,
        });
      });
      return requisitionId;
    },
    readAsB: (f, id) => auditRepo(f.db, f.b, TEST_CLOCK).listForRequisition(id),
    readAsA: (f, id) => auditRepo(f.db, f.a, TEST_CLOCK).listForRequisition(id),
  },
];

test('the leak table covers every repository that exists', () => {
  assert.ok(CASES.length >= 9, `presence: ${CASES.length} read cases`);
});

for (const leakCase of CASES) {
  test(`cross-org read: ${leakCase.name} shows organisation B nothing`, () => {
    const fixture = setUp();
    const id = leakCase.writeAsA(fixture);

    const asA = leakCase.readAsA(fixture, id);
    // presence: without this, the case would pass even if nothing had been written.
    assert.ok(found(asA), `${leakCase.name}: organisation A must see its own row`);

    const asB = leakCase.readAsB(fixture, id);
    assert.ok(!found(asB), `${leakCase.name}: organisation B saw organisation A's data`);
    if (!Array.isArray(asB) && !(asB instanceof Set)) {
      assert.ok(isRefusal(asB));
      assert.equal(isRefusal(asB) ? asB.code : '', 'not_found');
    }
  });
}

test('cross-org write: granting a role to a person of another organisation is not_found', () => {
  const fixture = setUp();
  const personOfA = withTransaction(fixture.db, (tx) =>
    must(
      peopleRepo(fixture.db, fixture.a, TEST_CLOCK).insert(tx, {
        name: 'Paula',
        email: 'paula@example.test',
      }),
    ),
  );
  withTransaction(fixture.db, (tx) => {
    const repoB = peopleRepo(fixture.db, fixture.b, TEST_CLOCK);
    const granted = repoB.grantRole(tx, personOfA.id, 'admin');
    assert.ok(isRefusal(granted));
    assert.equal(isRefusal(granted) ? granted.code : '', 'not_found');
    const revoked = repoB.revokeRole(tx, personOfA.id, 'buyer');
    assert.ok(isRefusal(revoked));
  });
  // presence: the same grant through A's repository works.
  withTransaction(fixture.db, (tx) => {
    const granted = peopleRepo(fixture.db, fixture.a, TEST_CLOCK).grantRole(
      tx,
      personOfA.id,
      'admin',
    );
    assert.ok(!isRefusal(granted));
  });
  assert.ok(peopleRepo(fixture.db, fixture.a, TEST_CLOCK).rolesOf(personOfA.id).has('admin'));
  assert.equal(peopleRepo(fixture.db, fixture.b, TEST_CLOCK).rolesOf(personOfA.id).size, 0);
});

test('cross-org write: a cost centre cannot be owned by a person of another organisation', () => {
  const fixture = setUp();
  const personOfA = withTransaction(fixture.db, (tx) =>
    must(
      peopleRepo(fixture.db, fixture.a, TEST_CLOCK).insert(tx, {
        name: 'Otto',
        email: 'otto@example.test',
      }),
    ),
  );
  withTransaction(fixture.db, (tx) => {
    const result = costCentresRepo(fixture.db, fixture.b, TEST_CLOCK).insert(tx, {
      code: 'CC-X',
      name: 'Stolen',
      ownerPersonId: personOfA.id,
    });
    assert.ok(isRefusal(result));
    assert.equal(isRefusal(result) ? result.code : '', 'not_found');
  });
  // presence: the same insert inside A succeeds.
  withTransaction(fixture.db, (tx) => {
    const ok = costCentresRepo(fixture.db, fixture.a, TEST_CLOCK).insert(tx, {
      code: 'CC-X',
      name: 'Ops',
      ownerPersonId: personOfA.id,
    });
    assert.ok(!isRefusal(ok));
  });
});

test('cross-org write: a draft cannot point at a cost centre of another organisation', () => {
  const fixture = setUp();
  const costCentreOfA = seedCostCentre(fixture, fixture.a);
  const buyerOfB = seedOrgBuyer(fixture);
  withTransaction(fixture.db, (tx) => {
    const result = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).insertDraft(tx, {
      buyerPersonId: buyerOfB,
      costCentreId: costCentreOfA,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
    });
    assert.ok(isRefusal(result));
    assert.equal(isRefusal(result) ? result.code : '', 'not_found');
  });
  // presence: with B's own cost centre the same draft is created.
  const costCentreOfB = seedCostCentre(fixture, fixture.b);
  withTransaction(fixture.db, (tx) => {
    const ok = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).insertDraft(tx, {
      buyerPersonId: buyerOfB,
      costCentreId: costCentreOfB,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
    });
    assert.ok(!isRefusal(ok));
  });
});

function seedOrgBuyer(f: Fixture): string {
  return withTransaction(f.db, (tx) =>
    must(
      peopleRepo(f.db, f.b, TEST_CLOCK).insert(tx, {
        name: 'Ben Buyer',
        email: 'ben@example.test',
      }),
    ).id,
  );
}
