import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../clock.ts';
import { log } from '../log.ts';
import { isRefusal, refuse, type Refusal, type Result } from '../refusal.ts';
import type { OrgScope } from '../db/scope.ts';
import { withTransaction, type Tx } from '../db/tx.ts';
import { idempotencyKeysRepo } from '../db/repos/idempotency.ts';
import { verifyToken } from '../auth/token.ts';
import { resolveScope } from '../auth/scope.ts';
import { parseBody } from './body.ts';
import {
  endpointOf,
  fingerprintOf,
  isIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
  REPLAYED_HEADER,
} from './idempotency.ts';
import { internalErrorBody, JSON_CONTENT_TYPE, problemBody, PROBLEM_CONTENT_TYPE, statusFor } from './problem.ts';
import { matchRoute } from './router.ts';
import { handleWeb } from '../web/routes.ts';
import { REQUISITION_ROUTES } from './routes/requisitions.ts';
import { RULE_ROUTES } from './routes/rules.ts';
import type { HandlerOutcome, HttpRequest, HttpResponse, RequestContext, Route } from './types.ts';

/**
 * The request pipeline (D-023). `dispatch` is **synchronous**, like `node:sqlite`: a request
 * cannot interleave inside a transaction, and the whole route table is testable in-process
 * without a listening port. The only asynchronous code in `src/http/` is the body read in
 * the `node:http` adapter, which happens before `dispatch` is called.
 */

export const ROUTES: readonly Route[] = [...REQUISITION_ROUTES, ...RULE_ROUTES];

export interface App {
  readonly db: DatabaseSync;
  readonly tokenKeys: ReadonlyMap<string, Buffer>;
  readonly clock: Clock;
  readonly routes: readonly Route[];
}

export interface AppDeps {
  readonly db: DatabaseSync;
  readonly tokenKeys: ReadonlyMap<string, Buffer>;
  readonly clock: Clock;
}

export function createApp(deps: AppDeps): App {
  return { db: deps.db, tokenKeys: deps.tokenKeys, clock: deps.clock, routes: ROUTES };
}

const REQUEST_ID_HEADER = 'X-Request-Id';

function locationOf(status: number, body: unknown): string | null {
  if (status !== 201 || typeof body !== 'object' || body === null) {
    return null;
  }
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' ? `/api/v1/requisitions/${id}` : null;
}

/**
 * Every response, success and refusal alike, carries `nosniff`: the surface is JSON today,
 * but split 03 (D-013) serves HTML from the same origin and a line `description` is
 * attacker-controlled text that comes back inside these bodies (#3 review).
 */
function respond(status: number, body: string, requestId: string, contentType: string): HttpResponse {
  return {
    status,
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      [REQUEST_ID_HEADER]: requestId,
    },
    body,
  };
}

function renderRefusal(refusal: Refusal, requestId: string): HttpResponse {
  const status = statusFor(refusal.code);
  const response = respond(
    status,
    JSON.stringify(problemBody(refusal, requestId)),
    requestId,
    PROBLEM_CONTENT_TYPE,
  );
  if (refusal.code !== 'unauthenticated') {
    return response;
  }
  return { ...response, headers: { ...response.headers, 'WWW-Authenticate': 'Bearer' } };
}

function renderOutcome(outcome: Result<HandlerOutcome>, requestId: string): HttpResponse {
  if (isRefusal(outcome)) {
    return renderRefusal(outcome, requestId);
  }
  const body = JSON.stringify(outcome.body);
  const response = respond(outcome.status, body, requestId, JSON_CONTENT_TYPE);
  const location = locationOf(outcome.status, outcome.body);
  return location === null
    ? response
    : { ...response, headers: { ...response.headers, Location: location } };
}

/**
 * A stored response is replayed byte-for-byte, so the body still carries the *original*
 * request id while the header carries the new one — that difference is how a client tells a
 * replay from a first call, together with `Idempotent-Replayed`.
 */
function replay(status: number, body: string, requestId: string): HttpResponse {
  const contentType = status >= 400 ? PROBLEM_CONTENT_TYPE : JSON_CONTENT_TYPE;
  const response = respond(status, body, requestId, contentType);
  const headers: Record<string, string> = { ...response.headers, [REPLAYED_HEADER]: 'true' };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const location = locationOf(status, parsed);
  if (location !== null) {
    headers['Location'] = location;
  }
  return { ...response, headers };
}

function authenticate(app: App, request: HttpRequest): Result<OrgScope> {
  const header = request.headers['authorization'];
  if (header === undefined || !/^bearer /i.test(header)) {
    return refuse('unauthenticated', 'a bearer token is required');
  }
  const claims = verifyToken(app.tokenKeys, header.slice('bearer '.length).trim(), app.clock);
  if (isRefusal(claims)) {
    return claims;
  }
  const scope = resolveScope(app.db, claims);
  if (isRefusal(scope)) {
    return refuse('unauthenticated', scope.detail);
  }
  return scope;
}

function runMutating(
  app: App,
  route: Route,
  ctx: RequestContext,
  key: string,
  fingerprint: string,
): HttpResponse {
  return withTransaction(app.db, (tx: Tx) => {
    const keys = idempotencyKeysRepo(app.db, ctx.scope, app.clock);
    const endpoint = endpointOf(route.method, route.pattern);
    const seen = keys.find(endpoint, key);
    if (seen !== undefined) {
      if (seen.fingerprint !== fingerprint) {
        // Not stored: a reuse refusal must not overwrite the answer the key already owns.
        return renderRefusal(
          refuse(
            'idempotency_key_reuse',
            'this idempotency key was used for a different request',
          ),
          ctx.requestId,
        );
      }
      return replay(seen.status, seen.body, ctx.requestId);
    }
    const rendered = renderOutcome(route.handler(ctx, tx), ctx.requestId);
    // The key row is the last statement before the commit (D-010): every outcome the handler
    // produced — success and refusal alike — is stored, so a retry is indistinguishable.
    keys.insert(tx, {
      endpoint,
      key,
      fingerprint,
      status: rendered.status,
      body: rendered.body,
    });
    return rendered;
  });
}

interface Handled {
  readonly response: HttpResponse;
  readonly pattern: string | null;
  readonly orgId: string | null;
}

function handle(app: App, request: HttpRequest, requestId: string): Handled {
  let url: URL;
  try {
    url = new URL(request.url, 'http://requisit.invalid');
  } catch {
    return {
      response: renderRefusal(refuse('not_found', 'not found'), requestId),
      pattern: null,
      orgId: null,
    };
  }
  // The pages (D-013) are served by the same router, on the same origin, from the same
  // process — `handleWeb` answers everything outside `/api/`, and returns `null` for
  // `/api/`, so the JSON surface below is exactly what it was.
  const web = handleWeb(app, request, url, requestId);
  if (web !== null) {
    return { response: web.response, pattern: web.pattern, orgId: web.orgId };
  }

  const matched = matchRoute(app.routes, request.method, url.pathname);
  if (matched === null) {
    // One mapping for an unknown path, an unknown id shape and a wrong method alike: the
    // router answers no questions about what exists (D-023).
    return {
      response: renderRefusal(refuse('not_found', 'not found'), requestId),
      pattern: null,
      orgId: null,
    };
  }
  const { route, params } = matched;

  const scope = authenticate(app, request);
  if (isRefusal(scope)) {
    return { response: renderRefusal(scope, requestId), pattern: route.pattern, orgId: null };
  }

  const body = parseBody(request.body, request.headers['content-type']);
  if (isRefusal(body)) {
    return {
      response: renderRefusal(body, requestId),
      pattern: route.pattern,
      orgId: scope.orgId,
    };
  }

  const ctx: RequestContext = {
    scope,
    params,
    query: url.searchParams,
    body,
    requestId,
    clock: app.clock,
    db: app.db,
  };

  if (!route.mutating) {
    return {
      response: renderOutcome(route.handler(ctx, null), requestId),
      pattern: route.pattern,
      orgId: scope.orgId,
    };
  }

  const key = request.headers[IDEMPOTENCY_KEY_HEADER];
  if (!isIdempotencyKey(key)) {
    return {
      response: renderRefusal(
        refuse(
          'validation_failed',
          'a mutating request needs an Idempotency-Key of 1 to 200 characters from [A-Za-z0-9_.:-]',
        ),
        requestId,
      ),
      pattern: route.pattern,
      orgId: scope.orgId,
    };
  }
  const fingerprint = fingerprintOf(request.method, url.pathname, request.body);
  return {
    response: runMutating(app, route, ctx, key, fingerprint),
    pattern: route.pattern,
    orgId: scope.orgId,
  };
}

export function dispatch(app: App, request: HttpRequest): HttpResponse {
  const requestId = randomUUID();
  const startedAt = app.clock.now().getTime();
  let handled: Handled;
  try {
    handled = handle(app, request, requestId);
  } catch (error) {
    log('error', 'request failed', {
      method: request.method,
      requestId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return respond(
      500,
      JSON.stringify(internalErrorBody(requestId)),
      requestId,
      PROBLEM_CONTENT_TYPE,
    );
  }
  log('info', 'request', {
    method: request.method,
    route: handled.pattern,
    status: handled.response.status,
    requestId,
    orgId: handled.orgId,
    ms: app.clock.now().getTime() - startedAt,
  });
  return handled.response;
}
