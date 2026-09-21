import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefusal } from '../../src/refusal.ts';
import { describeRule, matchRule, resolveApprover } from '../../src/domain/rules.ts';
import type { ApprovalRule, CostCentre, Requisition } from '../../src/domain/types.ts';

/**
 * D-008's matcher, table-driven. The expectations are derived from what the rule *means*
 * ("the first row whose ceiling covers the total"), not read back from the implementation.
 */

function rule(
  seq: number,
  maxTotalMinor: number | null,
  approverKind: ApprovalRule['approverKind'],
  ruleCode: string,
): ApprovalRule {
  return { id: `rule-${ruleCode}`, orgId: 'org', seq, maxTotalMinor, approverKind, ruleCode };
}

const R1 = rule(10, 10_000, 'self', 'R1');
const R2 = rule(20, 500_000, 'cost_centre_owner', 'R2');
const R3 = rule(30, null, 'finance', 'R3');
const TABLE: readonly ApprovalRule[] = [R1, R2, R3];

interface MatchCase {
  readonly name: string;
  readonly totalMinor: number;
  readonly expected: string;
}

const CASES: readonly MatchCase[] = [
  { name: 'below the first threshold', totalMinor: 5_000, expected: 'R1' },
  { name: 'zero', totalMinor: 0, expected: 'R1' },
  { name: 'exactly on the first threshold (>= is inclusive)', totalMinor: 10_000, expected: 'R1' },
  { name: 'one minor unit above the first threshold', totalMinor: 10_001, expected: 'R2' },
  { name: 'between rows', totalMinor: 250_000, expected: 'R2' },
  { name: 'exactly on the second threshold', totalMinor: 500_000, expected: 'R2' },
  { name: 'above every bounded row', totalMinor: 500_001, expected: 'R3' },
  { name: 'far above every bounded row', totalMinor: 99_000_000, expected: 'R3' },
];

for (const matchCase of CASES) {
  test(`matchRule: ${matchCase.name}`, () => {
    const matched = matchRule(TABLE, matchCase.totalMinor);
    assert.ok(!isRefusal(matched), `expected a rule for ${String(matchCase.totalMinor)}`);
    assert.equal(isRefusal(matched) ? '' : matched.ruleCode, matchCase.expected);
  });
}

test('matchRule does not trust the caller order — it sorts by seq itself', () => {
  const shuffled = [R3, R2, R1];
  // presence: the unsorted list really is in the wrong order for a naive first-hit walk.
  assert.equal(shuffled[0]?.ruleCode, 'R3');
  assert.equal(isRefusal(matchRule(shuffled, 5_000)) ? '' : 'R1', 'R1');
  const matched = matchRule(shuffled, 5_000);
  assert.equal(isRefusal(matched) ? '' : matched.ruleCode, 'R1');
  const higher = matchRule(shuffled, 250_000);
  assert.equal(isRefusal(higher) ? '' : higher.ruleCode, 'R2');
});

test('an organisation without a terminal unbounded row refuses with no_rule_matched', () => {
  const bounded = [R1, R2];
  // presence: the same table still answers below its ceiling.
  const covered = matchRule(bounded, 500_000);
  assert.ok(!isRefusal(covered));
  const uncovered = matchRule(bounded, 500_001);
  assert.ok(isRefusal(uncovered));
  assert.equal(isRefusal(uncovered) ? uncovered.code : '', 'no_rule_matched');
  assert.match(isRefusal(uncovered) ? (uncovered.detail ?? '') : '', /500001/);
});

test('an empty rule table is no_rule_matched, not a crash', () => {
  const nothing = matchRule([], 1);
  assert.ok(isRefusal(nothing));
  assert.equal(isRefusal(nothing) ? nothing.code : '', 'no_rule_matched');
});

for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
  test(`matchRule refuses a total that is not a non-negative safe integer: ${String(bad)}`, () => {
    const refused = matchRule(TABLE, bad);
    assert.ok(isRefusal(refused));
    assert.equal(isRefusal(refused) ? refused.code : '', 'validation_failed');
  });
}

test('describeRule names the approver of every kind', () => {
  assert.equal(describeRule(R1), 'the buyer themselves');
  assert.equal(describeRule(R2), 'the cost centre owner');
  assert.equal(describeRule(R3), 'finance');
});

test('resolveApprover: self is the buyer, cost_centre_owner is the owner, finance is a role', () => {
  const requisition = { buyerPersonId: 'person-buyer' } as Requisition;
  const costCentre = { ownerPersonId: 'person-owner' } as CostCentre;
  assert.deepEqual(resolveApprover(R1, requisition, costCentre), {
    kind: 'self',
    personId: 'person-buyer',
  });
  assert.deepEqual(resolveApprover(R2, requisition, costCentre), {
    kind: 'cost_centre_owner',
    personId: 'person-owner',
  });
  assert.deepEqual(resolveApprover(R3, requisition, costCentre), {
    kind: 'finance',
    personId: null,
  });
});
