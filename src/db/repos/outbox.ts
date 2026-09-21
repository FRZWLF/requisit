import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import { refuse, type Result } from '../../refusal.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { rows } from '../row.ts';
import { sameDb } from './guard.ts';

/**
 * The order outbox (D-011). One row per approval, written **inside the approving
 * transaction** — that is the whole point of the pattern: an order that exists without its
 * approval, or an approval whose order was lost, are both impossible because there is one
 * commit.
 *
 * `id` is the monotonic `INTEGER` cursor (D-017): the feed is read in `id` order and is
 * replayable from any cursor, which is what makes delivery at-least-once with the merchant
 * deduplicating on `id`. Acknowledged rows are **stamped, never deleted** — a deleted row
 * would make an older cursor return a different feed than it did the first time.
 *
 * Every statement binds `scope.orgId` first (D-004, D-022): a merchant token of one
 * organisation cannot read or stamp another's rows, and `append` additionally verifies the
 * requisition belongs to this organisation, because `order_outbox`'s foreign key is by id
 * alone (the same hole `writeAudit` closes for `audit_log`).
 */

export interface OutboxRow {
  readonly id: number;
  readonly orgId: string;
  readonly requisitionId: string;
  readonly payloadJson: string;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly ackBy: string | null;
}

interface OutboxDbRow {
  readonly id: number;
  readonly org_id: string;
  readonly requisition_id: string;
  readonly payload_json: string;
  readonly created_at: string;
  readonly delivered_at: string | null;
  readonly ack_by: string | null;
}

function toRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    orgId: row.org_id,
    requisitionId: row.requisition_id,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    ackBy: row.ack_by,
  };
}

const COLUMNS = 'id, org_id, requisition_id, payload_json, created_at, delivered_at, ack_by';

/** The hard ceiling on one drain, whatever `limit` the caller asks for (D-023). */
export const MAX_POLL_LIMIT = 500;
export const DEFAULT_POLL_LIMIT = 100;

export function outboxRepo(db: DatabaseSync, scope: OrgScope, clock: Clock = systemClock) {
  const insertRow = db.prepare(
    `INSERT INTO order_outbox (org_id, requisition_id, payload_json, created_at, delivered_at, ack_by)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  );
  const selectAfter = db.prepare(
    `SELECT ${COLUMNS} FROM order_outbox WHERE org_id = ? AND id > ? ORDER BY id LIMIT ?`,
  );
  const selectThrough = db.prepare(
    `SELECT ${COLUMNS} FROM order_outbox WHERE org_id = ? AND id <= ? ORDER BY id`,
  );
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM order_outbox WHERE org_id = ? AND id = ?`);
  const selectMaxId = db.prepare('SELECT MAX(id) AS value FROM order_outbox WHERE org_id = ?');
  const selectCursor = db.prepare(
    'SELECT MAX(id) AS value FROM order_outbox WHERE org_id = ? AND delivered_at IS NOT NULL',
  );
  const selectRequisition = db.prepare('SELECT id FROM requisitions WHERE org_id = ? AND id = ?');
  // Only an undelivered row is stamped: the cursor moves forward and a replayed
  // acknowledgement never rewrites `delivered_at`/`ack_by` (D-010, D-011).
  const stampDelivered = db.prepare(
    `UPDATE order_outbox SET delivered_at = ?, ack_by = ?
      WHERE org_id = ? AND id = ? AND delivered_at IS NULL`,
  );

  function maxOf(statement: typeof selectMaxId): number {
    const row = statement.get(scope.orgId) as { value: number | null } | undefined;
    return row?.value ?? 0;
  }

  return {
    /**
     * The row the approving transaction writes. It refuses a requisition of another
     * organisation rather than trusting the id, and returns the row including the `id` the
     * merchant will use as its cursor.
     */
    append(
      tx: Tx,
      input: { readonly requisitionId: string; readonly payloadJson: string },
    ): Result<OutboxRow> {
      sameDb(db, tx);
      if (selectRequisition.get(scope.orgId, input.requisitionId) === undefined) {
        return refuse('not_found', 'requisition');
      }
      const createdAt = toIso(clock.now());
      const written = insertRow.run(
        scope.orgId,
        input.requisitionId,
        input.payloadJson,
        createdAt,
      );
      return {
        id: Number(written.lastInsertRowid),
        orgId: scope.orgId,
        requisitionId: input.requisitionId,
        payloadJson: input.payloadJson,
        createdAt,
        deliveredAt: null,
        ackBy: null,
      };
    },

    /** The feed from a cursor, in `id` order. `after = 0` is the whole feed. */
    listAfter(after: number, limit: number): OutboxRow[] {
      const capped = Math.min(Math.max(limit, 1), MAX_POLL_LIMIT);
      return rows<OutboxDbRow>(selectAfter.all(scope.orgId, after, capped)).map(toRow);
    },

    /** Every row up to and including `throughId` — what one acknowledgement covers. */
    listThrough(throughId: number): OutboxRow[] {
      return rows<OutboxDbRow>(selectThrough.all(scope.orgId, throughId)).map(toRow);
    },

    byId(id: number): Result<OutboxRow> {
      const row = selectById.get(scope.orgId, id) as OutboxDbRow | undefined;
      return row === undefined ? refuse('not_found', 'outbox row') : toRow(row);
    },

    /** The highest id this organisation has ever emitted; `0` when the feed is empty. */
    maxId(): number {
      return maxOf(selectMaxId);
    },

    /** The acknowledgement cursor: the highest delivered id; `0` before the first ack. */
    cursor(): number {
      return maxOf(selectCursor);
    },

    /** Stamps one undelivered row. `false` means it was already delivered — a no-op. */
    markDelivered(tx: Tx, id: number, ackBy: string | null): boolean {
      sameDb(db, tx);
      const changed = stampDelivered.run(toIso(clock.now()), ackBy, scope.orgId, id);
      return changed.changes === 1;
    },
  };
}

export type OutboxRepo = ReturnType<typeof outboxRepo>;
