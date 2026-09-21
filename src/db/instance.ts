import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../clock.ts';
import { newId } from '../ids.ts';
import { refuse, type Result } from '../refusal.ts';
import type { Org } from '../domain/types.ts';
import { isKnownCurrency } from '../domain/money.ts';
import type { Tx } from './tx.ts';

/**
 * The *only* module that touches data without an `OrgScope` — an organisation cannot be
 * created from inside itself (D-004, D-022). Every export is prefixed `instance` so a
 * reviewer greps one word to find every cross-organisation call site. Used by the
 * mint-token CLI, by scope resolution and by tests; nothing in the request path calls it.
 */

interface OrgRow {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly requisition_seq: number;
  readonly created_at: string;
}

function toOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    requisitionSeq: row.requisition_seq,
    createdAt: row.created_at,
  };
}

export function instanceCreateOrg(
  tx: Tx,
  input: { name: string; currency: string },
  clock: Clock = systemClock,
): Result<Org> {
  if (input.name.trim() === '') {
    return refuse('validation_failed', 'org name must not be empty');
  }
  if (!isKnownCurrency(input.currency)) {
    return refuse('validation_failed', `unknown currency: ${input.currency}`);
  }
  const org: Org = {
    id: newId(),
    name: input.name,
    currency: input.currency,
    requisitionSeq: 0,
    createdAt: toIso(clock.now()),
  };
  tx.db
    .prepare(
      'INSERT INTO orgs (id, name, currency, requisition_seq, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(org.id, org.name, org.currency, org.requisitionSeq, org.createdAt);
  return org;
}

export function instanceFindOrg(db: DatabaseSync, id: string): Result<Org> {
  const row = db
    .prepare('SELECT id, name, currency, requisition_seq, created_at FROM orgs WHERE id = ?')
    .get(id) as OrgRow | undefined;
  return row === undefined ? refuse('not_found', 'org') : toOrg(row);
}

/**
 * An organisation by name, across the instance — the seed script's idempotency check
 * (D-018): a second run must find the organisation it created rather than make another.
 * Names are not unique by constraint, so this returns the *first* match by creation order
 * and is a development convenience, never a request path. Deliberately **not** re-exported
 * from `src/index.ts` (#5 security review): the package surface is what a handler can reach,
 * and the only caller is `scripts/seed.ts`, which imports this module directly.
 */
export function instanceFindOrgByNameUnscoped(db: DatabaseSync, name: string): Result<Org> {
  const row = db
    .prepare(
      'SELECT id, name, currency, requisition_seq, created_at FROM orgs WHERE name = ? ORDER BY created_at, id LIMIT 1',
    )
    .get(name) as OrgRow | undefined;
  return row === undefined ? refuse('not_found', 'org') : toOrg(row);
}

/**
 * The 24 h sweep of the idempotency ledger (D-010). Cross-organisation by design — it is
 * housekeeping, not a request — so it lives here and says so in its name (D-022). Never
 * called inside a request; `main.ts` runs it at startup and daily.
 */
export function instanceSweepIdempotencyKeys(tx: Tx, olderThan: string): number {
  const changed = tx.db
    .prepare('DELETE FROM idempotency_keys WHERE created_at < ?')
    .run(olderThan);
  return Number(changed.changes);
}
