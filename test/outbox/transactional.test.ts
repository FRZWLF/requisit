import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefusal } from '../../src/refusal.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { auditRepo } from '../../src/db/repos/audit.ts';
import { outboxRepo } from '../../src/db/repos/outbox.ts';
import { requisitionsRepo } from '../../src/db/repos/requisitions.ts';
import { acknowledge } from '../../src/app/outbox.ts';
import { approve, createDraft, submit, type ServiceContext } from '../../src/app/requisitions.ts';
import type { OrderPayload } from '../../src/domain/order.ts';
import { ORDER_PAYLOAD_VERSION } from '../../src/domain/order.ts';
import { makeApp, scopeOf, seedLifecycleOrg, type LifecycleOrg } from '../support/http.ts';
import { must, TEST_CLOCK } from '../support/seed.ts';

/**
 * `outbox/transactional` (D-011, D-007). The order row is written inside the approving
 * transaction, which is the only arrangement that cannot lose an order or emit one for a
 * change that rolled back. The fault-injection test proves all three halves together: no
 * state change, no audit line, **and** no outbox row.
 */

interface Fixture {
  readonly db: ReturnType<typeof makeApp>['db'];
  readonly seed: LifecycleOrg;
}

function setUp(currency = 'EUR'): Fixture {
  const { db } = makeApp();
  return { db, seed: seedLifecycleOrg(db, { currency }) };
}

function contextFor(fixture: Fixture, personId: string, requestId = 'req-1'): ServiceContext {
  return {
    db: fixture.db,
    scope: scopeOf(fixture.db, fixture.seed.org.id, personId),
    clock: TEST_CLOCK,
    requestId,
  };
}

/** A draft of `total`, submitted, ready for the cost-centre owner to decide. */
function submittedRequisition(fixture: Fixture, total: number): string {
  const ctx = contextFor(fixture, fixture.seed.buyer.id);
  return withTransaction(fixture.db, (tx) => {
    const draft = must(
      createDraft(ctx, tx, {
        costCentreId: fixture.seed.costCentre.id,
        lines: [
          { description: 'Laptop', quantity: 2, unitPriceMinor: total / 2 },
        ],
      }),
    );
    must(submit(ctx, tx, draft.id, {}));
    return draft.id;
  });
}

function outboxOf(fixture: Fixture) {
  return outboxRepo(fixture.db, scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.merchant.id), TEST_CLOCK);
}

function payloadOf(json: string): OrderPayload {
  return JSON.parse(json) as OrderPayload;
}

test('approving writes exactly one outbox row, in the approving transaction', () => {
  const fixture = setUp();
  const id = submittedRequisition(fixture, 250_000);
  assert.equal(outboxOf(fixture).listAfter(0, 100).length, 0, 'presence: no row before the approval');

  const owner = contextFor(fixture, fixture.seed.owner.id);
  withTransaction(fixture.db, (tx) => {
    must(approve(owner, tx, id, { version: 2 }));
  });

  const feed = outboxOf(fixture).listAfter(0, 100);
  assert.equal(feed.length, 1);
  const row = feed[0];
  assert.ok(row !== undefined);
  assert.equal(row.requisitionId, id);
  assert.equal(row.deliveredAt, null);
  assert.equal(row.ackBy, null);

  const payload = payloadOf(row.payloadJson);
  assert.equal(payload.version, ORDER_PAYLOAD_VERSION);
  assert.equal(payload.currency, 'EUR');
  assert.equal(payload.totalMinor, 250_000);
  assert.equal(payload.requisitionId, id);
  assert.equal(payload.ruleCode, 'R2');
  assert.ok(payload.approvedAt !== null, 'the payload carries the moment of approval');
  // The total is the sum of the line totals recomputed at build time (D-003).
  assert.equal(
    payload.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    payload.totalMinor,
  );
});

test('a self-rule auto-approval writes exactly one outbox row too', () => {
  const fixture = setUp();
  const ctx = contextFor(fixture, fixture.seed.buyer.id);
  const id = withTransaction(fixture.db, (tx) => {
    const draft = must(
      createDraft(ctx, tx, {
        costCentreId: fixture.seed.costCentre.id,
        lines: [{ description: 'Pens', quantity: 1, unitPriceMinor: 5_000 }],
      }),
    );
    must(submit(ctx, tx, draft.id, {}));
    return draft.id;
  });

  const detail = must(requisitionsRepo(fixture.db, ctx.scope, TEST_CLOCK).byId(id));
  assert.equal(detail.state, 'approved', 'presence: the self rule approved at submission');
  const feed = outboxOf(fixture).listAfter(0, 100);
  assert.equal(feed.length, 1);
  assert.equal(feed[0]?.requisitionId, id);
  assert.equal(payloadOf(feed[0]?.payloadJson ?? '{}').totalMinor, 5_000);
});

/**
 * The fault injection the acceptance criteria name: the approval runs to completion inside
 * the transaction and *then* the transaction fails. All three writes must be gone together —
 * a version of this that only checked the state column would pass with a leaked order.
 */
test('a fault after the state change and before the commit leaves no row, no line and no move', () => {
  const fixture = setUp();
  const id = submittedRequisition(fixture, 250_000);
  const owner = contextFor(fixture, fixture.seed.owner.id);
  const before = must(requisitionsRepo(fixture.db, owner.scope, TEST_CLOCK).byId(id));
  const auditBefore = auditRepo(fixture.db, owner.scope, TEST_CLOCK).listForRequisition(id).length;
  assert.ok(auditBefore >= 2, 'presence: the draft and the submit already left lines');

  assert.throws(
    () =>
      withTransaction(fixture.db, (tx) => {
        const approved = approve(owner, tx, id, { version: before.version });
        assert.ok(!isRefusal(approved), 'presence: the approval itself succeeded');
        throw new Error('injected fault, after the state change and before the commit');
      }),
    /injected fault/,
  );

  const after = must(requisitionsRepo(fixture.db, owner.scope, TEST_CLOCK).byId(id));
  assert.equal(after.state, 'submitted', 'the state change survived the rollback');
  assert.equal(after.version, before.version, 'the version moved across the rollback');
  assert.equal(
    auditRepo(fixture.db, owner.scope, TEST_CLOCK).listForRequisition(id).length,
    auditBefore,
    'an audit line survived the rollback',
  );
  assert.equal(outboxOf(fixture).listAfter(0, 100).length, 0, 'an order survived the rollback');

  // presence: the very same approval, committed, does produce all three.
  withTransaction(fixture.db, (tx) => {
    must(approve(owner, tx, id, { version: before.version }));
  });
  assert.equal(must(requisitionsRepo(fixture.db, owner.scope, TEST_CLOCK).byId(id)).state, 'approved');
  assert.equal(
    auditRepo(fixture.db, owner.scope, TEST_CLOCK).listForRequisition(id).length,
    auditBefore + 1,
  );
  assert.equal(outboxOf(fixture).listAfter(0, 100).length, 1);
});

/**
 * The multi-line case, derived by hand: 3 × 129 900 + 2 × 29 900 + 1 × 8 900 = 458 400.
 * A single-line requisition cannot tell "the sum of the lines" from "the first line", which
 * is exactly the mutation this test exists to see.
 */
test('the payload total is the sum of every line, recomputed at build time', () => {
  const fixture = setUp();
  const ctx = contextFor(fixture, fixture.seed.buyer.id);
  const id = withTransaction(fixture.db, (tx) => {
    const draft = must(
      createDraft(ctx, tx, {
        costCentreId: fixture.seed.costCentre.id,
        lines: [
          { description: 'Laptop', quantity: 3, unitPriceMinor: 129_900 },
          { description: 'Monitor', quantity: 2, unitPriceMinor: 29_900 },
          { description: 'Keyboard', quantity: 1, unitPriceMinor: 8_900 },
        ],
      }),
    );
    must(submit(ctx, tx, draft.id, {}));
    return draft.id;
  });
  const owner = contextFor(fixture, fixture.seed.owner.id);
  withTransaction(fixture.db, (tx) => {
    must(approve(owner, tx, id, { version: 2 }));
  });

  const payload = payloadOf(outboxOf(fixture).listAfter(0, 100)[0]?.payloadJson ?? '{}');
  assert.equal(payload.lines.length, 3, 'the payload dropped a line');
  assert.deepEqual(
    payload.lines.map((line) => line.lineTotalMinor),
    [389_700, 59_800, 8_900],
  );
  assert.equal(payload.totalMinor, 458_400);
  assert.equal(
    payload.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    payload.totalMinor,
  );
});

/**
 * The acknowledgement's own guard, which no public path can reach: every outbox row is
 * written by an approval, and nothing moves a requisition out of `approved` but the
 * acknowledgement itself. So the case is produced at the repository seam — an order row for a
 * *draft* — and the invariant is that it throws and rolls back, never that a draft quietly
 * becomes `ordered` (D-009). Without this the whole `decide` call could be deleted and every
 * other test would still pass.
 */
test('an order row for a requisition that was never approved rolls the acknowledgement back', () => {
  const fixture = setUp();
  const ctx = contextFor(fixture, fixture.seed.buyer.id);
  const draftId = withTransaction(fixture.db, (tx) =>
    must(
      createDraft(ctx, tx, {
        costCentreId: fixture.seed.costCentre.id,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 250_000 }],
      }),
    ).id,
  );
  const merchant = contextFor(fixture, fixture.seed.merchant.id);
  const rowId = withTransaction(fixture.db, (tx) =>
    must(
      outboxRepo(fixture.db, ctx.scope, TEST_CLOCK).append(tx, {
        requisitionId: draftId,
        payloadJson: '{"version":1}',
      }),
    ).id,
  );

  assert.throws(
    () => withTransaction(fixture.db, (tx) => acknowledge(merchant, tx, { throughId: rowId })),
    /cannot be ordered|wrong_state/,
  );
  assert.equal(must(requisitionsRepo(fixture.db, ctx.scope, TEST_CLOCK).byId(draftId)).state, 'draft');
  assert.equal(must(outboxOf(fixture).byId(rowId)).deliveredAt, null);

  // presence: with the requisition approved, the very same row acknowledges cleanly.
  withTransaction(fixture.db, (tx) => {
    must(submit(ctx, tx, draftId, {}));
  });
  const owner = contextFor(fixture, fixture.seed.owner.id);
  withTransaction(fixture.db, (tx) => {
    must(approve(owner, tx, draftId, { version: 2 }));
  });
  const acked = withTransaction(fixture.db, (tx) =>
    must(acknowledge(merchant, tx, { throughId: rowId })),
  );
  assert.deepEqual(acked.ordered, [draftId]);
  assert.equal(must(requisitionsRepo(fixture.db, ctx.scope, TEST_CLOCK).byId(draftId)).state, 'ordered');
});

test('a JPY requisition carries exponent-0 minor units through the payload unchanged', () => {
  const fixture = setUp('JPY');
  const id = submittedRequisition(fixture, 250_000);
  const owner = contextFor(fixture, fixture.seed.owner.id);
  withTransaction(fixture.db, (tx) => {
    must(approve(owner, tx, id, { version: 2 }));
  });
  const payload = payloadOf(outboxOf(fixture).listAfter(0, 100)[0]?.payloadJson ?? '{}');
  assert.equal(payload.currency, 'JPY');
  // 250 000 yen, not 2 500.00 of anything: minor units are the unit, whatever the exponent.
  assert.equal(payload.totalMinor, 250_000);
  assert.equal(payload.lines[0]?.unitPriceMinor, 125_000);
});
