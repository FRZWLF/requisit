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
import { idempotencyKeysRepo } from '../../src/db/repos/idempotency.ts';
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
        must(
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
          }),
        );
      });
      return requisitionId;
    },
    readAsB: (f, id) => auditRepo(f.db, f.b, TEST_CLOCK).listForRequisition(id),
    readAsA: (f, id) => auditRepo(f.db, f.a, TEST_CLOCK).listForRequisition(id),
  },
  {
    name: 'audit.list',
    writeAsA: (f) => {
      const requisitionId = seedRequisition(f, f.a);
      withTransaction(f.db, (tx) => {
        must(
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
          }),
        );
      });
      return requisitionId;
    },
    readAsB: (f) => auditRepo(f.db, f.b, TEST_CLOCK).list(),
    readAsA: (f) => auditRepo(f.db, f.a, TEST_CLOCK).list(),
  },
  {
    name: 'catalogue.list',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) =>
        must(
          catalogueRepo(f.db, f.a, TEST_CLOCK).insert(tx, {
            sku: 'SKU-2',
            name: 'Monitor',
            unitPriceMinor: 29_900,
            currency: 'EUR',
          }),
        ).id,
      ),
    readAsB: (f) => catalogueRepo(f.db, f.b, TEST_CLOCK).list(),
    readAsA: (f) => catalogueRepo(f.db, f.a, TEST_CLOCK).list(),
  },
  {
    // Every organisation has people of its own, so the assertion is the sharper one:
    // A's person is not *in* B's list.
    name: 'people.list',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) =>
        must(
          peopleRepo(f.db, f.a, TEST_CLOCK).insert(tx, {
            name: 'Pia',
            email: 'pia@example.test',
          }),
        ).id,
      ),
    readAsB: (f, id) => peopleRepo(f.db, f.b, TEST_CLOCK).list().filter((p) => p.id === id),
    readAsA: (f, id) => peopleRepo(f.db, f.a, TEST_CLOCK).list().filter((p) => p.id === id),
  },
  {
    name: 'requisitions.listWithLines',
    writeAsA: (f) => seedRequisition(f, f.a),
    readAsB: (f, id) =>
      requisitionsRepo(f.db, f.b, TEST_CLOCK)
        .listWithLines()
        .filter((requisition) => requisition.id === id),
    readAsA: (f, id) =>
      requisitionsRepo(f.db, f.a, TEST_CLOCK)
        .listWithLines()
        .filter((requisition) => requisition.id === id),
  },
  {
    name: 'rules.byId',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) =>
        must(
          rulesRepo(f.db, f.a).insert(tx, {
            seq: 40,
            maxTotalMinor: null,
            approverKind: 'finance',
            ruleCode: 'terminal',
          }),
        ).id,
      ),
    readAsB: (f, id) => rulesRepo(f.db, f.b).byId(id),
    readAsA: (f, id) => rulesRepo(f.db, f.a).byId(id),
  },
  {
    // The key ledger is keyed by `(org_id, endpoint, key)`: one tenant must be unable to
    // collide with — or probe for — another's keys (D-010, D-004). The `id` carried through
    // the case is the key itself.
    name: 'idempotencyKeys.find',
    writeAsA: (f) =>
      withTransaction(f.db, (tx) => {
        idempotencyKeysRepo(f.db, f.a, TEST_CLOCK).insert(tx, {
          endpoint: 'POST /api/v1/requisitions',
          key: 'shared-key',
          fingerprint: 'fingerprint',
          status: 201,
          body: '{"secret":"of A"}',
        });
        return 'shared-key';
      }),
    readAsB: (f, key) =>
      [idempotencyKeysRepo(f.db, f.b, TEST_CLOCK).find('POST /api/v1/requisitions', key)].filter(
        (row) => row !== undefined,
      ),
    readAsA: (f, key) =>
      [idempotencyKeysRepo(f.db, f.a, TEST_CLOCK).find('POST /api/v1/requisitions', key)].filter(
        (row) => row !== undefined,
      ),
  },
  {
    name: 'requisitions.list by buyer',
    writeAsA: (f) => {
      const requisitionId = seedRequisition(f, f.a);
      return must(requisitionsRepo(f.db, f.a, TEST_CLOCK).byId(requisitionId)).buyerPersonId;
    },
    readAsB: (f, buyerPersonId) =>
      requisitionsRepo(f.db, f.b, TEST_CLOCK).list({ buyerPersonId }),
    readAsA: (f, buyerPersonId) =>
      requisitionsRepo(f.db, f.a, TEST_CLOCK).list({ buyerPersonId }),
  },
];

test('the leak table covers every repository that exists', () => {
  // 13 rows from issue #2 plus the three read paths split 02 added. Rows are appended,
  // never removed or weakened.
  assert.ok(CASES.length >= 16, `presence: ${CASES.length} read cases`);
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


test('cross-org write: a draft cannot name a buyer of another organisation', () => {
  const fixture = setUp();
  const personOfA = withTransaction(fixture.db, (tx) =>
    must(
      peopleRepo(fixture.db, fixture.a, TEST_CLOCK).insert(tx, {
        name: 'Bea',
        email: 'bea-a@example.test',
      }),
    ).id,
  );
  const costCentreOfB = seedCostCentre(fixture, fixture.b);
  withTransaction(fixture.db, (tx) => {
    const result = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).insertDraft(tx, {
      buyerPersonId: personOfA,
      costCentreId: costCentreOfB,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
    });
    assert.ok(isRefusal(result));
    assert.equal(isRefusal(result) ? result.code : '', 'not_found');
  });
  // presence: with B's own buyer the same draft is created.
  const buyerOfB = seedOrgBuyer(fixture);
  withTransaction(fixture.db, (tx) => {
    const ok = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).insertDraft(tx, {
      buyerPersonId: buyerOfB,
      costCentreId: costCentreOfB,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
    });
    assert.ok(!isRefusal(ok));
  });
});

test('cross-org write: a line cannot point at a catalogue item of another organisation', () => {
  const fixture = setUp();
  const itemOfA = withTransaction(fixture.db, (tx) =>
    must(
      catalogueRepo(fixture.db, fixture.a, TEST_CLOCK).insert(tx, {
        sku: 'SKU-A',
        name: 'Laptop',
        unitPriceMinor: 129_900,
        currency: 'EUR',
      }),
    ).id,
  );
  const costCentreOfB = seedCostCentre(fixture, fixture.b);
  const buyerOfB = seedOrgBuyer(fixture);
  withTransaction(fixture.db, (tx) => {
    const result = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).insertDraft(tx, {
      buyerPersonId: buyerOfB,
      costCentreId: costCentreOfB,
      lines: [
        {
          description: 'Laptop',
          quantity: 1,
          unitPriceMinor: 129_900,
          catalogueItemId: itemOfA,
        },
      ],
    });
    assert.ok(isRefusal(result));
    assert.equal(isRefusal(result) ? result.code : '', 'not_found');
  });
  // presence: B's own catalogue item is accepted on the same line.
  const itemOfB = withTransaction(fixture.db, (tx) =>
    must(
      catalogueRepo(fixture.db, fixture.b, TEST_CLOCK).insert(tx, {
        sku: 'SKU-B',
        name: 'Laptop',
        unitPriceMinor: 129_900,
        currency: 'EUR',
      }),
    ).id,
  );
  withTransaction(fixture.db, (tx) => {
    const ok = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).insertDraft(tx, {
      buyerPersonId: buyerOfB,
      costCentreId: costCentreOfB,
      lines: [
        {
          description: 'Laptop',
          quantity: 1,
          unitPriceMinor: 129_900,
          catalogueItemId: itemOfB,
        },
      ],
    });
    assert.ok(!isRefusal(ok));
  });
});

/**
 * `audit_log`'s foreign keys are by id alone, and the append-only triggers make a wrong
 * line permanent — so the write itself has to refuse a reference from another organisation
 * (D-004, D-007).
 */
test('cross-org write: an audit line cannot reference another organisation', () => {
  const fixture = setUp();
  const requisitionOfA = seedRequisition(fixture, fixture.a);
  const actorOfA = fixture.a.actor.personId;
  assert.ok(actorOfA !== null, 'presence: organisation A has an actor');
  const repoB = auditRepo(fixture.db, fixture.b, TEST_CLOCK);
  const base = {
    actorKind: 'user',
    action: 'draft.created',
    fromState: null,
    toState: 'draft',
    ruleId: null,
    totalMinor: 129_900,
    currency: 'EUR',
    reason: null,
    requestId: null,
  } as const;

  withTransaction(fixture.db, (tx) => {
    const stolenRequisition = repoB.writeAudit(tx, {
      ...base,
      requisitionId: requisitionOfA,
      actorPersonId: fixture.b.actor.personId,
    });
    assert.ok(isRefusal(stolenRequisition), "B wrote an audit line about A's requisition");
    assert.equal(isRefusal(stolenRequisition) ? stolenRequisition.code : '', 'not_found');

    const stolenActor = repoB.writeAudit(tx, {
      ...base,
      requisitionId: null,
      actorPersonId: actorOfA,
    });
    assert.ok(isRefusal(stolenActor), "B wrote an audit line crediting A's person");
    assert.equal(isRefusal(stolenActor) ? stolenActor.code : '', 'not_found');
  });

  // presence: nothing was written, and B's own references are accepted.
  assert.equal(auditRepo(fixture.db, fixture.b, TEST_CLOCK).list().length, 0);
  const requisitionOfB = seedRequisition(fixture, fixture.b);
  withTransaction(fixture.db, (tx) => {
    const ok = auditRepo(fixture.db, fixture.b, TEST_CLOCK).writeAudit(tx, {
      ...base,
      requisitionId: requisitionOfB,
      actorPersonId: fixture.b.actor.personId,
    });
    assert.ok(!isRefusal(ok));
  });
  assert.equal(auditRepo(fixture.db, fixture.b, TEST_CLOCK).list().length, 1);
});


/* The write paths split 02 added (D-008…D-010). */

test('cross-org write: replaceDraft cannot reach a draft of another organisation', () => {
  const fixture = setUp();
  const requisitionOfA = seedRequisition(fixture, fixture.a);
  const before = JSON.stringify(must(requisitionsRepo(fixture.db, fixture.a, TEST_CLOCK).byId(requisitionOfA)));
  withTransaction(fixture.db, (tx) => {
    const refused = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).replaceDraft(tx, requisitionOfA, {
      lines: [{ description: 'Stolen', quantity: 1, unitPriceMinor: 1 }],
    });
    assert.ok(isRefusal(refused));
    assert.equal(isRefusal(refused) ? refused.code : '', 'not_found');
  });
  assert.equal(
    JSON.stringify(must(requisitionsRepo(fixture.db, fixture.a, TEST_CLOCK).byId(requisitionOfA))),
    before,
  );
  // presence: A's own repository does change it.
  withTransaction(fixture.db, (tx) => {
    const ok = requisitionsRepo(fixture.db, fixture.a, TEST_CLOCK).replaceDraft(tx, requisitionOfA, {
      lines: [{ description: 'Mine', quantity: 1, unitPriceMinor: 1 }],
    });
    assert.ok(!isRefusal(ok));
  });
});

test('cross-org write: copyForward cannot copy a requisition of another organisation', () => {
  const fixture = setUp();
  const requisitionOfA = seedRequisition(fixture, fixture.a);
  withTransaction(fixture.db, (tx) => {
    const refused = requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).copyForward(tx, requisitionOfA);
    assert.ok(isRefusal(refused));
    assert.equal(isRefusal(refused) ? refused.code : '', 'not_found');
  });
  assert.equal(requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).list().length, 0);
  // presence: A copies its own.
  withTransaction(fixture.db, (tx) => {
    const ok = requisitionsRepo(fixture.db, fixture.a, TEST_CLOCK).copyForward(tx, requisitionOfA);
    assert.ok(!isRefusal(ok));
  });
});

test('cross-org write: transition cannot move a requisition of another organisation', () => {
  const fixture = setUp();
  const requisitionOfA = seedRequisition(fixture, fixture.a);
  const input = {
    id: requisitionOfA,
    expectedVersion: 1,
    toState: 'approved' as const,
    ruleId: null,
    ruleCode: null,
    submittedAt: null,
    decidedAt: null,
  };
  assert.throws(
    () =>
      withTransaction(fixture.db, (tx) =>
        requisitionsRepo(fixture.db, fixture.b, TEST_CLOCK).transition(tx, input),
      ),
    /expected exactly one row/,
  );
  assert.equal(must(requisitionsRepo(fixture.db, fixture.a, TEST_CLOCK).byId(requisitionOfA)).state, 'draft');
  // presence: A's own repository moves the same row with the same input.
  const moved = withTransaction(fixture.db, (tx) =>
    requisitionsRepo(fixture.db, fixture.a, TEST_CLOCK).transition(tx, input),
  );
  assert.equal(moved.state, 'approved');
});

test('cross-org write: an idempotency key of one organisation never satisfies another', () => {
  const fixture = setUp();
  const row = {
    endpoint: 'POST /api/v1/requisitions',
    key: 'same-key',
    fingerprint: 'same-fingerprint',
    status: 201,
    body: '{}',
  };
  withTransaction(fixture.db, (tx) => {
    idempotencyKeysRepo(fixture.db, fixture.a, TEST_CLOCK).insert(tx, row);
  });
  assert.equal(
    idempotencyKeysRepo(fixture.db, fixture.b, TEST_CLOCK).find(row.endpoint, row.key),
    undefined,
  );
  // presence: B may take the very same key for itself, and A still sees its own row.
  withTransaction(fixture.db, (tx) => {
    idempotencyKeysRepo(fixture.db, fixture.b, TEST_CLOCK).insert(tx, { ...row, body: '{"b":1}' });
  });
  assert.equal(idempotencyKeysRepo(fixture.db, fixture.a, TEST_CLOCK).find(row.endpoint, row.key)?.body, '{}');
  assert.equal(
    idempotencyKeysRepo(fixture.db, fixture.b, TEST_CLOCK).find(row.endpoint, row.key)?.body,
    '{"b":1}',
  );
});
