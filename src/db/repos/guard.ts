import type { DatabaseSync } from 'node:sqlite';
import type { Tx } from '../tx.ts';

/**
 * Repositories prepare their statements once against the connection they were built with;
 * a `Tx` from a different connection would silently write somewhere else, which is a bug,
 * not a refusal.
 */
export function sameDb(db: DatabaseSync, tx: Tx): void {
  if (tx.db !== db) {
    throw new Error('repository: the transaction belongs to a different database connection');
  }
}
