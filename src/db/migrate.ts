import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../clock.ts';
import { withTransaction } from './tx.ts';
import { MIGRATIONS } from './migrations/index.ts';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

/** A schema that cannot be brought up is an operator error, so it throws (D-016). */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const SCHEMA_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Forward-only numbered migrations (D-002, D-020). Ids must be contiguous from 1; a
 * migration whose `sql` changed after it shipped aborts the run *before* anything else
 * happens; each migration runs in its own transaction with its bookkeeping row.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
  clock: Clock = systemClock,
): { applied: number[] } {
  db.exec(SCHEMA_MIGRATIONS);

  migrations.forEach((migration, index) => {
    if (migration.id !== index + 1) {
      throw new MigrationError(
        `migration ids must be contiguous from 1: expected ${index + 1}, found ${migration.id} (${migration.name})`,
      );
    }
  });

  const read = db.prepare('SELECT id, name, checksum FROM schema_migrations WHERE id = ?');
  const record = db.prepare(
    'INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );

  // Two passes: every checksum is verified before the first new migration runs, so a tampered
  // 0001 cannot be discovered halfway through applying 0007.
  const pending: Migration[] = [];
  for (const migration of migrations) {
    const checksum = checksumOf(migration.sql);
    const row = read.get(migration.id) as { checksum?: string } | undefined;
    if (row === undefined) {
      pending.push(migration);
      continue;
    }
    if (row.checksum !== checksum) {
      throw new MigrationError(
        `migration ${migration.id} (${migration.name}) changed after it was applied: checksum mismatch`,
      );
    }
  }

  const applied: number[] = [];
  for (const migration of pending) {
    withTransaction(db, (tx) => {
      tx.db.exec(migration.sql);
      record.run(migration.id, migration.name, checksumOf(migration.sql), toIso(clock.now()));
    });
    applied.push(migration.id);
  }
  return { applied };
}
