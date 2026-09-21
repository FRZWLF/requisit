import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

/**
 * The request fingerprint of D-010: sha256 over the method, the **concrete** path and the
 * raw body bytes. The stored `endpoint` is the route *pattern*, so the same key used on two
 * different requisitions lands on the same row and is caught as a reuse — which is the
 * whole point of fingerprinting rather than keying on the body alone.
 *
 * Each part is prefixed with its byte length rather than only separated by a newline: with a
 * bare separator, `(POST, "/a\n/b")` and `("POST\n/a", "/b")` hash identically, and a
 * fingerprint that can be made to collide by moving bytes across the boundary is not one.
 */

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
export const REPLAYED_HEADER = 'Idempotent-Replayed';

export function isIdempotencyKey(value: string | undefined): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_RE.test(value);
}

export function fingerprintOf(method: string, path: string, body: Buffer): string {
  const framed = (part: string): string => `${String(Buffer.byteLength(part, 'utf8'))}:${part}\n`;
  return createHash('sha256')
    .update(framed(method), 'utf8')
    .update(framed(path), 'utf8')
    .update(String(body.length), 'utf8')
    .update(':', 'utf8')
    .update(body)
    .digest('hex');
}

/** The `endpoint` column: method plus the route pattern, never the concrete path. */
export function endpointOf(method: string, pattern: string): string {
  return `${method} ${pattern}`;
}
