import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { isRefusal } from '../../src/refusal.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { orgScope } from '../../src/db/scope.ts';
import { auditRepo } from '../../src/db/repos/audit.ts';
import { requisitionsRepo } from '../../src/db/repos/requisitions.ts';
import { rulesRepo } from '../../src/db/repos/rules.ts';
import {
  approve,
  cancel,
  copyForward,
  createDraft,
  list,
  reject,
  submit,
  updateDraft,
  type RequisitionDetail,
  type ServiceContext,
} from '../../src/app/requisitions.ts';
import { makeDb } from '../support/db.ts';
import { must, TEST_CLOCK } from '../support/seed.ts';
import { scopeOf, seedLifecycleOrg, type LifecycleOrg } from '../support/http.ts';

/**
 * The lifecycle/authority suite (D-014 mandatory). It drives the **service seam** — the
 * layer split 04 extends — so nothing here depends on HTTP, and a red result is a 🔴 of the
 * review. `test/http/authority.test.ts` runs the same rules over `dispatch`.
 */

interface Fixture {
  readonly db: DatabaseSync;
  readonly seed: LifecycleOrg;
}

function setUp(): Fixture {
  const db = makeDb();
  return { db, seed: seedLifecycleOrg(db) };
}

function contextFor(fixture: Fixture, personId: string, requestId = 'req-test'): ServiceContext {
  return {
    db: fixture.db,
    scope: scopeOf(fixture.db, fixture.seed.org.id, personId),
    clock: TEST_CLOCK,
    requestId,
  };
}

/** A draft of `totalMinor` in one line, as the buyer. */
function draft(fixture: Fixture, totalMinor: number): RequisitionDetail {
  const ctx = contextFor(fixture, fixture.seed.buyer.id);
  return withTransaction(fixture.db, (tx) =>
    must(
      createDraft(ctx, tx, {
        costCentreId: fixture.seed.costCentre.id,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: totalMinor }],
      }),
    ),
  );
}

function submitted(fixture: Fixture, totalMinor: number): RequisitionDetail {
  const made = draft(fixture, totalMinor);
  const ctx = contextFor(fixture, fixture.seed.buyer.id);
  return withTransaction(fixture.db, (tx) => must(submit(ctx, tx, made.id, {})));
}

function auditOf(fixture: Fixture, requisitionId: string) {
  const scope = orgScope(fixture.seed.org.id, {
    personId: fixture.seed.buyer.id,
    kind: 'user',
    roles: new Set(),
  });
  return auditRepo(fixture.db, scope, TEST_CLOCK).listForRequisition(requisitionId);
}

test('a self-rule submission lands approved with two audit lines, the second by the system', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 5_000);

  assert.equal(detail.state, 'approved');
  assert.equal(detail.ruleCode, 'R1');
  assert.equal(detail.rule?.source, 'stored');
  assert.notEqual(detail.decidedAt, null);

  const lines = auditOf(fixture, detail.id);
  // the creation line plus the two the submission wrote
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((line) => line.action),
    ['draft.created', 'submit', 'approve'],
  );
  const automatic = lines[2];
  assert.equal(automatic?.actorKind, 'system');
  assert.equal(automatic?.actorPersonId, null);
  assert.equal(automatic?.fromState, 'submitted');
  assert.equal(automatic?.toState, 'approved');
  assert.equal(automatic?.ruleId, fixture.seed.rules[0]?.id);
  assert.equal(automatic?.totalMinor, 5_000);
  assert.equal(automatic?.currency, 'EUR');
  assert.equal(automatic?.requestId, 'req-test');

  // the manual line names the person, so the two are distinguishable in the history
  assert.equal(lines[1]?.actorKind, 'user');
  assert.equal(lines[1]?.actorPersonId, fixture.seed.buyer.id);
});

test('a self-approved requisition cannot then be approved manually by anybody', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 5_000);
  for (const personId of [
    fixture.seed.buyer.id,
    fixture.seed.owner.id,
    fixture.seed.finance.id,
  ]) {
    const refused = withTransaction(fixture.db, (tx) =>
      approve(contextFor(fixture, personId), tx, detail.id, { version: detail.version }),
    );
    assert.ok(isRefusal(refused), `${personId} must not approve an approved requisition`);
    assert.equal(isRefusal(refused) ? refused.code : '', 'wrong_state');
  }
});

test('a submitted self rule is not manually approvable even before the automatic step', () => {
  // A row that reached `submitted` under a stored `self` rule — reachable only if the
  // automatic approval were ever removed. `mayDecide` must still refuse everyone.
  const fixture = setUp();
  const made = draft(fixture, 5_000);
  const repo = requisitionsRepo(fixture.db, scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id), TEST_CLOCK);
  withTransaction(fixture.db, (tx) => {
    repo.transition(tx, {
      id: made.id,
      expectedVersion: made.version,
      toState: 'submitted',
      ruleId: fixture.seed.rules[0]?.id ?? null,
      ruleCode: 'R1',
      submittedAt: '2026-09-21T10:00:00.000Z',
      decidedAt: null,
    });
  });
  const current = must(repo.byId(made.id));
  for (const personId of [fixture.seed.buyer.id, fixture.seed.owner.id, fixture.seed.finance.id]) {
    const refused = withTransaction(fixture.db, (tx) =>
      approve(contextFor(fixture, personId), tx, made.id, { version: current.version }),
    );
    assert.ok(isRefusal(refused));
    assert.equal(isRefusal(refused) ? refused.code : '', 'not_authorised');
    assert.equal(isRefusal(refused) ? refused.rule : '', 'R1');
  }
});

test('the stored rule survives a later edit of the rule table — approval re-reads, never re-matches', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  assert.equal(detail.ruleCode, 'R2', 'presence: 250 000 matches the cost-centre rule');
  assert.equal(detail.rule?.id, fixture.seed.rules[1]?.id);

  // An admin tightens the table afterwards: a new row at seq 15 would now match first.
  withTransaction(fixture.db, (tx) => {
    must(
      rulesRepo(fixture.db, scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id)).insert(tx, {
        seq: 15,
        maxTotalMinor: 300_000,
        approverKind: 'finance',
        ruleCode: 'R1b',
      }),
    );
  });

  // presence: a *new* draft of the same amount does match the new row.
  const fresh = submitted(fixture, 250_000);
  assert.equal(fresh.ruleCode, 'R1b');

  // The in-flight requisition keeps R2: finance may not decide it, the cost-centre owner may.
  const byFinance = withTransaction(fixture.db, (tx) =>
    approve(contextFor(fixture, fixture.seed.finance.id), tx, detail.id, { version: detail.version }),
  );
  assert.ok(isRefusal(byFinance));
  assert.equal(isRefusal(byFinance) ? byFinance.code : '', 'not_authorised');
  assert.equal(isRefusal(byFinance) ? byFinance.rule : '', 'R2');

  const byOwner = withTransaction(fixture.db, (tx) =>
    must(approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, { version: detail.version })),
  );
  assert.equal(byOwner.state, 'approved');
  assert.equal(byOwner.ruleCode, 'R2');
});

test('a draft shows the rule that would match; after submission the rule that was stored', () => {
  const fixture = setUp();
  const made = draft(fixture, 250_000);
  assert.equal(made.rule?.source, 'would_match');
  assert.equal(made.rule?.ruleCode, 'R2');
  assert.equal(made.ruleId, null, 'nothing is stored on the row before submission');

  const after = withTransaction(fixture.db, (tx) =>
    must(submit(contextFor(fixture, fixture.seed.buyer.id), tx, made.id, {})),
  );
  assert.equal(after.rule?.source, 'stored');
  assert.equal(after.ruleId, fixture.seed.rules[1]?.id);
});

test('an organisation whose rule table does not cover the total refuses the submission', () => {
  const db = makeDb();
  const seed = seedLifecycleOrg(db, { name: 'Bounded GmbH' });
  const fixture: Fixture = { db, seed };
  // presence: the seeded table, which has a terminal unbounded row, does cover this total.
  assert.equal(submitted(fixture, 900_000).ruleCode, 'R3');

  // A second organisation with only bounded rows: the same total finds nothing.
  const bare = makeDb();
  const bareSeed = seedLifecycleOrg(bare, { name: 'Capped GmbH' });
  bare.exec("DELETE FROM approval_rules WHERE rule_code = 'R3'");
  const bareFixture: Fixture = { db: bare, seed: bareSeed };
  const made = draft(bareFixture, 900_000);
  const refused = withTransaction(bare, (tx) =>
    submit(contextFor(bareFixture, bareSeed.buyer.id), tx, made.id, {}),
  );
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'no_rule_matched');
  assert.equal(isRefusal(refused) ? refused.requisitionId : '', made.id);
  // nothing moved
  const repo = requisitionsRepo(bare, scopeOf(bare, bareSeed.org.id, bareSeed.buyer.id), TEST_CLOCK);
  assert.equal(must(repo.byId(made.id)).state, 'draft');
});

test('copy forward makes a new draft and leaves the rejected source byte-for-byte unchanged', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  const rejected = withTransaction(fixture.db, (tx) =>
    must(
      reject(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, {
        version: detail.version,
        reason: '  too expensive this quarter  ',
      }),
    ),
  );
  assert.equal(rejected.state, 'rejected');

  const repo = requisitionsRepo(
    fixture.db,
    scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id),
    TEST_CLOCK,
  );
  const before = JSON.stringify(must(repo.byId(detail.id)));
  const auditBefore = JSON.stringify(auditOf(fixture, detail.id));

  const copy = withTransaction(fixture.db, (tx) =>
    must(copyForward(contextFor(fixture, fixture.seed.buyer.id), tx, detail.id)),
  );

  assert.notEqual(copy.id, detail.id);
  assert.equal(copy.state, 'draft');
  assert.equal(copy.copiedFromId, detail.id);
  assert.equal(copy.version, 1);
  assert.deepEqual(
    copy.lines.map((line) => [line.description, line.quantity, line.unitPriceMinor]),
    rejected.lines.map((line) => [line.description, line.quantity, line.unitPriceMinor]),
  );
  assert.equal(JSON.stringify(must(repo.byId(detail.id))), before, 'the source row moved');
  assert.equal(JSON.stringify(auditOf(fixture, detail.id)), auditBefore, 'the source gained a line');

  // the copy carries its own line, on the new draft
  const copyLines = auditOf(fixture, copy.id);
  assert.deepEqual(
    copyLines.map((line) => line.action),
    ['draft.copied'],
  );
  assert.equal(copyLines[0]?.fromState, 'rejected');
  assert.equal(copyLines[0]?.toState, 'draft');

  // the source is still terminal
  const again = withTransaction(fixture.db, (tx) =>
    approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, { version: rejected.version }),
  );
  assert.equal(isRefusal(again) ? again.code : '', 'wrong_state');
});

test('a rejection stores the reason trimmed and returns it verbatim', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  withTransaction(fixture.db, (tx) =>
    must(
      reject(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, {
        version: detail.version,
        reason: '  no budget  ',
      }),
    ),
  );
  const lines = auditOf(fixture, detail.id);
  assert.equal(lines[lines.length - 1]?.reason, 'no budget');
});

test('reject without a reason is validation_failed, before the state check', () => {
  const fixture = setUp();
  const made = draft(fixture, 250_000);
  const refused = withTransaction(fixture.db, (tx) =>
    reject(contextFor(fixture, fixture.seed.owner.id), tx, made.id, { version: made.version }),
  );
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'validation_failed');
});

test('two approvals on the same stale version produce one approval and one conflict', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  const staleVersion = detail.version;

  const first = withTransaction(fixture.db, (tx) =>
    must(approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, { version: staleVersion })),
  );
  assert.equal(first.state, 'approved');

  const second = withTransaction(fixture.db, (tx) =>
    approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, { version: staleVersion }),
  );
  assert.ok(isRefusal(second));
  assert.equal(isRefusal(second) ? second.code : '', 'wrong_state');

  // and with a *fresh* version the state check still refuses: approved is terminal here
  const third = withTransaction(fixture.db, (tx) =>
    approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, { version: first.version }),
  );
  assert.equal(isRefusal(third) ? third.code : '', 'wrong_state');

  const approvals = auditOf(fixture, detail.id).filter((line) => line.action === 'approve');
  assert.equal(approvals.length, 1, 'exactly one approval line');
});

test('a stale version on a still-submitted requisition is a conflict, and writes nothing', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  const before = auditOf(fixture, detail.id).length;
  const refused = withTransaction(fixture.db, (tx) =>
    approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, {
      version: detail.version - 1,
    }),
  );
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'conflict');
  assert.equal(
    isRefusal(refused) ? refused.detail : '',
    `expected version ${String(detail.version - 1)}, found ${String(detail.version)}`,
  );
  assert.equal(auditOf(fixture, detail.id).length, before);
  assert.equal(must(requisitionsRepo(fixture.db, scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id), TEST_CLOCK).byId(detail.id)).state, 'submitted');
});

test('approve without a version is validation_failed', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  const refused = withTransaction(fixture.db, (tx) =>
    approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, {}),
  );
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'validation_failed');
});

test('a refused audit line throws, rolls the whole transaction back and leaves no transaction open', () => {
  const fixture = setUp();
  // 900 000 matches R3, whose approver is the `finance` *role* — so a scope carrying that
  // role passes every authority check and reaches the write, which is what this case needs.
  const detail = submitted(fixture, 900_000);
  assert.equal(detail.ruleCode, 'R3', 'presence: the finance rule matched');
  const before = auditOf(fixture, detail.id).length;

  // A scope whose actor is in no organisation: `writeAudit` refuses `not_found` for the
  // actor, which can only mean an invariant broke — so the service throws (D-007).
  const foreign: ServiceContext = {
    db: fixture.db,
    scope: orgScope(fixture.seed.org.id, {
      personId: '00000000-0000-4000-8000-000000000000',
      kind: 'user',
      roles: new Set(['finance'] as const),
    }),
    clock: TEST_CLOCK,
    requestId: 'req-foreign',
  };
  assert.throws(
    () => withTransaction(fixture.db, (tx) => approve(foreign, tx, detail.id, { version: detail.version })),
    /audit line refused: not_found/,
  );

  assert.equal(fixture.db.isTransaction, false, 'the transaction was left open');
  assert.equal(auditOf(fixture, detail.id).length, before, 'an audit line survived the rollback');
  const repo = requisitionsRepo(
    fixture.db,
    scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id),
    TEST_CLOCK,
  );
  assert.equal(must(repo.byId(detail.id)).state, 'submitted', 'the state change survived');
  assert.equal(must(repo.byId(detail.id)).version, detail.version);
});

test('an injected fault on the audit table leaves neither the state change nor a line', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  const before = auditOf(fixture, detail.id).length;

  fixture.db.exec(
    `CREATE TRIGGER no_audit BEFORE INSERT ON audit_log
     BEGIN SELECT RAISE(ABORT, 'injected fault'); END`,
  );
  assert.throws(() =>
    withTransaction(fixture.db, (tx) =>
      approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, { version: detail.version }),
    ),
  );
  assert.equal(fixture.db.isTransaction, false);
  const repo = requisitionsRepo(
    fixture.db,
    scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id),
    TEST_CLOCK,
  );
  assert.equal(must(repo.byId(detail.id)).state, 'submitted');
  assert.equal(auditOf(fixture, detail.id).length, before);

  // presence: drop the trigger and the very same request succeeds.
  fixture.db.exec('DROP TRIGGER no_audit');
  const approved = withTransaction(fixture.db, (tx) =>
    must(approve(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, { version: detail.version })),
  );
  assert.equal(approved.state, 'approved');
  assert.equal(auditOf(fixture, detail.id).length, before + 1);
});

test('creating, editing, submitting, cancelling and copying need the buyer role', () => {
  const fixture = setUp();
  const noRole: ServiceContext = {
    db: fixture.db,
    scope: orgScope(fixture.seed.org.id, {
      personId: fixture.seed.owner.id,
      kind: 'user',
      roles: new Set(),
    }),
    clock: TEST_CLOCK,
    requestId: 'req-norole',
  };
  const refused = withTransaction(fixture.db, (tx) =>
    createDraft(noRole, tx, {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1_000 }],
    }),
  );
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'not_authorised');

  // presence: the buyer, who holds the role, makes the same draft.
  assert.equal(draft(fixture, 1_000).state, 'draft');
});

test('the buyer may cancel a submitted requisition; the approver may not', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  const byOwner = withTransaction(fixture.db, (tx) =>
    cancel(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, {}),
  );
  assert.ok(isRefusal(byOwner));
  assert.equal(isRefusal(byOwner) ? byOwner.code : '', 'not_authorised');

  const byBuyer = withTransaction(fixture.db, (tx) =>
    must(cancel(contextFor(fixture, fixture.seed.buyer.id), tx, detail.id, { reason: 'no longer needed' })),
  );
  assert.equal(byBuyer.state, 'cancelled');
  const lines = auditOf(fixture, detail.id);
  assert.equal(lines[lines.length - 1]?.action, 'cancel');
  assert.equal(lines[lines.length - 1]?.reason, 'no longer needed');
});

test('every transition line carries actor, states, rule, total, currency and request id', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  withTransaction(fixture.db, (tx) =>
    must(
      approve(contextFor(fixture, fixture.seed.owner.id, 'req-approve'), tx, detail.id, {
        version: detail.version,
      }),
    ),
  );
  const lines = auditOf(fixture, detail.id);
  assert.deepEqual(
    lines.map((line) => line.action),
    ['draft.created', 'submit', 'approve'],
  );
  const approval = lines[2];
  assert.equal(approval?.actorPersonId, fixture.seed.owner.id);
  assert.equal(approval?.actorKind, 'user');
  assert.equal(approval?.fromState, 'submitted');
  assert.equal(approval?.toState, 'approved');
  assert.equal(approval?.ruleId, fixture.seed.rules[1]?.id);
  assert.equal(approval?.totalMinor, 250_000);
  assert.equal(approval?.currency, 'EUR');
  assert.equal(approval?.requestId, 'req-approve');
});

/**
 * The three ordering and shape corrections of the #3 review's nits: D-023's stated order
 * (validation → state → authority), a `decided_at` that only marks an actual decision, and
 * a `mine` filter that refuses rather than widening when the scope is not a person.
 */

test('the state check runs before the role guard, as D-023 states', () => {
  const fixture = setUp();
  const detail = submitted(fixture, 250_000);
  // The cost-centre owner holds `approver` and not `buyer`, so both guards would refuse.
  const refused = withTransaction(fixture.db, (tx) =>
    updateDraft(contextFor(fixture, fixture.seed.owner.id), tx, detail.id, {
      lines: [{ description: 'Chair', quantity: 1, unitPriceMinor: 1_000 }],
    }),
  );
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'wrong_state');
  assert.match(isRefusal(refused) ? (refused.detail ?? '') : '', /edit is not allowed from submitted/);

  // …and on a draft, where the state allows the act, the role guard still refuses.
  const draftRow = draft(fixture, 1_000);
  const denied = withTransaction(fixture.db, (tx) =>
    updateDraft(contextFor(fixture, fixture.seed.owner.id), tx, draftRow.id, {
      lines: [{ description: 'Chair', quantity: 1, unitPriceMinor: 1_000 }],
    }),
  );
  assert.ok(isRefusal(denied));
  assert.equal(isRefusal(denied) ? denied.code : '', 'not_authorised');
});

test('cancelling a draft decides nothing, so it carries no decidedAt', () => {
  const fixture = setUp();
  const draftRow = draft(fixture, 250_000);
  assert.equal(draftRow.decidedAt, null);
  const cancelled = withTransaction(fixture.db, (tx) =>
    must(cancel(contextFor(fixture, fixture.seed.buyer.id), tx, draftRow.id, {})),
  );
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.decidedAt, null, 'nobody decided a draft');

  // cancelling a submitted row ends a pending decision and does stamp it
  const pending = submitted(fixture, 250_000);
  const stopped = withTransaction(fixture.db, (tx) =>
    must(cancel(contextFor(fixture, fixture.seed.buyer.id), tx, pending.id, {})),
  );
  assert.notEqual(stopped.decidedAt, null);
});

test('mine is refused for a scope that is not a person, never widened to the organisation', () => {
  const fixture = setUp();
  draft(fixture, 250_000);
  const systemCtx: ServiceContext = {
    db: fixture.db,
    scope: orgScope(fixture.seed.org.id, { personId: null, kind: 'system', roles: new Set() }),
    clock: TEST_CLOCK,
    requestId: 'req-system',
  };
  const refused = list(systemCtx, { mine: true });
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'not_authorised');

  // the same scope without `mine` still reads the organisation (D-024)
  const all = must(list(systemCtx, {}));
  assert.equal(all.items.length, 1);
});
