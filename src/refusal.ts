/**
 * The one refusal type (D-016). Refusals are *returned*; only bugs and operator errors throw.
 * `unauthenticated` is the D-016 addendum from D-021: no identity at all, as opposed to
 * `not_authorised`, which is a known identity without the authority for this act.
 */
export type RefusalCode =
  | 'not_authorised'
  | 'wrong_state'
  | 'no_rule_matched'
  | 'idempotency_key_reuse'
  | 'conflict'
  | 'not_found'
  | 'validation_failed'
  | 'unauthenticated';

export interface Refusal {
  readonly refused: true;
  readonly code: RefusalCode;
  readonly detail?: string;
  readonly requisitionId?: string;
  readonly rule?: string;
}

/** A value or a refusal. The HTTP status mapping is split 02's (D-012, D-016). */
export type Result<T> = T | Refusal;

export interface RefusalExtra {
  readonly requisitionId?: string;
  readonly rule?: string;
}

export function refuse(code: RefusalCode, detail?: string, extra?: RefusalExtra): Refusal {
  const refusal: {
    refused: true;
    code: RefusalCode;
    detail?: string;
    requisitionId?: string;
    rule?: string;
  } = { refused: true, code };
  if (detail !== undefined) {
    refusal.detail = detail;
  }
  if (extra?.requisitionId !== undefined) {
    refusal.requisitionId = extra.requisitionId;
  }
  if (extra?.rule !== undefined) {
    refusal.rule = extra.rule;
  }
  return refusal;
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && (value as { refused?: unknown }).refused === true;
}
