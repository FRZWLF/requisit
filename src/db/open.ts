import { DatabaseSync } from 'node:sqlite';

/**
 * One file, one process, one write connection (D-002). The four pragmas are applied at open
 * time and `test/db/pragmas.test.ts` reads every one of them back.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function closeDatabase(db: DatabaseSync): void {
  db.close();
}
