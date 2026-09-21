import type { DatabaseSync } from 'node:sqlite';

const txBrand: unique symbol = Symbol('requisit.tx');

/**
 * A handle that exists only inside `withTransaction`. Every write in every repository takes
 * one as its first argument, so "the audit line is in the same transaction as the state
 * change" (D-007) is a thing the compiler enforces rather than a thing to remember.
 */
export interface Tx {
  readonly db: DatabaseSync;
  readonly [txBrand]: true;
}

/**
 * `BEGIN IMMEDIATE` — the write lock is taken up front, so two writers fail fast instead of
 * halfway through. There are no savepoints in v1: a nested call is a bug, not a use case
 * (D-022). The callback must be synchronous; `node:sqlite` is, and a transaction that awaits
 * would hold the single write lock across the event loop.
 */
export function withTransaction<T>(db: DatabaseSync, fn: (tx: Tx) => T): T {
  if (db.isTransaction) {
    throw new Error('withTransaction: a transaction is already open (nesting is a bug)');
  }
  const tx = { db, [txBrand]: true } as Tx;
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = fn(tx);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('COMMIT');
  return result;
}
