import { refuse, type Result } from '../refusal.ts';
import type { ApprovalRule, CostCentre, Requisition } from './types.ts';

/**
 * Rule matching (D-008). Pure: no database, no scope, no clock — the caller has already
 * loaded the organisation's rows through `rulesRepo`. First match wins on `seq` ascending;
 * `max_total_minor = null` is the terminal unbounded row every organisation must have.
 */

/** Who a matched rule sends the requisition to, resolved against this requisition. */
export type ApproverSpec =
  | { readonly kind: 'self'; readonly personId: string }
  | { readonly kind: 'cost_centre_owner'; readonly personId: string }
  | { readonly kind: 'finance'; readonly personId: null };

/**
 * The first row whose ceiling covers `totalMinor`. The comparison is **inclusive**: a total
 * exactly on a threshold matches that row. The caller's order is not trusted — a copy is
 * sorted by `seq` here, so a repository that ever forgets its `ORDER BY` cannot change who
 * approves.
 */
export function matchRule(
  rules: readonly ApprovalRule[],
  totalMinor: number,
): Result<ApprovalRule> {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    return refuse('validation_failed', 'totalMinor must be a non-negative safe integer');
  }
  const ordered = [...rules].sort((left, right) => left.seq - right.seq);
  for (const rule of ordered) {
    if (rule.maxTotalMinor === null || rule.maxTotalMinor >= totalMinor) {
      return rule;
    }
  }
  return refuse(
    'no_rule_matched',
    `no rule in this organisation covers ${String(totalMinor)}`,
  );
}

/** The phrase every `not_authorised` detail is built from, so the wording lives in one place. */
export function describeRule(rule: Pick<ApprovalRule, 'approverKind'>): string {
  switch (rule.approverKind) {
    case 'self':
      return 'the buyer themselves';
    case 'cost_centre_owner':
      return 'the cost centre owner';
    case 'finance':
      return 'finance';
  }
}

/**
 * The concrete approver a matched rule points at. `finance` resolves to a *role*, not a
 * person — which is why no `approver_person_id` column exists (D-024).
 */
export function resolveApprover(
  rule: ApprovalRule,
  requisition: Requisition,
  costCentre: CostCentre,
): ApproverSpec {
  switch (rule.approverKind) {
    case 'self':
      return { kind: 'self', personId: requisition.buyerPersonId };
    case 'cost_centre_owner':
      return { kind: 'cost_centre_owner', personId: costCentre.ownerPersonId };
    case 'finance':
      return { kind: 'finance', personId: null };
  }
}
