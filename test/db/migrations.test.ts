import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MigrationError, checksumOf, migrate, type Migration } from '../../src/db/migrate.ts';
import { MIGRATIONS } from '../../src/db/migrations/index.ts';
import { TEST_CLOCK } from '../support/seed.ts';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function migrationRows(db: DatabaseSync): { id: number; name: string; applied_at: string }[] {
  return db.prepare('SELECT id, name, applied_at FROM schema_migrations ORDER BY id').all() as {
    id: number;
    name: string;
    applied_at: string;
  }[];
}

test('a fresh database applies every checked-in migration and records it', () => {
  const db = freshDb();
  const result = migrate(db, MIGRATIONS, TEST_CLOCK);
  assert.deepEqual(
    result.applied,
    MIGRATIONS.map((m) => m.id),
  );
  const rows = migrationRows(db);
  assert.equal(rows.length, MIGRATIONS.length);
  assert.equal(rows[0]?.name, 'initial');
  assert.equal(rows[0]?.applied_at, '2026-09-21T10:00:00.000Z');
});

test('a second run applies nothing', () => {
  const db = freshDb();
  migrate(db, MIGRATIONS, TEST_CLOCK);
  assert.deepEqual(migrate(db, MIGRATIONS, TEST_CLOCK).applied, []);
  assert.equal(migrationRows(db).length, MIGRATIONS.length);
});

test('a migration whose sql changed after it was applied aborts the run', () => {
  const db = freshDb();
  migrate(db, MIGRATIONS, TEST_CLOCK);
  const tampered: Migration[] = MIGRATIONS.map((m) =>
    m.id === 1 ? { ...m, sql: `${m.sql}\n-- a later edit\n` } : m,
  );
  assert.throws(() => migrate(db, tampered, TEST_CLOCK), (error: unknown) => {
    assert.ok(error instanceof MigrationError);
    assert.match(error.message, /1 \(initial\)/);
    assert.match(error.message, /checksum/);
    return true;
  });
});

test('the checksum is over the sql, so an unchanged migration passes', () => {
  assert.equal(checksumOf('a'), checksumOf('a'));
  assert.notEqual(checksumOf('a'), checksumOf('a '));
});

test('a tampered earlier migration aborts before a later one is applied', () => {
  const two: Migration[] = [
    { id: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;' },
    { id: 2, name: 'two', sql: 'CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;' },
  ];
  const db = freshDb();
  migrate(db, [two[0] as Migration], TEST_CLOCK);
  const tampered: Migration[] = [{ ...(two[0] as Migration), sql: '-- edited' }, two[1] as Migration];
  assert.throws(() => migrate(db, tampered, TEST_CLOCK), MigrationError);
  assert.deepEqual(
    migrationRows(db).map((row) => row.id),
    [1],
    'the untouched migration 2 must not have been applied',
  );
});

test('ids must be contiguous from 1', () => {
  const gap: Migration[] = [
    { id: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;' },
    { id: 3, name: 'three', sql: 'CREATE TABLE three (id INTEGER PRIMARY KEY) STRICT;' },
  ];
  assert.throws(() => migrate(freshDb(), gap, TEST_CLOCK), MigrationError);

  const outOfOrder: Migration[] = [
    { id: 2, name: 'two', sql: 'CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;' },
    { id: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;' },
  ];
  assert.throws(() => migrate(freshDb(), outOfOrder, TEST_CLOCK), MigrationError);
});

test('a migration that fails mid-way leaves no trace, and its predecessor stands', () => {
  const failing: Migration[] = [
    { id: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;' },
    {
      id: 2,
      name: 'two',
      sql: 'CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;\nCREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;',
    },
  ];
  const db = freshDb();
  assert.throws(() => migrate(db, failing, TEST_CLOCK));
  assert.deepEqual(
    migrationRows(db).map((row) => row.id),
    [1],
  );
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  ).map((row) => row.name);
  assert.ok(tables.includes('one'), 'presence: migration 1 really created its table');
  assert.ok(!tables.includes('two'), 'the failed migration must have rolled back');
  assert.equal(db.isTransaction, false, 'the failed migration must not leave a transaction open');
});
