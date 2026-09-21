import { randomUUID } from 'node:crypto';

/** Business ids are random UUIDs so they carry no volume or ordering signal (D-017). */
export function newId(): string {
  return randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check for ids that arrive from outside the process (CLI arguments, tokens). */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
