import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/db/migrate.ts';

/** Every suite builds its own schema from the migrations, in memory, offline (D-014). */
export function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}
