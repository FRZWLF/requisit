import type { Result } from '../../refusal.ts';
import { ruleTable } from '../../app/requisitions.ts';
import type { HandlerOutcome, Route } from '../types.ts';

/** The organisation's rule table, read-only in v1 — rows are seeded, never edited (D-008). */
export const RULE_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/v1/rules',
    mutating: false,
    handler: (ctx): Result<HandlerOutcome> => ({
      status: 200,
      body: ruleTable({
        db: ctx.db,
        scope: ctx.scope,
        clock: ctx.clock,
        requestId: ctx.requestId,
      }),
    }),
  },
];
