import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { main, ORGANISATIONS } from '../../scripts/seed.ts';
import { TEST_CLOCK } from '../support/seed.ts';

/**
 * `seed/idempotent` (D-018). The seed runs against a temp-file database — the one place the
 * suite needs a real file, because "works offline against a fresh database file" is the
 * claim — and the directory is removed afterwards. Nothing here reaches the network.
 */

const SECRET = 'a-test-secret-that-is-long-enough-32';

interface Sandbox {
  readonly dir: string;
  readonly dbPath: string;
  readonly env: NodeJS.ProcessEnv;
}

function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'requisit-seed-'));
  const dbPath = join(dir, 'requisit.db');
  return {
    dir,
    dbPath,
    env: { REQUISIT_TOKEN_SECRET: SECRET, REQUISIT_DB_PATH: dbPath, REQUISIT_LOG_LEVEL: 'error' },
  };
}

function countOf(dbPath: string, sql: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    return Number((db.prepare(sql).get() as { n: number }).n);
  } finally {
    db.close();
  }
}

test('the seed builds the demo from a fresh file, offline', (t) => {
  const box = sandbox();
  t.after(() => {
    rmSync(box.dir, { recursive: true, force: true });
  });

  const first = main([], box.env, TEST_CLOCK);
  assert.equal(first.code, 0, first.err);
  assert.equal(first.err, '');
  for (const spec of ORGANISATIONS) {
    assert.ok(first.out.includes(spec.name), `${spec.name} is missing from the output`);
    assert.ok(first.out.includes(spec.currency));
  }
  // One EUR organisation and one JPY organisation: the exponent-0 case exists in the demo.
  assert.ok(first.out.includes('EUR') && first.out.includes('JPY'));
  // Every seeded person's token is printed, once.
  const tokens = first.out.match(/\bv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
  const expected = ORGANISATIONS.reduce((sum, spec) => sum + spec.people.length, 0);
  assert.equal(tokens.length, expected);
  assert.equal(new Set(tokens).size, expected, 'two people were handed the same token');

  assert.equal(countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM orgs'), ORGANISATIONS.length);
  assert.equal(countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM people'), expected);
  assert.equal(
    countOf(box.dbPath, "SELECT COUNT(*) AS n FROM person_roles WHERE role = 'merchant'"),
    ORGANISATIONS.length,
  );
  assert.equal(
    countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM approval_rules'),
    ORGANISATIONS.length * 3,
  );
  // The terminal unbounded row D-008 requires, one per organisation.
  assert.equal(
    countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM approval_rules WHERE max_total_minor IS NULL'),
    ORGANISATIONS.length,
  );
  assert.equal(countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM cost_centres'), ORGANISATIONS.length);
  assert.ok(countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM catalogue_items') >= 6);
});

test('a second run adds nothing and says so', (t) => {
  const box = sandbox();
  t.after(() => {
    rmSync(box.dir, { recursive: true, force: true });
  });

  const first = main([], box.env, TEST_CLOCK);
  assert.equal(first.code, 0, first.err);
  assert.ok(first.out.includes('seeded'), 'presence: the first run reports that it seeded');

  const second = main([], box.env, TEST_CLOCK);
  assert.equal(second.code, 0, second.err);
  assert.ok(second.out.includes('already present'));
  assert.ok(!second.out.includes('· seeded'), 'the second run seeded again');

  assert.equal(countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM orgs'), ORGANISATIONS.length);
  assert.equal(
    countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM people'),
    ORGANISATIONS.reduce((sum, spec) => sum + spec.people.length, 0),
  );
  assert.equal(
    countOf(box.dbPath, 'SELECT COUNT(*) AS n FROM approval_rules'),
    ORGANISATIONS.length * 3,
  );
  // The same people, so the same tokens — a re-run hands the demo its credentials back.
  assert.deepEqual(second.out.match(/\bv1\./g), first.out.match(/\bv1\./g));
});

test('the seed writes no file but the database, and never a token file (D-018)', (t) => {
  const box = sandbox();
  t.after(() => {
    rmSync(box.dir, { recursive: true, force: true });
  });
  main([], box.env, TEST_CLOCK);

  const written = readdirSync(box.dir).sort();
  assert.ok(written.length > 0, 'presence: the run wrote the database');
  for (const name of written) {
    assert.ok(
      name.startsWith('requisit.db'),
      `the seed wrote ${name} next to the database — tokens belong on stdout only`,
    );
  }
});

test('a bad configuration stops the seed without a database, and never echoes the secret', (t) => {
  const box = sandbox();
  t.after(() => {
    rmSync(box.dir, { recursive: true, force: true });
  });

  const short = main([], { ...box.env, REQUISIT_TOKEN_SECRET: 'too-short' }, TEST_CLOCK);
  assert.equal(short.code, 1);
  assert.equal(short.out, '');
  assert.match(short.err, /REQUISIT_TOKEN_SECRET/);
  assert.ok(!short.err.includes('too-short'), 'the value reached the output');
  assert.deepEqual(readdirSync(box.dir), []);

  const misused = main(['--org', 'x'], box.env, TEST_CLOCK);
  assert.equal(misused.code, 1);
  assert.match(misused.err, /unexpected argument/);
});
