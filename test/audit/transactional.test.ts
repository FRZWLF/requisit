import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTransaction } from '../../src/db/tx.ts';
import { auditRepo } from '../../src/db/repos/audit.ts';
import { requisitionsRepo } from '../../src/db/repos/requisitions.ts';
import { costCentresRepo } from '../../src/db/repos/cost-centres.ts';
import { makeDb } from '../support/db.ts';
import { must, seedOrg, TEST_CLOCK } from '../support/seed.ts';
import type { AuditInput } from '../../src/db/repos/audit.ts';

function fixture() {
  const db = makeDb();
  const { scope, buyer } = seedOrg(db);
  const costCentreId = withTransaction(db, (tx) =>
    must(
      costCentresRepo(db, scope, TEST_CLOCK).insert(tx, {
        code: 'CC-1',
        name: 'Ops',
        ownerPersonId: buyer.id,
      }),
    ).id,
  );
  return { db, scope, buyer, costCentreId };
}

function auditInput(requisitionId: string, personId: string): AuditInput {
  return {
    requisitionId,
    actorPersonId: personId,
    actorKind: 'user',
    action: 'draft.created',
    fromState: null,
    toState: 'draft',
    ruleId: null,
    totalMinor: 129_900,
    currency: 'EUR',
    reason: null,
    requestId: 'req-1',
  };
}

test('a committed state change leaves exactly one audit line', () => {
  const { db, scope, buyer, costCentreId } = fixture();
  const requisitionId = withTransaction(db, (tx) => {
    const requisition = must(
      requisitionsRepo(db, scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: buyer.id,
        costCentreId,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 129_900 }],
      }),
    );
    auditRepo(db, scope, TEST_CLOCK).writeAudit(tx, auditInput(requisition.id, buyer.id));
    return requisition.id;
  });

  const lines = auditRepo(db, scope, TEST_CLOCK).listForRequisition(requisitionId);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.action, 'draft.created');
  assert.equal(lines[0]?.at, '2026-09-21T10:00:00.000Z');
  assert.equal(lines[0]?.orgId, scope.orgId);
  assert.equal(lines[0]?.actorPersonId, buyer.id);
});

test('a rolled-back state change leaves no audit line and no requisition', () => {
  const { db, scope, buyer, costCentreId } = fixture();
  const before = auditRepo(db, scope, TEST_CLOCK).list().length;

  assert.throws(() =>
    withTransaction(db, (tx) => {
      const requisition = must(
        requisitionsRepo(db, scope, TEST_CLOCK).insertDraft(tx, {
          buyerPersonId: buyer.id,
          costCentreId,
          lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 129_900 }],
        }),
      );
      auditRepo(db, scope, TEST_CLOCK).writeAudit(tx, auditInput(requisition.id, buyer.id));
      throw new Error('boom, after the audit line was written');
    }),
  );

  assert.equal(auditRepo(db, scope, TEST_CLOCK).list().length, before);
  assert.equal(requisitionsRepo(db, scope, TEST_CLOCK).list().length, 0);
  assert.equal(db.isTransaction, false, 'the rollback must have closed the transaction');
});

test('the audit table is append-only in the engine, not only in the code', () => {
  const { db, scope, buyer, costCentreId } = fixture();
  withTransaction(db, (tx) => {
    const requisition = must(
      requisitionsRepo(db, scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: buyer.id,
        costCentreId,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 129_900 }],
      }),
    );
    auditRepo(db, scope, TEST_CLOCK).writeAudit(tx, auditInput(requisition.id, buyer.id));
  });

  assert.throws(
    () => db.prepare("UPDATE audit_log SET reason = 'tampered'").run(),
    /append-only/,
  );
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
  // presence: the row is still there and still readable after both attempts.
  assert.equal(auditRepo(db, scope, TEST_CLOCK).list().length, 1);
});

test('audit ids are assigned in insertion order', () => {
  const { db, scope, buyer, costCentreId } = fixture();
  const requisitionId = withTransaction(db, (tx) =>
    must(
      requisitionsRepo(db, scope, TEST_CLOCK).insertDraft(tx, {
        buyerPersonId: buyer.id,
        costCentreId,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1000 }],
      }),
    ).id,
  );
  withTransaction(db, (tx) => {
    const repo = auditRepo(db, scope, TEST_CLOCK);
    for (const action of ['draft.created', 'draft.updated', 'draft.updated.again']) {
      repo.writeAudit(tx, { ...auditInput(requisitionId, buyer.id), action });
    }
  });
  const lines = auditRepo(db, scope, TEST_CLOCK).listForRequisition(requisitionId);
  assert.deepEqual(
    lines.map((line) => line.action),
    ['draft.created', 'draft.updated', 'draft.updated.again'],
  );
  assert.ok((lines[0]?.id ?? 0) < (lines[1]?.id ?? 0));
});

test('a transaction cannot be nested — that is a bug, not a savepoint', () => {
  const db = makeDb();
  assert.throws(
    () => withTransaction(db, () => withTransaction(db, () => 1)),
    /nesting is a bug/,
  );
  assert.equal(db.isTransaction, false);
});
