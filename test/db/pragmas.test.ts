import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, openDatabase } from '../../src/db/open.ts';
import { migrate } from '../../src/db/migrate.ts';
import { TEST_CLOCK } from '../support/seed.ts';

/**
 * `journal_mode=WAL` reads back as `memory` on a `:memory:` database, so the only honest
 * place to assert the pragmas is a file — under the OS temp directory, which the issue's
 * test rules allow. Everything else in the suite stays in memory.
 */
function withTempDb(fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'requisit-pragmas-'));
  try {
    fn(join(dir, 'requisit.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('openDatabase applies all four pragmas, read back one by one', () => {
  withTempDb((path) => {
    const db = openDatabase(path);
    try {
      const read = (sql: string, column: string): unknown =>
        (db.prepare(sql).get() as Record<string, unknown> | undefined)?.[column];
      assert.equal(read('PRAGMA journal_mode', 'journal_mode'), 'wal');
      assert.equal(read('PRAGMA synchronous', 'synchronous'), 1);
      assert.equal(read('PRAGMA busy_timeout', 'timeout'), 5000);
      assert.equal(read('PRAGMA foreign_keys', 'foreign_keys'), 1);
    } finally {
      closeDatabase(db);
    }
  });
});

test('foreign_keys=ON is in force: a dangling reference is rejected', () => {
  withTempDb((path) => {
    const db = openDatabase(path);
    try {
      migrate(db, undefined, TEST_CLOCK);
      // presence: the same statement shape succeeds when the organisation exists.
      db.prepare('INSERT INTO orgs (id, name, currency, created_at) VALUES (?, ?, ?, ?)').run(
        'org-1',
        'Acme',
        'EUR',
        '2026-09-21T10:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO people (id, org_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p-1', 'org-1', 'Bea', 'bea@example.test', '2026-09-21T10:00:00.000Z');

      assert.throws(
        () =>
          db
            .prepare('INSERT INTO people (id, org_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('p-2', 'org-missing', 'Nobody', 'nobody@example.test', '2026-09-21T10:00:00.000Z'),
        /FOREIGN KEY/i,
      );
    } finally {
      closeDatabase(db);
    }
  });
});

test('STRICT tables reject a value of the wrong type', () => {
  withTempDb((path) => {
    const db = openDatabase(path);
    try {
      migrate(db, undefined, TEST_CLOCK);
      db.prepare('INSERT INTO orgs (id, name, currency, created_at) VALUES (?, ?, ?, ?)').run(
        'org-1',
        'Acme',
        'EUR',
        '2026-09-21T10:00:00.000Z',
      );
      assert.throws(
        () =>
          db
            .prepare('UPDATE orgs SET requisition_seq = ? WHERE id = ?')
            .run('not a number', 'org-1'),
        /datatype mismatch|cannot store/i,
      );
    } finally {
      closeDatabase(db);
    }
  });
});
