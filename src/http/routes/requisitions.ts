import { isId } from '../../ids.ts';
import { isRefusal, refuse, type Result } from '../../refusal.ts';
import { REQUISITION_STATES, type RequisitionState } from '../../domain/types.ts';
import type { DraftLineInput } from '../../db/repos/requisitions.ts';
import {
  approve,
  cancel,
  copyForward,
  createDraft,
  detail,
  list,
  reject,
  submit,
  updateDraft,
  type ListInput,
  type ServiceContext,
} from '../../app/requisitions.ts';
import type { HandlerOutcome, RequestContext, Route } from '../types.ts';

/**
 * The requisition routes (D-023). Each one validates the shape it needs, hands the typed
 * input to the use case in `src/app/`, and returns whatever that returns — authority, the
 * state machine and the audit line all live behind the service seam, never here.
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

function idParam(ctx: RequestContext): string {
  // The router has already refused a non-UUID `:id`, so this cannot be anything else.
  return ctx.params['id'] as string;
}

function optionalVersion(body: Readonly<Record<string, unknown>>): Result<number | undefined> {
  const raw = body['version'];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Number.isSafeInteger(raw) || (raw as number) < 1) {
    return refuse('validation_failed', 'version must be a positive safe integer');
  }
  return raw as number;
}

function optionalReason(body: Readonly<Record<string, unknown>>): Result<string | undefined> {
  const raw = body['reason'];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return refuse('validation_failed', 'reason must be a string');
  }
  return raw;
}

function costCentreField(
  body: Readonly<Record<string, unknown>>,
  required: boolean,
): Result<string | undefined> {
  const raw = body['costCentreId'];
  if (raw === undefined || raw === null) {
    return required ? refuse('validation_failed', 'costCentreId is required') : undefined;
  }
  if (!isId(raw)) {
    return refuse('validation_failed', 'costCentreId must be an id');
  }
  return raw;
}

function lineFields(raw: unknown): Result<DraftLineInput[]> {
  if (!Array.isArray(raw)) {
    return refuse('validation_failed', 'lines must be an array');
  }
  const lines: DraftLineInput[] = [];
  let seq = 0;
  for (const entry of raw) {
    seq += 1;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return refuse('validation_failed', `line ${String(seq)}: must be an object`);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row['description'] !== 'string') {
      return refuse('validation_failed', `line ${String(seq)}: description must be a string`);
    }
    if (!Number.isSafeInteger(row['quantity'])) {
      return refuse('validation_failed', `line ${String(seq)}: quantity must be a safe integer`);
    }
    if (!Number.isSafeInteger(row['unitPriceMinor'])) {
      return refuse(
        'validation_failed',
        `line ${String(seq)}: unitPriceMinor must be a safe integer`,
      );
    }
    const catalogueItemId = row['catalogueItemId'];
    if (catalogueItemId !== undefined && catalogueItemId !== null && !isId(catalogueItemId)) {
      return refuse('validation_failed', `line ${String(seq)}: catalogueItemId must be an id`);
    }
    lines.push({
      description: row['description'],
      quantity: row['quantity'] as number,
      unitPriceMinor: row['unitPriceMinor'] as number,
      catalogueItemId: catalogueItemId === undefined ? null : (catalogueItemId as string | null),
    });
  }
  return lines;
}

function flagParam(query: URLSearchParams, name: string): Result<boolean | undefined> {
  const raw = query.get(name);
  if (raw === null) {
    return undefined;
  }
  if (raw !== '1' && raw !== 'true') {
    return refuse('validation_failed', `${name} must be 1 or true`);
  }
  return true;
}

function stateParam(query: URLSearchParams): Result<RequisitionState | undefined> {
  const raw = query.get('state');
  if (raw === null) {
    return undefined;
  }
  const hit = REQUISITION_STATES.find((state) => state === raw);
  if (hit === undefined) {
    return refuse('validation_failed', 'state is not a requisition state');
  }
  return hit;
}

export const REQUISITION_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/v1/requisitions',
    mutating: true,
    audience: 'member',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const costCentreId = costCentreField(ctx.body, true);
      if (isRefusal(costCentreId)) {
        return costCentreId;
      }
      const lines = lineFields(ctx.body['lines']);
      if (isRefusal(lines)) {
        return lines;
      }
      const made = createDraft(serviceContext(ctx), requireTx(tx), {
        costCentreId: costCentreId as string,
        lines,
      });
      return isRefusal(made) ? made : { status: 201, body: made };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/requisitions/:id',
    mutating: true,
    audience: 'member',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const costCentreId = costCentreField(ctx.body, false);
      if (isRefusal(costCentreId)) {
        return costCentreId;
      }
      const version = optionalVersion(ctx.body);
      if (isRefusal(version)) {
        return version;
      }
      const rawLines = ctx.body['lines'];
      const lines = rawLines === undefined ? undefined : lineFields(rawLines);
      if (lines !== undefined && isRefusal(lines)) {
        return lines;
      }
      const changed = updateDraft(serviceContext(ctx), requireTx(tx), idParam(ctx), {
        ...(costCentreId === undefined ? {} : { costCentreId }),
        ...(lines === undefined || isRefusal(lines) ? {} : { lines }),
        ...(version === undefined ? {} : { version }),
      });
      return isRefusal(changed) ? changed : { status: 200, body: changed };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/requisitions',
    mutating: false,
    audience: 'member',
    handler: (ctx): Result<HandlerOutcome> => {
      const state = stateParam(ctx.query);
      if (isRefusal(state)) {
        return state;
      }
      const mine = flagParam(ctx.query, 'mine');
      if (isRefusal(mine)) {
        return mine;
      }
      const awaitingMe = flagParam(ctx.query, 'awaiting_me');
      if (isRefusal(awaitingMe)) {
        return awaitingMe;
      }
      const input: ListInput = {
        ...(state === undefined ? {} : { state }),
        ...(mine === undefined ? {} : { mine }),
        ...(awaitingMe === undefined ? {} : { awaitingMe }),
      };
      const found = list(serviceContext(ctx), input);
      return isRefusal(found) ? found : { status: 200, body: found };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/requisitions/:id',
    mutating: false,
    audience: 'member',
    handler: (ctx): Result<HandlerOutcome> => {
      const found = detail(serviceContext(ctx), idParam(ctx));
      return isRefusal(found) ? found : { status: 200, body: found };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/requisitions/:id/submit',
    mutating: true,
    audience: 'member',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const version = optionalVersion(ctx.body);
      if (isRefusal(version)) {
        return version;
      }
      const moved = submit(serviceContext(ctx), requireTx(tx), idParam(ctx), {
        ...(version === undefined ? {} : { version }),
      });
      return isRefusal(moved) ? moved : { status: 200, body: moved };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/requisitions/:id/approve',
    mutating: true,
    audience: 'member',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const version = optionalVersion(ctx.body);
      if (isRefusal(version)) {
        return version;
      }
      const moved = approve(serviceContext(ctx), requireTx(tx), idParam(ctx), {
        ...(version === undefined ? {} : { version }),
      });
      return isRefusal(moved) ? moved : { status: 200, body: moved };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/requisitions/:id/reject',
    mutating: true,
    audience: 'member',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const version = optionalVersion(ctx.body);
      if (isRefusal(version)) {
        return version;
      }
      const reason = optionalReason(ctx.body);
      if (isRefusal(reason)) {
        return reason;
      }
      const moved = reject(serviceContext(ctx), requireTx(tx), idParam(ctx), {
        ...(version === undefined ? {} : { version }),
        ...(reason === undefined ? {} : { reason }),
      });
      return isRefusal(moved) ? moved : { status: 200, body: moved };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/requisitions/:id/cancel',
    mutating: true,
    audience: 'member',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const version = optionalVersion(ctx.body);
      if (isRefusal(version)) {
        return version;
      }
      const reason = optionalReason(ctx.body);
      if (isRefusal(reason)) {
        return reason;
      }
      const moved = cancel(serviceContext(ctx), requireTx(tx), idParam(ctx), {
        ...(version === undefined ? {} : { version }),
        ...(reason === undefined ? {} : { reason }),
      });
      return isRefusal(moved) ? moved : { status: 200, body: moved };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/requisitions/:id/copy',
    mutating: true,
    audience: 'member',
    handler: (ctx, tx): Result<HandlerOutcome> => {
      const made = copyForward(serviceContext(ctx), requireTx(tx), idParam(ctx));
      return isRefusal(made) ? made : { status: 201, body: made };
    },
  },
];
