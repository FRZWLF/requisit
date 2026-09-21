import type { Refusal, RefusalCode } from '../refusal.ts';

/**
 * One status per refusal code, in one table (D-016, D-023). The type of the record is
 * `Record<RefusalCode, number>`, so adding a code to the type without a row here does not
 * compile — the table cannot drift from the type it maps.
 */
export const STATUS_BY_CODE: Readonly<Record<RefusalCode, number>> = {
  validation_failed: 400,
  unauthenticated: 401,
  not_authorised: 403,
  not_found: 404,
  wrong_state: 409,
  conflict: 409,
  idempotency_key_reuse: 409,
  no_rule_matched: 422,
};

const TITLES: Readonly<Record<RefusalCode, string>> = {
  validation_failed: 'Validation failed',
  unauthenticated: 'Unauthenticated',
  not_authorised: 'Not authorised',
  not_found: 'Not found',
  wrong_state: 'Wrong state',
  conflict: 'Conflict',
  idempotency_key_reuse: 'Idempotency key reuse',
  no_rule_matched: 'No rule matched',
};

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const JSON_CONTENT_TYPE = 'application/json';

export function statusFor(code: RefusalCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * The RFC 9457-shaped body. Problem bodies are **snake_case**; success bodies are the
 * camelCase domain types (D-023) — two conventions, both frozen for splits 03 and 04.
 */
export function problemBody(refusal: Refusal, requestId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: `urn:requisit:problem:${refusal.code}`,
    title: TITLES[refusal.code],
    status: statusFor(refusal.code),
    code: refusal.code,
  };
  if (refusal.detail !== undefined) {
    body['detail'] = refusal.detail;
  }
  if (refusal.requisitionId !== undefined) {
    body['requisition_id'] = refusal.requisitionId;
  }
  if (refusal.rule !== undefined) {
    body['rule'] = refusal.rule;
  }
  body['request_id'] = requestId;
  return body;
}

/** A throw carries the request id and nothing else — no message, no stack (D-023). */
export function internalErrorBody(requestId: string): Record<string, unknown> {
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    request_id: requestId,
  };
}
