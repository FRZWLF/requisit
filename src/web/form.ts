import type { Buffer } from 'node:buffer';
import { refuse, type Result } from '../refusal.ts';
import { MAX_BODY_BYTES } from '../http/body.ts';

/**
 * `application/x-www-form-urlencoded` bodies, bounded and typed at the boundary like the
 * JSON ones (D-023). `URLSearchParams` is a null-prototype store with no `__proto__` seam,
 * and every field is read by name through the accessors below — nothing is spread into an
 * object, so the prototype-pollution shape the JSON parser guards against cannot arise.
 */

export interface Form {
  readonly get: (name: string) => string;
  readonly getAll: (name: string) => string[];
  readonly has: (name: string) => boolean;
}

export function isFormContentType(header: string | undefined): boolean {
  if (header === undefined) {
    return false;
  }
  return (header.split(';')[0]?.trim().toLowerCase() ?? '') === 'application/x-www-form-urlencoded';
}

export function parseForm(raw: Buffer, contentType: string | undefined): Result<Form> {
  if (raw.length > MAX_BODY_BYTES) {
    return refuse(
      'validation_failed',
      `the request body may be at most ${String(MAX_BODY_BYTES)} bytes`,
    );
  }
  if (raw.length > 0 && !isFormContentType(contentType)) {
    return refuse('validation_failed', 'a form must be application/x-www-form-urlencoded');
  }
  const params = new URLSearchParams(raw.toString('utf8'));
  return {
    get: (name: string): string => params.get(name) ?? '',
    getAll: (name: string): string[] => params.getAll(name),
    has: (name: string): boolean => params.has(name),
  };
}
