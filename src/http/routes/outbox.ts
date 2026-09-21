import { isRefusal, refuse, type Result } from '../../refusal.ts';
import { acknowledge, poll, type PollInput } from '../../app/outbox.ts';
import type { ServiceContext } from '../../app/requisitions.ts';
import type { HandlerOutcome, RequestContext, Route } from '../types.ts';

/**
 * The merchant's two routes (D-011). `GET /outbox` is a read, so it takes no idempotency
 * key; `POST /outbox/ack` is mutating, so the pipeline gives it one transaction and one key
 * like every other write (D-010, D-023). Authority — the `merchant` role — is checked behind
 * the service seam, never here.
 */

function serviceContext(ctx: RequestContext): ServiceContext {
  return { db: ctx.db, scope: ctx.scope, clock: ctx.clock, requestId: ctx.requestId };
}

function requireTx<T>(tx: T | null): T {
  if (tx === null) {
    throw new Error('a mutating route was dispatched without a transaction');
  }
  return tx;
}

/** A query parameter that must be a decimal integer — `Number` would take ' 1', '0x2', '1e3'. */
function integerParam(query: URLSearchParams, name: string): Result<number | undefined> {
  const raw = query.get(name);
  if (raw === null) {
    return undefined;
  }
  if (!/^[0-9]+$/.test(raw)) {
    return refuse('validation_failed', `${name} must be a non-negative decimal integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    return refuse('validation_failed', `${name} must be a non-negative safe integer`);
  }
  return value;
}

export const OUTBOX_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/v1/outbox',
    mutating: false,
    audience: 'merchant',
    handler: (ctx): Result<HandlerOutcome> => {
      const after = integerParam(ctx.query, 'after');
      if (isRefusal(after)) {
        return after;
      }
      const limit = integerParam(ctx.query, 'limit');
      if (isRefusal(limit)) {
        return limit;
      }
      const input: PollInput = {
        ...(after === undefined ? {} : { after }),
        ...(limit === undefined ? {} : { limit }),
      };
      const feed = poll(serviceContext(ctx), input);
      return isRefusal(feed) ? feed : { status: 200, body: feed };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/outbox/ack',
    mutating: true,
    audience: 'merchant',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const raw = ctx.body['through_id'];
      if (!Number.isSafeInteger(raw) || (raw as number) < 0) {
        return refuse('validation_failed', 'through_id must be a non-negative safe integer');
      }
      const acked = acknowledge(serviceContext(ctx), requireTx(tx), {
        throughId: raw as number,
      });
      return isRefusal(acked) ? acked : { status: 200, body: acked };
    },
  },
];
