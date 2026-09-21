import { isRefusal, refuse, type Result } from '../refusal.ts';
import { hasRole, type OrgScope } from '../db/scope.ts';
import { describeRule } from './rules.ts';
import type { ApprovalRule, ApproverKind, CostCentre, Requisition, RequisitionState } from './types.ts';

/**
 * The one transition table (D-009, D-024). Everything that moves a requisition asks
 * `decide`; nothing else knows which moves exist. Pure — no database, no clock — so the
 * whole `(state, action, relation)` space is enumerable by a test.
 */

export type Action = 'edit' | 'submit' | 'cancel' | 'approve' | 'reject' | 'copy' | 'order';
export const ACTIONS: readonly Action[] = [
  'edit',
  'submit',
  'cancel',
  'approve',
  'reject',
  'copy',
  'order',
];

/** How the acting scope stands to *this* requisition. Computed by `relationOf`. */
export type ActorRelation = 'owner' | 'resolved_approver' | 'system' | 'other';
export const ACTOR_RELATIONS: readonly ActorRelation[] = [
  'owner',
  'resolved_approver',
  'system',
  'other',
];

export interface Transition {
  readonly from: RequisitionState;
  readonly action: Action;
  readonly to: RequisitionState;
  readonly by: ActorRelation;
}

export const TRANSITIONS: readonly Transition[] = [
  { from: 'draft', action: 'edit', to: 'draft', by: 'owner' },
  { from: 'draft', action: 'submit', to: 'submitted', by: 'owner' },
  { from: 'draft', action: 'cancel', to: 'cancelled', by: 'owner' },
  { from: 'submitted', action: 'approve', to: 'approved', by: 'resolved_approver' },
  { from: 'submitted', action: 'reject', to: 'rejected', by: 'resolved_approver' },
  { from: 'submitted', action: 'cancel', to: 'cancelled', by: 'owner' },
  // The `self`-rule auto-approval, in the same transaction as the submit that triggered it.
  { from: 'submitted', action: 'approve', to: 'approved', by: 'system' },
  // A rejected requisition is copied forward; the source row is never touched (D-009).
  { from: 'rejected', action: 'copy', to: 'draft', by: 'owner' },
  // Present so the outbox acknowledgement in #4 does not have to edit this table; no route
  // reaches it in this split.
  { from: 'approved', action: 'order', to: 'ordered', by: 'system' },
];

/** The rule facts a refusal wording needs. `null` for an action no rule governs. */
export interface DecideRule {
  readonly ruleCode: string;
  readonly approverKind: ApproverKind;
}

export interface DecideContext {
  readonly requisitionId?: string;
  readonly rule?: DecideRule | null;
  /** Whether the acting person is the buyer, so the T2 wording can name that case. */
  readonly isBuyer?: boolean;
}

function notAuthorisedDetail(action: Action, context: DecideContext): string {
  const rule = context.rule ?? null;
  if (rule !== null && rule.approverKind === 'self') {
    return `rule ${rule.ruleCode} approves at submission; ${action} is not a manual act`;
  }
  if (context.isBuyer === true && rule !== null) {
    return `a buyer may not ${action} their own requisition`;
  }
  if (rule === null) {
    return `only the buyer of this requisition may ${action}`;
  }
  const who = describeRule({ approverKind: rule.approverKind });
  return `only ${who} may ${action} under rule ${rule.ruleCode}`;
}

/**
 * State first, then authority: which state a requisition is in is visible to every member
 * of the organisation (D-024), so answering `wrong_state` before `not_authorised` leaks
 * nothing and gives the honest reason.
 */
export function decide(
  state: RequisitionState,
  action: Action,
  relation: ActorRelation,
  context: DecideContext = {},
): Result<RequisitionState> {
  const candidates = TRANSITIONS.filter((row) => row.from === state && row.action === action);
  if (candidates.length === 0) {
    return refuse(
      'wrong_state',
      `${action} is not allowed from ${state}`,
      context.requisitionId === undefined ? {} : { requisitionId: context.requisitionId },
    );
  }
  const allowed = candidates.find((row) => row.by === relation);
  if (allowed === undefined) {
    const extra: { requisitionId?: string; rule?: string } = {};
    if (context.requisitionId !== undefined) {
      extra.requisitionId = context.requisitionId;
    }
    if (context.rule != null) {
      extra.rule = context.rule.ruleCode;
    }
    return refuse('not_authorised', notAuthorisedDetail(action, context), extra);
  }
  return allowed.to;
}

/**
 * Whether this scope is the approver the stored rule resolves to (D-024).
 *
 * The buyer clause comes **first** on purpose: a buyer who also owns the cost centre, or
 * who also holds `finance`, still may not decide their own requisition. `self` is never a
 * manual decision — it auto-approves at submission — so it is false for everybody here.
 */
export function mayDecide(
  scope: OrgScope,
  requisition: Requisition,
  rule: ApprovalRule,
  costCentre: CostCentre,
): boolean {
  const actorPersonId = scope.actor.personId;
  if (actorPersonId === null) {
    return false;
  }
  if (actorPersonId === requisition.buyerPersonId && rule.approverKind !== 'self') {
    return false;
  }
  switch (rule.approverKind) {
    case 'self':
      return false;
    case 'cost_centre_owner':
      return actorPersonId === costCentre.ownerPersonId;
    case 'finance':
      return hasRole(scope, 'finance');
  }
}

/** `owner` wins over `resolved_approver`: the two can only coincide under a `self` rule. */
export function relationOf(
  scope: OrgScope,
  requisition: Requisition,
  rule: ApprovalRule | null,
  costCentre: CostCentre | null,
): ActorRelation {
  if (scope.actor.personId !== null && scope.actor.personId === requisition.buyerPersonId) {
    return 'owner';
  }
  if (rule !== null && costCentre !== null && mayDecide(scope, requisition, rule, costCentre)) {
    return 'resolved_approver';
  }
  return 'other';
}

/** Actions that require the `buyer` role on top of the relation (D-024). */
export const BUYER_ROLE_ACTIONS: readonly Action[] = ['edit', 'submit', 'cancel', 'copy'];

/**
 * What this caller may do next — the `actions` field of the detail. Computed with the same
 * `decide` the write routes call, so the UI can never offer a button the server refuses
 * (D-024). `order` is excluded: no route reaches it in this split.
 */
export function allowedActions(
  state: RequisitionState,
  relation: ActorRelation,
  options: { readonly hasBuyerRole: boolean },
): Action[] {
  return ACTIONS.filter((action) => {
    if (action === 'order') {
      return false;
    }
    if (!options.hasBuyerRole && BUYER_ROLE_ACTIONS.includes(action)) {
      return false;
    }
    return !isRefusal(decide(state, action, relation));
  });
}
