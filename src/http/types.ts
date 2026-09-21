import type { Buffer } from 'node:buffer';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../clock.ts';
import type { OrgScope } from '../db/scope.ts';
import type { Tx } from '../db/tx.ts';
import type { Result } from '../refusal.ts';

/**
 * The transport-independent request and response (D-023). `dispatch` speaks these, and the
 * `node:http` adapter is the only thing that knows about sockets — which is what makes every
 * route testable in-process without a listening port (D-014).
 */

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  /** Lower-cased header names, as `node:http` already delivers them. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface RequestContext {
  readonly scope: OrgScope;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: Readonly<Record<string, unknown>>;
  readonly requestId: string;
  readonly clock: Clock;
  readonly db: DatabaseSync;
}

export interface HandlerOutcome {
  readonly status: number;
  readonly body: unknown;
}

/** `tx` is non-null exactly for the routes the table marks `mutating`. */
export type Handler = (ctx: RequestContext, tx: Tx | null) => Result<HandlerOutcome>;

export type HttpMethod = 'GET' | 'POST' | 'PATCH';

/**
 * Who a route is for. `member` is every route a person of the organisation uses; `merchant`
 * is D-011's order feed, which an outside party's service token reaches. The field is
 * **required**, so a new route cannot be added without saying which side of that line it is
 * on — the hole #5's security review found was a read route that named no audience at all.
 */
export type Audience = 'member' | 'merchant';

export interface Route {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly mutating: boolean;
  readonly audience: Audience;
  readonly handler: Handler;
}
