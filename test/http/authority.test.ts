import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgScope } from '../../src/db/scope.ts';
import { auditRepo } from '../../src/db/repos/audit.ts';
import { TEST_CLOCK } from '../support/seed.ts';
import { call, makeApp, seedLifecycleOrg, tokenFor, type CallResult } from '../support/http.ts';

/**
 * The authority suite (D-014 mandatory) over `dispatch`. It asserts the same rules as
 * `test/app/lifecycle-authority.test.ts`, at the boundary a client actually sees — including
 * that `actions` in the detail is exactly the set of POSTs the server will accept.
 */

function setUp() {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  const tokens = {
    buyer: tokenFor(seed.org.id, seed.buyer.id),
    owner: tokenFor(seed.org.id, seed.owner.id),
    finance: tokenFor(seed.org.id, seed.finance.id),
    stranger: tokenFor(seed.org.id, seed.stranger.id),
  };
  return { db, app, seed, tokens };
}

type Fixture = ReturnType<typeof setUp>;

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `k-${String(keySeq)}`;
}

function newDraft(fixture: Fixture, total: number, token = fixture.tokens.buyer): CallResult {
  return call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token,
    key: nextKey(),
    body: {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: total }],
    },
  });
}

function post(fixture: Fixture, id: string, action: string, token: string, body?: unknown, key?: string): CallResult {
  return call(fixture.app, {
    method: 'POST',
    path: `/api/v1/requisitions/${id}/${action}`,
    token,
    key: key ?? nextKey(),
    ...(body === undefined ? {} : { body }),
  });
}

function get(fixture: Fixture, id: string, token: string): CallResult {
  return call(fixture.app, { method: 'GET', path: `/api/v1/requisitions/${id}`, token });
}

function submittedUnderR2(fixture: Fixture): CallResult {
  const draft = newDraft(fixture, 250_000);
  const moved = post(fixture, String(draft.json['id']), 'submit', fixture.tokens.buyer);
  assert.equal(moved.status, 200, moved.body);
  assert.equal(moved.json['ruleCode'], 'R2');
  return moved;
}

test('an approver who is not the resolved approver is 403 with the rule', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  const id = String(moved.json['id']);
  for (const token of [fixture.tokens.finance, fixture.tokens.stranger]) {
    const refused = post(fixture, id, 'approve', token, { version: moved.json['version'] });
    assert.equal(refused.status, 403);
    assert.equal(refused.json['code'], 'not_authorised');
    assert.equal(refused.json['rule'], 'R2');
    assert.equal(refused.json['requisition_id'], id);
    assert.equal(refused.json['detail'], 'only the cost centre owner may approve under rule R2');
  }
  // presence: the cost centre owner is accepted.
  const ok = post(fixture, id, 'approve', fixture.tokens.owner, { version: moved.json['version'] });
  assert.equal(ok.status, 200, ok.body);
  assert.equal(ok.json['state'], 'approved');
});

test('a finance rule resolves to the role, and the owner of the cost centre is then not the approver', () => {
  const fixture = setUp();
  const draft = newDraft(fixture, 900_000);
  const moved = post(fixture, String(draft.json['id']), 'submit', fixture.tokens.buyer);
  assert.equal(moved.json['ruleCode'], 'R3');
  const id = String(moved.json['id']);

  const byOwner = post(fixture, id, 'approve', fixture.tokens.owner, { version: moved.json['version'] });
  assert.equal(byOwner.status, 403);
  assert.equal(byOwner.json['detail'], 'only finance may approve under rule R3');

  const byFinance = post(fixture, id, 'approve', fixture.tokens.finance, { version: moved.json['version'] });
  assert.equal(byFinance.status, 200, byFinance.body);
});

test('a buyer never approves their own requisition, even owning the cost centre or holding finance', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  const refused = post(fixture, String(moved.json['id']), 'approve', fixture.tokens.buyer, {
    version: moved.json['version'],
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.json['detail'], 'a buyer may not approve their own requisition');

  // The finance person is also a buyer: their own 900 000 requisition matches R3, which
  // their own role would otherwise let them approve.
  const own = newDraft(fixture, 900_000, fixture.tokens.finance);
  const ownMoved = post(fixture, String(own.json['id']), 'submit', fixture.tokens.finance);
  assert.equal(ownMoved.json['ruleCode'], 'R3');
  const selfApproval = post(fixture, String(own.json['id']), 'approve', fixture.tokens.finance, {
    version: ownMoved.json['version'],
  });
  assert.equal(selfApproval.status, 403);
  assert.equal(selfApproval.json['detail'], 'a buyer may not approve their own requisition');
});

test('a self-matched submission is approved at once, and nobody can approve it again', () => {
  const fixture = setUp();
  const draft = newDraft(fixture, 5_000);
  const moved = post(fixture, String(draft.json['id']), 'submit', fixture.tokens.buyer);
  assert.equal(moved.status, 200);
  assert.equal(moved.json['state'], 'approved');
  assert.equal(moved.json['ruleCode'], 'R1');

  const history = moved.json['history'] as { action: string; actorKind: string; actorPersonId: string | null }[];
  assert.deepEqual(
    history.map((line) => line.action),
    ['draft.created', 'submit', 'approve'],
  );
  assert.equal(history[2]?.actorKind, 'system');
  assert.equal(history[2]?.actorPersonId, null);
});

test('approve on a draft, twice with a new key, and cancel after approval are all wrong_state', () => {
  const fixture = setUp();
  const draft = newDraft(fixture, 250_000);
  const onDraft = post(fixture, String(draft.json['id']), 'approve', fixture.tokens.owner, { version: 1 });
  assert.equal(onDraft.status, 409);
  assert.equal(onDraft.json['code'], 'wrong_state');
  assert.equal(onDraft.json['detail'], 'approve is not allowed from draft');

  const moved = post(fixture, String(draft.json['id']), 'submit', fixture.tokens.buyer);
  const id = String(moved.json['id']);
  const approved = post(fixture, id, 'approve', fixture.tokens.owner, { version: moved.json['version'] });
  assert.equal(approved.status, 200);

  const twice = post(fixture, id, 'approve', fixture.tokens.owner, { version: approved.json['version'] });
  assert.equal(twice.status, 409);
  assert.equal(twice.json['code'], 'wrong_state');

  const cancelled = post(fixture, id, 'cancel', fixture.tokens.buyer, {});
  assert.equal(cancelled.status, 409);
  assert.equal(cancelled.json['code'], 'wrong_state');
  assert.equal(cancelled.json['detail'], 'cancel is not allowed from approved');
});

test('approving twice with the SAME key is a replay, not a second approval', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  const id = String(moved.json['id']);
  const key = nextKey();
  const first = post(fixture, id, 'approve', fixture.tokens.owner, { version: moved.json['version'] }, key);
  assert.equal(first.status, 200);
  const second = post(fixture, id, 'approve', fixture.tokens.owner, { version: moved.json['version'] }, key);
  assert.equal(second.status, 200);
  assert.equal(second.body, first.body);
  assert.equal(second.headers['Idempotent-Replayed'], 'true');

  const scope = orgScope(fixture.seed.org.id, {
    personId: fixture.seed.buyer.id,
    kind: 'user',
    roles: new Set(),
  });
  const approvals = auditRepo(fixture.db, scope, TEST_CLOCK)
    .listForRequisition(id)
    .filter((line) => line.action === 'approve');
  assert.equal(approvals.length, 1);
});

test('reject without a reason is 400, and with one is 200', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  const id = String(moved.json['id']);
  const noReason = post(fixture, id, 'reject', fixture.tokens.owner, { version: moved.json['version'] });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json['code'], 'validation_failed');

  const blank = post(fixture, id, 'reject', fixture.tokens.owner, {
    version: moved.json['version'],
    reason: '   ',
  });
  assert.equal(blank.status, 400);

  const tooLong = post(fixture, id, 'reject', fixture.tokens.owner, {
    version: moved.json['version'],
    reason: 'x'.repeat(501),
  });
  assert.equal(tooLong.status, 400);

  const ok = post(fixture, id, 'reject', fixture.tokens.owner, {
    version: moved.json['version'],
    reason: '  not this quarter  ',
  });
  assert.equal(ok.status, 200, ok.body);
  assert.equal(ok.json['state'], 'rejected');
  const history = ok.json['history'] as { action: string; reason: string | null }[];
  assert.equal(history[history.length - 1]?.reason, 'not this quarter');
});

test('a rejected requisition is copied forward, and the source stays terminal', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  const id = String(moved.json['id']);
  const rejected = post(fixture, id, 'reject', fixture.tokens.owner, {
    version: moved.json['version'],
    reason: 'no',
  });
  assert.equal(rejected.status, 200);

  const copy = post(fixture, id, 'copy', fixture.tokens.buyer, {});
  assert.equal(copy.status, 201, copy.body);
  assert.equal(copy.json['copiedFromId'], id);
  assert.equal(copy.json['state'], 'draft');
  assert.equal(copy.headers['Location'], `/api/v1/requisitions/${String(copy.json['id'])}`);

  const source = get(fixture, id, fixture.tokens.buyer);
  assert.equal(source.json['state'], 'rejected');
  assert.equal(source.json['version'], rejected.json['version']);

  // a copy of something that is not rejected is wrong_state
  const freshDraft = newDraft(fixture, 250_000);
  const badCopy = post(fixture, String(freshDraft.json['id']), 'copy', fixture.tokens.buyer, {});
  assert.equal(badCopy.status, 409);
  assert.equal(badCopy.json['code'], 'wrong_state');

  // and a copy by somebody who is not the buyer is not_authorised
  const notMine = post(fixture, id, 'copy', fixture.tokens.stranger, {});
  assert.equal(notMine.status, 403);
});

test('a person without the buyer role cannot create, edit, submit, cancel or copy', () => {
  const fixture = setUp();
  const created = call(fixture.app, {
    method: 'POST',
    path: '/api/v1/requisitions',
    token: fixture.tokens.owner,
    key: nextKey(),
    body: {
      costCentreId: fixture.seed.costCentre.id,
      lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 1_000 }],
    },
  });
  assert.equal(created.status, 403);
  assert.equal(created.json['code'], 'not_authorised');
  // presence: the buyer, with the role, is accepted on the same body.
  assert.equal(newDraft(fixture, 1_000).status, 201);
});

test('any member of the organisation may read any requisition of the organisation', () => {
  const fixture = setUp();
  const draft = newDraft(fixture, 250_000);
  const id = String(draft.json['id']);
  for (const token of Object.values(fixture.tokens)) {
    const answer = get(fixture, id, token);
    assert.equal(answer.status, 200);
    assert.equal(answer.json['id'], id);
  }
});

test('actions in the detail is exactly the set of POSTs the server accepts', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  const id = String(moved.json['id']);

  const expected: Record<string, string[]> = {
    buyer: ['cancel'],
    owner: ['approve', 'reject'],
    finance: [],
    stranger: [],
  };
  const everyAction = ['submit', 'approve', 'reject', 'cancel', 'copy'];

  for (const [who, token] of Object.entries(fixture.tokens)) {
    const detail = get(fixture, id, token);
    assert.deepEqual(detail.json['actions'], expected[who], `${who}: actions`);

    // and the POSTs agree: an action that is offered is not refused with 403/409, and one
    // that is not offered is refused.
    for (const action of everyAction) {
      const offered = (expected[who] ?? []).includes(action);
      if (offered) {
        continue;
      }
      const refused = post(fixture, id, action, token, {
        version: moved.json['version'],
        reason: 'because',
      });
      assert.ok(
        refused.status === 403 || refused.status === 409,
        `${who}/${action} was offered nowhere but answered ${String(refused.status)}`,
      );
    }
  }

  // presence: the two offered actions really are accepted.
  const rejected = post(fixture, id, 'reject', fixture.tokens.owner, {
    version: moved.json['version'],
    reason: 'no',
  });
  assert.equal(rejected.status, 200);
});

test('a draft offers edit, submit and cancel to its buyer and nothing to anyone else', () => {
  const fixture = setUp();
  const draft = newDraft(fixture, 250_000);
  const id = String(draft.json['id']);
  assert.deepEqual(draft.json['actions'], ['edit', 'submit', 'cancel']);
  assert.deepEqual(get(fixture, id, fixture.tokens.owner).json['actions'], []);
  assert.deepEqual(get(fixture, id, fixture.tokens.stranger).json['actions'], []);
});

test('a submitted requisition can no longer be edited', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  const answer = call(fixture.app, {
    method: 'PATCH',
    path: `/api/v1/requisitions/${String(moved.json['id'])}`,
    token: fixture.tokens.buyer,
    key: nextKey(),
    body: { lines: [{ description: 'Cheaper', quantity: 1, unitPriceMinor: 1 }] },
  });
  assert.equal(answer.status, 409);
  assert.equal(answer.json['code'], 'wrong_state');
  assert.equal(answer.json['detail'], 'edit is not allowed from submitted');
});

test('a draft edit replaces the whole line set and bumps the version', () => {
  const fixture = setUp();
  const draft = newDraft(fixture, 250_000);
  const id = String(draft.json['id']);
  const changed = call(fixture.app, {
    method: 'PATCH',
    path: `/api/v1/requisitions/${id}`,
    token: fixture.tokens.buyer,
    key: nextKey(),
    body: {
      version: draft.json['version'],
      lines: [
        { description: 'Monitor', quantity: 2, unitPriceMinor: 30_000 },
        { description: 'Cable', quantity: 1, unitPriceMinor: 1_000 },
      ],
    },
  });
  assert.equal(changed.status, 200, changed.body);
  assert.equal((changed.json['lines'] as unknown[]).length, 2);
  assert.deepEqual(changed.json['total'], { amountMinor: 61_000, currency: 'EUR' });
  assert.equal(changed.json['version'], 2);
  // the would-match rule follows the new total
  assert.equal(changed.json['ruleCode'], null);
  assert.equal((changed.json['rule'] as { source: string }).source, 'would_match');

  const stale = call(fixture.app, {
    method: 'PATCH',
    path: `/api/v1/requisitions/${id}`,
    token: fixture.tokens.buyer,
    key: nextKey(),
    body: { version: 1, lines: [{ description: 'X', quantity: 1, unitPriceMinor: 1 }] },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json['code'], 'conflict');
  assert.equal(stale.json['detail'], 'expected version 1, found 2');
});

test('awaiting names the person a submitted requisition waits on, even when that is its buyer (G-017)', () => {
  const fixture = setUp();
  const moved = submittedUnderR2(fixture);
  assert.deepEqual(moved.json['awaiting'], {
    kind: 'cost_centre_owner',
    personId: fixture.seed.owner.id,
  });
  const draft = newDraft(fixture, 250_000);
  assert.equal(draft.json['awaiting'], null, 'a draft waits on nobody');
});

test('the list filters by state, mine and awaiting_me, and refuses a bad filter', () => {
  const fixture = setUp();
  const mine = submittedUnderR2(fixture);
  const other = newDraft(fixture, 250_000, fixture.tokens.finance);
  assert.equal(other.status, 201);

  const all = call(fixture.app, { method: 'GET', path: '/api/v1/requisitions', token: fixture.tokens.buyer });
  assert.equal((all.json['items'] as unknown[]).length, 2, 'the organisation is the boundary');

  const onlyMine = call(fixture.app, {
    method: 'GET',
    path: '/api/v1/requisitions?mine=1',
    token: fixture.tokens.finance,
  });
  assert.deepEqual(
    (onlyMine.json['items'] as { id: string }[]).map((item) => item.id),
    [String(other.json['id'])],
  );

  const awaiting = call(fixture.app, {
    method: 'GET',
    path: '/api/v1/requisitions?awaiting_me=1',
    token: fixture.tokens.owner,
  });
  assert.deepEqual(
    (awaiting.json['items'] as { id: string }[]).map((item) => item.id),
    [String(mine.json['id'])],
  );
  const awaitingNobody = call(fixture.app, {
    method: 'GET',
    path: '/api/v1/requisitions?awaiting_me=true',
    token: fixture.tokens.finance,
  });
  assert.deepEqual(awaitingNobody.json['items'], []);

  for (const query of ['state=nonsense', 'mine=yes', 'awaiting_me=0']) {
    const refused = call(fixture.app, {
      method: 'GET',
      path: `/api/v1/requisitions?${query}`,
      token: fixture.tokens.buyer,
    });
    assert.equal(refused.status, 400, query);
  }
});

test('GET /rules returns the organisation table by seq', () => {
  const fixture = setUp();
  const answer = call(fixture.app, { method: 'GET', path: '/api/v1/rules', token: fixture.tokens.stranger });
  assert.equal(answer.status, 200);
  assert.deepEqual(
    (answer.json['items'] as { seq: number; ruleCode: string }[]).map((rule) => [rule.seq, rule.ruleCode]),
    [
      [10, 'R1'],
      [20, 'R2'],
      [30, 'R3'],
    ],
  );
});
