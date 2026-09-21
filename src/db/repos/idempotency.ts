import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { sameDb } from './guard.ts';

/**
 * The idempotency ledger (D-010). One row per `(org_id, actor_person_id, endpoint, key)`; the stored
 * `status` and `body` are the exact bytes the first call answered with, and the row is
 * written inside the same transaction as the state change it belongs to, so a crash can
 * never leave a key claiming a change that did not commit.
 *
 * Keys are scoped by organisation **and by the acting person**: one tenant cannot collide
 * with — or probe for — another tenant's keys (D-004), and inside an organisation one member
 * can neither replay another member's stored answer nor pre-claim their key with a refusal
 * (D-010 addendum, #3 review). A person-less actor — a system task — uses the empty actor.
 */

export interface IdempotencyRecord {
  readonly actorPersonId: string;
  readonly endpoint: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly status: number;
  readonly body: string;
  readonly createdAt: string;
}

interface IdempotencyRow {
  readonly actor_person_id: string;
  readonly endpoint: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly status: number;
  readonly body: string;
  readonly created_at: string;
}

export interface IdempotencyInput {
  readonly endpoint: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly status: number;
  readonly body: string;
}

export function idempotencyKeysRepo(
  db: DatabaseSync,
  scope: OrgScope,
  clock: Clock = systemClock,
) {
  // The empty string, not NULL: a NULL in a SQLite primary key does not collide with itself,
  // so a person-less actor would get a fresh row on every retry instead of a replay.
  const actorPersonId = scope.actor.personId ?? '';
  const selectOne = db.prepare(
    `SELECT actor_person_id, endpoint, key, fingerprint, status, body, created_at
       FROM idempotency_keys
      WHERE org_id = ? AND actor_person_id = ? AND endpoint = ? AND key = ?`,
  );
  const insertRow = db.prepare(
    `INSERT INTO idempotency_keys
       (org_id, actor_person_id, endpoint, key, fingerprint, status, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    find(endpoint: string, key: string): IdempotencyRecord | undefined {
      const row = selectOne.get(scope.orgId, actorPersonId, endpoint, key) as
        | IdempotencyRow
        | undefined;
      if (row === undefined) {
        return undefined;
      }
      return {
        actorPersonId: row.actor_person_id,
        endpoint: row.endpoint,
        key: row.key,
        fingerprint: row.fingerprint,
        status: row.status,
        body: row.body,
        createdAt: row.created_at,
      };
    },

    /** The last statement of a mutating transaction, by contract (D-010 addendum). */
    insert(tx: Tx, input: IdempotencyInput): IdempotencyRecord {
      sameDb(db, tx);
      const createdAt = toIso(clock.now());
      insertRow.run(
        scope.orgId,
        actorPersonId,
        input.endpoint,
        input.key,
        input.fingerprint,
        input.status,
        input.body,
        createdAt,
      );
      return { ...input, actorPersonId, createdAt };
    },
  };
}

export type IdempotencyKeysRepo = ReturnType<typeof idempotencyKeysRepo>;
