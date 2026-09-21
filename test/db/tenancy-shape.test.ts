import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../support/db.ts';

/**
 * D-004 as a mechanical property of the schema: the test walks `sqlite_master` and checks
 * every table it *finds*, so a table added by a later migration is covered the day it
 * lands, without anybody editing a list here.
 */
const UNSCOPED = new Set(['orgs', 'schema_migrations', 'sqlite_sequence']);

interface ColumnInfo {
  name: string;
  notnull: number;
}
interface ForeignKey {
  table: string;
  from: string;
}
interface IndexEntry {
  name: string;
}
interface IndexColumn {
  seqno: number;
  name: string | null;
}

test('every business table is organisation-scoped by shape', () => {
  const db = makeDb();
  const tables = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);

  const business = tables.filter((name) => !UNSCOPED.has(name));
  // presence: if the walk ever stops finding tables, this suite must fail, not pass empty.
  assert.ok(
    business.length >= 10,
    `expected at least 10 business tables, found ${business.length}: ${business.join(', ')}`,
  );

  for (const table of business) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];
    const orgColumn = columns.find((column) => column.name === 'org_id');
    assert.ok(orgColumn, `${table}: no org_id column`);
    assert.equal(orgColumn.notnull, 1, `${table}: org_id must be NOT NULL`);

    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as unknown as ForeignKey[];
    assert.ok(
      foreignKeys.some((fk) => fk.table === 'orgs' && fk.from === 'org_id'),
      `${table}: org_id has no foreign key to orgs`,
    );

    const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as unknown as IndexEntry[];
    const leadsWithOrgId = indexes.some((index) => {
      const columnsOf = db
        .prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`)
        .all() as unknown as IndexColumn[];
      return columnsOf.some((column) => column.seqno === 0 && column.name === 'org_id');
    });
    assert.ok(leadsWithOrgId, `${table}: no index whose first column is org_id`);
  }
});

test('the tables the later splits depend on all exist', () => {
  const db = makeDb();
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name),
  );
  for (const name of [
    'orgs',
    'people',
    'person_roles',
    'cost_centres',
    'catalogue_items',
    'requisitions',
    'requisition_lines',
    'approval_rules',
    'audit_log',
    'idempotency_keys',
    'order_outbox',
  ]) {
    assert.ok(tables.has(name), `missing table: ${name}`);
  }
});

test('every table is STRICT', () => {
  const db = makeDb();
  const definitions = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string; sql: string }[];
  assert.ok(definitions.length >= 11, 'presence: there are table definitions to check');
  for (const definition of definitions) {
    assert.match(definition.sql, /\)\s*STRICT\s*$/i, `${definition.name} is not STRICT`);
  }
});
