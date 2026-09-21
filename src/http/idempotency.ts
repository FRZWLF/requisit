import type { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

/**
 * The request fingerprint of D-010: sha256 over the method, the **concrete** path and the
 * raw body bytes. The stored `endpoint` is the route *pattern*, so the same key used on two
 * different requisitions lands on the same row and is caught as a reuse — which is the
 * whole point of fingerprinting rather than keying on the body alone.
 */

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
export const REPLAYED_HEADER = 'Idempotent-Replayed';

export function isIdempotencyKey(value: string | undefined): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_RE.test(value);
}

export function fingerprintOf(method: string, path: string, body: Buffer): string {
  return createHash('sha256')
    .update(method, 'utf8')
    .update('\n', 'utf8')
    .update(path, 'utf8')
    .update('\n', 'utf8')
    .update(body)
    .digest('hex');
}

/** The `endpoint` column: method plus the route pattern, never the concrete path. */
export function endpointOf(method: string, pattern: string): string {
  return `${method} ${pattern}`;
}
