import { isRefusal, refuse, type Refusal, type Result } from '../refusal.ts';
import { hasRole } from '../db/scope.ts';
import type { Tx } from '../db/tx.ts';
import { auditRepo } from '../db/repos/audit.ts';
import { requisitionsRepo } from '../db/repos/requisitions.ts';
import {
  outboxRepo,
  DEFAULT_POLL_LIMIT,
  MAX_POLL_LIMIT,
  type OutboxRow,
} from '../db/repos/outbox.ts';
import { lineTotal, sumMoney, type Money } from '../domain/money.ts';
import { decide } from '../domain/lifecycle.ts';
import type { RequisitionWithLines } from '../domain/types.ts';
import type { ServiceContext } from './requisitions.ts';

/**
 * The merchant side of the order handoff (D-011): a cursor poll and an acknowledgement.
 * There is no webhook, no retry engine and no queue — G-006 holds the trigger for the first
 * consumer that cannot poll.
 *
 * Both endpoints require the `merchant` role (D-006 addendum, migration `0003`). The role is
 * read from the database per request like every other authority (D-005, D-006), and the
 * organisation comes from the scope, so a merchant token of organisation B reads and stamps
 * nothing of organisation A (D-004) — the leak suite asserts exactly that.
 *
 * Delivery is at-least-once and the merchant deduplicates on `id`: an acknowledged row is
 * stamped, never deleted, so re-polling from an older cursor returns the same rows with the
 * same payload bytes.
 */

export { DEFAULT_POLL_LIMIT, MAX_POLL_LIMIT };

export interface PollInput {
  readonly after?: number;
  readonly limit?: number;
}

export interface OutboxItemView {
  readonly id: number;
  readonly requisitionId: string;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly ackBy: string | null;
  readonly payload: unknown;
}

export interface OutboxFeed {
  readonly items: readonly OutboxItemView[];
  /** The cursor to pass as `after` next time: the last item's id, or the one asked for. */
  readonly nextAfter: number;
  /** The highest id this organisation has acknowledged so far; `0` before the first ack. */
  readonly cursor: number;
}

export interface AckInput {
  readonly throughId: number;
}

export interface AckResult {
  readonly throughId: number;
  readonly cursor: number;
  /** Every requisition this acknowledgement covers, in feed order — not only the ones it moved. */
  readonly ordered: readonly string[];
}

function merchantGuard(ctx: ServiceContext, what: string): Refusal | null {
  if (hasRole(ctx.scope, 'merchant')) {
    return null;
  }
  return refuse('not_authorised', `the merchant role is required to ${what} the order outbox`);
}

/**
 * The stored payload, handed back as JSON rather than as a string. The bytes were written by
 * `orderPayload` inside a transaction of this service, so a parse failure is a corrupt row,
 * not hostile input — it throws and the request answers 500 rather than serving half a feed.
 */
function payloadOf(row: OutboxRow): unknown {
  return JSON.parse(row.payloadJson) as unknown;
}

function toItem(row: OutboxRow): OutboxItemView {
  return {
    id: row.id,
    requisitionId: row.requisitionId,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    ackBy: row.ackBy,
    payload: payloadOf(row),
  };
}

function cursorParam(value: number | undefined, name: string): Result<number> {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return refuse('validation_failed', `${name} must be a non-negative safe integer`);
  }
  return value;
}

export function poll(ctx: ServiceContext, input: PollInput): Result<OutboxFeed> {
  const denied = merchantGuard(ctx, 'poll');
  if (denied !== null) {
    return denied;
  }
  const after = cursorParam(input.after, 'after');
  if (isRefusal(after)) {
    return after;
  }
  const limit = input.limit ?? DEFAULT_POLL_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    return refuse('validation_failed', 'limit must be a positive safe integer');
  }
  // Capped rather than refused: a merchant asking for more than the ceiling gets the
  // ceiling, and keeps polling — an error would make a bigger `limit` a broken client.
  const repo = outboxRepo(ctx.db, ctx.scope, ctx.clock);
  const items = repo.listAfter(after, Math.min(limit, MAX_POLL_LIMIT)).map(toItem);
  const last = items.at(-1);
  return {
    items,
    nextAfter: last === undefined ? after : last.id,
    cursor: repo.cursor(),
  };
}

function totalOf(requisition: RequisitionWithLines): Result<Money> {
  const parts: Money[] = [];
  for (const line of requisition.lines) {
    const amount = lineTotal(line.unitPriceMinor, line.quantity, line.currency);
    if (isRefusal(amount)) {
      return amount;
    }
    parts.push(amount);
  }
  return sumMoney(requisition.currency, parts);
}

/**
 * The only path into `ordered` (D-009). It moves every requisition the acknowledgement
 * covers that is not already there, stamps its outbox row with `delivered_at`/`ack_by`, and
 * writes one audit line each (D-007) — all in the caller's transaction.
 *
 * Idempotent in both directions (D-010): a `through_id` at or below the cursor stamps
 * nothing, a repeat of the same `through_id` finds every row already delivered, and the
 * answer is the same either way because it is computed from the rows the cursor covers
 * rather than from the work this call happened to do.
 */
export function acknowledge(
  ctx: ServiceContext,
  tx: Tx,
  input: AckInput,
): Result<AckResult> {
  const denied = merchantGuard(ctx, 'acknowledge');
  if (denied !== null) {
    return denied;
  }
  const throughId = cursorParam(input.throughId, 'through_id');
  if (isRefusal(throughId)) {
    return throughId;
  }
  const repo = outboxRepo(ctx.db, ctx.scope, ctx.clock);
  if (throughId > repo.maxId()) {
    // A cursor this caller cannot have received. Refusing is the honest answer: silently
    // accepting it would let a merchant skip rows that have not been emitted yet.
    return refuse('validation_failed', 'through_id is beyond the end of this feed');
  }

  const requisitions = requisitionsRepo(ctx.db, ctx.scope, ctx.clock);
  const audit = auditRepo(ctx.db, ctx.scope, ctx.clock);
  const covered = repo.listThrough(throughId);
  for (const row of covered) {
    if (row.deliveredAt !== null) {
      continue;
    }
    const requisition = requisitions.byId(row.requisitionId);
    if (isRefusal(requisition)) {
      throw new Error(`outbox row ${String(row.id)} points at no requisition of this organisation`);
    }
    // `approved → ordered`, by `system`, is the only edge into `ordered` (D-009). A row that
    // refuses here means an outbox row exists for something that was never approved — an
    // invariant, so it throws and the whole acknowledgement rolls back.
    const moved = decide(requisition.state, 'order', 'system', { requisitionId: requisition.id });
    if (isRefusal(moved)) {
      throw new Error(
        `outbox row ${String(row.id)}: ${requisition.state} cannot be ordered (${moved.code})`,
      );
    }
    const total = totalOf(requisition);
    if (isRefusal(total)) {
      throw new Error(`outbox row ${String(row.id)}: the requisition's lines cannot be totalled`);
    }
    requisitions.transition(tx, {
      id: requisition.id,
      expectedVersion: requisition.version,
      toState: moved,
      ruleId: requisition.ruleId,
      ruleCode: requisition.ruleCode,
      submittedAt: requisition.submittedAt,
      decidedAt: requisition.decidedAt,
    });
    const line = audit.writeAudit(tx, {
      requisitionId: requisition.id,
      actorPersonId: ctx.scope.actor.personId,
      actorKind: ctx.scope.actor.kind,
      action: 'order',
      fromState: requisition.state,
      toState: moved,
      ruleId: requisition.ruleId,
      totalMinor: total.amountMinor,
      currency: total.currency,
      reason: null,
      requestId: ctx.requestId,
    });
    if (isRefusal(line)) {
      // The state change is already in this transaction; committing it without its line is
      // the one thing D-007 forbids, so this throws and everything rolls back.
      throw new Error(`audit line refused for outbox row ${String(row.id)}: ${line.code}`);
    }
    if (!repo.markDelivered(tx, row.id, ctx.scope.actor.personId)) {
      throw new Error(`outbox row ${String(row.id)} was already delivered inside this transaction`);
    }
  }

  return {
    throughId,
    cursor: repo.cursor(),
    ordered: covered.map((row) => row.requisitionId),
  };
}
