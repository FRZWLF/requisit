/** The row shapes the whole service shares. Columns are `snake_case`; fields are `camelCase`. */

/**
 * `merchant` is the order-feed integration of one organisation (D-006 addendum, D-011
 * addendum, migration `0003`). It is a role and not a second credential format because
 * D-005 knows one kind of token and the audit has to be able to name who acknowledged.
 */
export type Role = 'buyer' | 'approver' | 'finance' | 'admin' | 'merchant';
export const ROLES: readonly Role[] = ['buyer', 'approver', 'finance', 'admin', 'merchant'];

export type ActorKind = 'user' | 'agent' | 'system';
export const ACTOR_KINDS: readonly ActorKind[] = ['user', 'agent', 'system'];

/** Who a rule sends a requisition to (D-008). Matching itself is split 02's. */
export type ApproverKind = 'self' | 'cost_centre_owner' | 'finance';
export const APPROVER_KINDS: readonly ApproverKind[] = ['self', 'cost_centre_owner', 'finance'];

export type RequisitionState =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'ordered';
export const REQUISITION_STATES: readonly RequisitionState[] = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
  'ordered',
];

export interface Org {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly requisitionSeq: number;
  readonly createdAt: string;
}

export interface Person {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
}

export interface CostCentre {
  readonly id: string;
  readonly orgId: string;
  readonly code: string;
  readonly name: string;
  readonly ownerPersonId: string;
  readonly createdAt: string;
}

export interface CatalogueItem {
  readonly id: string;
  readonly orgId: string;
  readonly sku: string;
  readonly name: string;
  readonly unitPriceMinor: number;
  readonly currency: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface Requisition {
  readonly id: string;
  readonly orgId: string;
  readonly number: string;
  readonly buyerPersonId: string;
  readonly costCentreId: string;
  readonly state: RequisitionState;
  readonly version: number;
  readonly currency: string;
  readonly ruleId: string | null;
  readonly ruleCode: string | null;
  readonly copiedFromId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
}

export interface RequisitionLine {
  readonly id: string;
  readonly orgId: string;
  readonly requisitionId: string;
  readonly seq: number;
  readonly catalogueItemId: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly currency: string;
}

export interface RequisitionWithLines extends Requisition {
  readonly lines: readonly RequisitionLine[];
}

export interface ApprovalRule {
  readonly id: string;
  readonly orgId: string;
  readonly seq: number;
  readonly maxTotalMinor: number | null;
  readonly approverKind: ApproverKind;
  readonly ruleCode: string;
}

export interface AuditLine {
  readonly id: number;
  readonly orgId: string;
  readonly requisitionId: string | null;
  readonly actorPersonId: string | null;
  readonly actorKind: ActorKind;
  readonly action: string;
  readonly fromState: RequisitionState | null;
  readonly toState: RequisitionState | null;
  readonly ruleId: string | null;
  readonly totalMinor: number | null;
  readonly currency: string | null;
  readonly reason: string | null;
  readonly at: string;
  readonly requestId: string | null;
}
