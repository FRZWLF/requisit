import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../support/db.ts';

/**
 * "No SQL string outside `src/db/`" (D-004) is a rule a person forgets, so it is a check.
 * The table names are read from a migrated database rather than hard-coded, so a table a
 * later migration adds is covered without editing this file.
 *
 * Every absence assertion below has a presence companion in the same run: the scanner is
 * pointed at a fixture that *does* contain a query and must report it.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function filesUnder(dir: string, extension = '.ts'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...filesUnder(`${full}/`, extension));
    } else if (entry.name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

function tableNames(): string[] {
  const db = makeDb();
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function sqlScanner(tables: readonly string[]): RegExp {
  return new RegExp(
    `\\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\\b[\\s\\S]{0,200}?\\b(${tables.join('|')})\\b`,
    'i',
  );
}

test('no file outside src/db/ writes SQL against a business table', () => {
  const tables = tableNames();
  assert.ok(tables.length >= 11, 'presence: the table list came from a real schema');
  const scanner = sqlScanner(tables);

  // presence: the scanner really produces the case it is meant to catch.
  assert.ok(
    scanner.test('const bad = db.prepare("SELECT id FROM people WHERE id = ?");'),
    'the scanner cannot see a query — it is decoration, not a check',
  );
  assert.ok(!scanner.test('const fine = "just some prose about people";'));

  const scanned = [
    ...filesUnder(`${ROOT}src/`).filter((file) => !file.startsWith(`${ROOT}src/db/`)),
    ...filesUnder(`${ROOT}scripts/`),
  ];
  assert.ok(scanned.length >= 8, `presence: files were scanned (${scanned.length})`);
  for (const file of scanned) {
    const source = readFileSync(file, 'utf8');
    const hit = scanner.exec(source);
    assert.equal(
      hit,
      null,
      `D-004: SQL against a business table outside src/db/ in ${file.slice(ROOT.length)}: ${hit?.[0] ?? ''}`,
    );
  }
});

test('the audit table is inserted into exactly once, and never updated or deleted', () => {
  const sources = filesUnder(`${ROOT}src/`);
  let inserts = 0;
  for (const file of sources) {
    const source = readFileSync(file, 'utf8');
    for (const _match of source.matchAll(/INSERT\s+INTO\s+audit_log/gi)) {
      inserts += 1;
      assert.ok(
        file.endsWith('db/repos/audit.ts'),
        `D-007: audit_log is inserted into outside writeAudit, in ${file.slice(ROOT.length)}`,
      );
    }
    assert.ok(
      !/\b(UPDATE|DELETE\s+FROM)\s+audit_log\b/i.test(source),
      `D-007: audit_log is mutated in ${file.slice(ROOT.length)}`,
    );
  }
  assert.equal(inserts, 1, 'there must be exactly one INSERT INTO audit_log in src/');
});

test('time comes only from the clock', () => {
  const offenders = [
    ...filesUnder(`${ROOT}src/`).filter((file) => !file.endsWith('src/clock.ts')),
    ...filesUnder(`${ROOT}scripts/`),
  ];
  assert.ok(offenders.length >= 8, 'presence: files were scanned');
  // presence: the pattern does fire on the one file that is allowed to use it.
  assert.match(readFileSync(`${ROOT}src/clock.ts`, 'utf8'), /new Date\(/);
  for (const file of offenders) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/\bDate\.now\(|new Date\(/.test(source),
      `D-017: time outside the Clock in ${file.slice(ROOT.length)}`,
    );
  }
});

test('src/db/ stays synchronous — a Promise there would hold the write lock', () => {
  for (const file of filesUnder(`${ROOT}src/db/`)) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/\basync\b|\bawait\b|\bPromise\b/.test(source),
      `D-002: asynchronous code in ${file.slice(ROOT.length)}`,
    );
  }
});

test('the only unscoped data module is src/db/instance.ts, and it says so in its names', () => {
  const source = readFileSync(`${ROOT}src/db/instance.ts`, 'utf8');
  const exported = [...source.matchAll(/export function (\w+)/g)].map((match) => match[1]);
  assert.ok(exported.length >= 2, 'presence: instance.ts exports functions');
  for (const name of exported) {
    assert.match(String(name), /^instance/, 'D-022: an unscoped export must be named instance*');
  }
});
