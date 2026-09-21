import type { SQLOutputValue } from 'node:sqlite';

/**
 * `node:sqlite` hands back `Record<string, SQLOutputValue>`; every repository declares the
 * row shape its own `SELECT` produces. The cast lives here, once, so a reviewer has one
 * place to look for it instead of one per query.
 */
export function rows<T>(values: readonly Record<string, SQLOutputValue>[]): T[] {
  return values as unknown as T[];
}
