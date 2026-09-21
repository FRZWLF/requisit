import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefusal } from '../../src/refusal.ts';
import { orgScope, type OrgScope } from '../../src/db/scope.ts';
import {
  ACTIONS,
  ACTOR_RELATIONS,
  TRANSITIONS,
  allowedActions,
  decide,
  mayDecide,
  relationOf,
  type Action,
  type ActorRelation,
} from '../../src/domain/lifecycle.ts';
import { REQUISITION_STATES } from '../../src/domain/types.ts';
import type {
  ApprovalRule,
  CostCentre,
  Requisition,
  RequisitionState,
  Role,
} from '../../src/domain/types.ts';

/**
 * The whole `(state, action, relation)` space — 6 × 7 × 4 = 168 cells — checked against a
 * list written by hand from D-009 and D-024, never read back from `TRANSITIONS`. Deleting a
 * row from the table therefore flips a cell here.
 */

interface AllowedTriple {
  readonly from: RequisitionState;
  readonly action: Action;
  readonly by: ActorRelation;
  readonly to: RequisitionState;
}

const ALLOWED: readonly AllowedTriple[] = [
  { from: 'draft', action: 'edit', by: 'owner', to: 'draft' },
  { from: 'draft', action: 'submit', by: 'owner', to: 'submitted' },
  { from: 'draft', action: 'cancel', by: 'owner', to: 'cancelled' },
  { from: 'submitted', action: 'approve', by: 'resolved_approver', to: 'approved' },
  { from: 'submitted', action: 'approve', by: 'system', to: 'approved' },
  { from: 'submitted', action: 'reject', by: 'resolved_approver', to: 'rejected' },
  { from: 'submitted', action: 'cancel', by: 'owner', to: 'cancelled' },
  { from: 'rejected', action: 'copy', by: 'owner', to: 'draft' },
  { from: 'approved', action: 'order', by: 'system', to: 'ordered' },
];

/** Every `(state, action)` a row exists for, whoever the actor is. */
const REACHABLE = new Set(ALLOWED.map((triple) => `${triple.from}|${triple.action}`));

test('the generated matrix covers every state, action and relation', () => {
  const cells = REQUISITION_STATES.length * ACTIONS.length * ACTOR_RELATIONS.length;
  assert.equal(cells, 168, 'presence: the matrix is the size D-009 describes');
  assert.equal(TRANSITIONS.length, ALLOWED.length, 'the table and the hand-written list agree in size');
});

for (const state of REQUISITION_STATES) {
  for (const action of ACTIONS) {
    for (const relation of ACTOR_RELATIONS) {
      test(`decide(${state}, ${action}, ${relation})`, () => {
        const expected = ALLOWED.find(
          (triple) => triple.from === state && triple.action === action && triple.by === relation,
        );
        const answer = decide(state, action, relation, {
          requisitionId: 'req-1',
          rule: { ruleCode: 'R2', approverKind: 'cost_centre_owner' },
        });
        if (expected !== undefined) {
          assert.equal(answer, expected.to);
          return;
        }
        assert.ok(isRefusal(answer), `${state}/${action}/${relation} must refuse`);
        if (!isRefusal(answer)) {
          return;
        }
        if (REACHABLE.has(`${state}|${action}`)) {
          assert.equal(answer.code, 'not_authorised');
          assert.equal(answer.rule, 'R2');
        } else {
          assert.equal(answer.code, 'wrong_state');
          assert.equal(answer.detail, `${action} is not allowed from ${state}`);
        }
        assert.equal(answer.requisitionId, 'req-1');
      });
    }
  }
}

test('a wrong_state detail names both the action and the state it came from', () => {
  const refused = decide('draft', 'approve', 'resolved_approver');
  assert.ok(isRefusal(refused));
  assert.equal(isRefusal(refused) ? refused.code : '', 'wrong_state');
  assert.equal(isRefusal(refused) ? refused.detail : '', 'approve is not allowed from draft');
});

test('the not_authorised wording names who may act, per rule kind', () => {
  const asOther = (approverKind: ApprovalRule['approverKind'], ruleCode: string) =>
    decide('submitted', 'approve', 'other', { rule: { ruleCode, approverKind } });

  const centre = asOther('cost_centre_owner', 'R2');
  assert.equal(
    isRefusal(centre) ? centre.detail : '',
    'only the cost centre owner may approve under rule R2',
  );
  const finance = asOther('finance', 'R3');
  assert.equal(isRefusal(finance) ? finance.detail : '', 'only finance may approve under rule R3');

  const buyer = decide('submitted', 'approve', 'owner', {
    rule: { ruleCode: 'R2', approverKind: 'cost_centre_owner' },
    isBuyer: true,
  });
  assert.equal(
    isRefusal(buyer) ? buyer.detail : '',
    'a buyer may not approve their own requisition',
  );

  const selfRule = decide('submitted', 'approve', 'other', {
    rule: { ruleCode: 'R1', approverKind: 'self' },
  });
  assert.equal(
    isRefusal(selfRule) ? selfRule.detail : '',
    'rule R1 approves at submission; approve is not a manual act',
  );
});

function scopeFor(personId: string, roles: readonly Role[]): OrgScope {
  return orgScope('org-1', { personId, kind: 'user', roles: new Set(roles) });
}

const REQUISITION = { id: 'req-1', buyerPersonId: 'buyer', state: 'submitted' } as Requisition;
const CENTRE = { ownerPersonId: 'owner' } as CostCentre;
const SELF_RULE = { ruleCode: 'R1', approverKind: 'self' } as ApprovalRule;
const CENTRE_RULE = { ruleCode: 'R2', approverKind: 'cost_centre_owner' } as ApprovalRule;
const FINANCE_RULE = { ruleCode: 'R3', approverKind: 'finance' } as ApprovalRule;

test('mayDecide: the cost centre owner decides a cost_centre_owner rule', () => {
  assert.equal(mayDecide(scopeFor('owner', []), REQUISITION, CENTRE_RULE, CENTRE), true);
  assert.equal(mayDecide(scopeFor('someone', ['approver']), REQUISITION, CENTRE_RULE, CENTRE), false);
});

test('mayDecide: ownership is the fact, not the approver role', () => {
  // presence: the same person with the role but without the ownership is refused.
  assert.equal(mayDecide(scopeFor('owner', []), REQUISITION, CENTRE_RULE, CENTRE), true);
  assert.equal(
    mayDecide(scopeFor('not-owner', ['approver', 'admin']), REQUISITION, CENTRE_RULE, CENTRE),
    false,
  );
});

test('mayDecide: a finance rule resolves to the role', () => {
  assert.equal(mayDecide(scopeFor('anyone', ['finance']), REQUISITION, FINANCE_RULE, CENTRE), true);
  assert.equal(mayDecide(scopeFor('anyone', ['approver']), REQUISITION, FINANCE_RULE, CENTRE), false);
});

test('mayDecide: a buyer never decides their own requisition, however many hats they wear', () => {
  const buyerWhoOwnsTheCentre = { ownerPersonId: 'buyer' } as CostCentre;
  assert.equal(
    mayDecide(scopeFor('buyer', ['buyer']), REQUISITION, CENTRE_RULE, buyerWhoOwnsTheCentre),
    false,
  );
  assert.equal(
    mayDecide(scopeFor('buyer', ['buyer', 'finance']), REQUISITION, FINANCE_RULE, CENTRE),
    false,
  );
  // presence: strip the buyer identity and the same scope does decide.
  assert.equal(
    mayDecide(scopeFor('somebody-else', ['finance']), REQUISITION, FINANCE_RULE, CENTRE),
    true,
  );
});

test('mayDecide: a stored self rule is never manually decidable, by anybody', () => {
  for (const personId of ['buyer', 'owner', 'finance-person']) {
    assert.equal(
      mayDecide(scopeFor(personId, ['buyer', 'finance', 'approver', 'admin']), REQUISITION, SELF_RULE, CENTRE),
      false,
      `${personId} must not decide a self rule manually`,
    );
  }
});

test('mayDecide: a scope without a person decides nothing', () => {
  const system = orgScope('org-1', { personId: null, kind: 'system', roles: new Set(['finance'] as const) });
  assert.equal(mayDecide(system, REQUISITION, FINANCE_RULE, CENTRE), false);
});

test('relationOf: owner wins, then resolved_approver, then other', () => {
  assert.equal(relationOf(scopeFor('buyer', ['buyer']), REQUISITION, CENTRE_RULE, CENTRE), 'owner');
  assert.equal(relationOf(scopeFor('owner', []), REQUISITION, CENTRE_RULE, CENTRE), 'resolved_approver');
  assert.equal(relationOf(scopeFor('nobody', []), REQUISITION, CENTRE_RULE, CENTRE), 'other');
  assert.equal(relationOf(scopeFor('owner', []), REQUISITION, null, null), 'other');
});

test('allowedActions is exactly what decide accepts, and never offers order', () => {
  assert.deepEqual(allowedActions('draft', 'owner', { hasBuyerRole: true }), [
    'edit',
    'submit',
    'cancel',
  ]);
  assert.deepEqual(allowedActions('draft', 'owner', { hasBuyerRole: false }), []);
  assert.deepEqual(allowedActions('submitted', 'resolved_approver', { hasBuyerRole: false }), [
    'approve',
    'reject',
  ]);
  assert.deepEqual(allowedActions('submitted', 'owner', { hasBuyerRole: true }), ['cancel']);
  assert.deepEqual(allowedActions('rejected', 'owner', { hasBuyerRole: true }), ['copy']);
  assert.deepEqual(allowedActions('approved', 'system', { hasBuyerRole: true }), []);
  assert.deepEqual(allowedActions('cancelled', 'owner', { hasBuyerRole: true }), []);
});
