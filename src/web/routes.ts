import { isRefusal, refuse } from '../refusal.ts';
import { matchPattern } from '../http/router.ts';
import type { App } from '../http/app.ts';
import type { HttpRequest, HttpResponse } from '../http/types.ts';
import type { AuthedContext, WebContext } from './context.ts';
import * as pages from './pages.ts';
import { html, redirect, statusOf } from './respond.ts';
import { isMember } from '../db/scope.ts';
import { sameSiteOk, sessionScope } from './session.ts';
import { page, refusalBlock } from './views/layout.ts';

/**
 * The page routes (D-012, D-013): the same table shape and the same `matchPattern` the API
 * uses, mounted in the same router, on the same origin. `:id` is a UUID or the route does
 * not match — a malformed id reaches no repository, exactly as on the JSON side (D-023).
 */

type PublicHandler = (ctx: WebContext) => HttpResponse;
type AuthedHandler = (ctx: AuthedContext) => HttpResponse;

interface PublicRoute {
  readonly method: 'GET' | 'POST';
  readonly pattern: string;
  readonly auth: false;
  readonly handler: PublicHandler;
}

interface AuthedRoute {
  readonly method: 'GET' | 'POST';
  readonly pattern: string;
  readonly auth: true;
  readonly handler: AuthedHandler;
}

export type WebRoute = PublicRoute | AuthedRoute;

export const WEB_ROUTES: readonly WebRoute[] = [
  { method: 'GET', pattern: '/static/app.css', auth: false, handler: pages.stylesheet },
  { method: 'GET', pattern: '/static/app.js', auth: false, handler: pages.clientScript },
  { method: 'GET', pattern: '/sign-in', auth: false, handler: pages.signIn },
  { method: 'POST', pattern: '/sign-in', auth: false, handler: pages.signInSubmit },
  { method: 'POST', pattern: '/sign-out', auth: false, handler: pages.signOut },
  { method: 'GET', pattern: '/', auth: true, handler: pages.root },
  { method: 'GET', pattern: '/requisitions', auth: true, handler: pages.requisitions },
  { method: 'GET', pattern: '/requisitions/new', auth: true, handler: pages.newDraft },
  { method: 'POST', pattern: '/requisitions', auth: true, handler: pages.createRequisition },
  { method: 'POST', pattern: '/requisitions/preview', auth: true, handler: pages.preview },
  { method: 'GET', pattern: '/requisitions/:id', auth: true, handler: pages.requisitionDetail },
  { method: 'GET', pattern: '/requisitions/:id/edit', auth: true, handler: pages.editDraft },
  { method: 'POST', pattern: '/requisitions/:id/edit', auth: true, handler: pages.updateRequisition },
  { method: 'POST', pattern: '/requisitions/:id/submit', auth: true, handler: pages.submitRequisition },
  { method: 'POST', pattern: '/requisitions/:id/approve', auth: true, handler: pages.approveRequisition },
  { method: 'POST', pattern: '/requisitions/:id/reject', auth: true, handler: pages.rejectRequisition },
  { method: 'POST', pattern: '/requisitions/:id/cancel', auth: true, handler: pages.cancelRequisition },
  { method: 'POST', pattern: '/requisitions/:id/copy', auth: true, handler: pages.copyRequisition },
  { method: 'GET', pattern: '/approvals', auth: true, handler: pages.approvals },
];

export interface WebOutcome {
  readonly response: HttpResponse;
  readonly pattern: string | null;
  readonly orgId: string | null;
}

function crossSitePage(): HttpResponse {
  const refusal = refuse(
    'not_authorised',
    'that form did not come from this site, so it was not carried out',
  );
  return html(
    statusOf(refusal),
    page({ title: 'Refused', heading: 'That did not happen', chrome: null, body: refusalBlock(refusal) }),
  );
}

/**
 * The page half of `dispatch`. Returns `null` for `/api/`, which keeps the JSON surface —
 * including its single `not_found` mapping — byte-for-byte what it was; every other path is
 * a page, so a mistyped link answers an HTML "not found" rather than a problem document.
 */
export function handleWeb(
  app: App,
  request: HttpRequest,
  url: URL,
  requestId: string,
): WebOutcome | null {
  if (url.pathname.startsWith('/api/')) {
    return null;
  }
  for (const route of WEB_ROUTES) {
    if (route.method !== request.method) {
      continue;
    }
    const params = matchPattern(route.pattern, url.pathname);
    if (params === null) {
      continue;
    }
    const base: WebContext = { app, request, url, params, requestId, pattern: route.pattern };
    if (request.method === 'POST' && !sameSiteOk(request)) {
      return { response: crossSitePage(), pattern: route.pattern, orgId: null };
    }
    if (!route.auth) {
      return { response: route.handler(base), pattern: route.pattern, orgId: null };
    }
    const scope = sessionScope(app, request);
    if (isRefusal(scope)) {
      // A page a signed-out person opened is a sign-in prompt, not an error document; a
      // form post from an expired session says so, because it did not happen.
      const response =
        request.method === 'GET'
          ? redirect('/sign-in')
          : html(
              statusOf(scope),
              page({
                title: 'Sign in',
                heading: 'Sign in',
                chrome: null,
                body: refusalBlock(scope),
              }),
            );
      return { response, pattern: route.pattern, orgId: null };
    }
    if (!isMember(scope)) {
      // Every authenticated page is a member's page (#5 security review). A merchant token
      // is refused here, once, rather than in each handler.
      return { response: pages.noPagesPage(), pattern: route.pattern, orgId: scope.orgId };
    }
    const authed: AuthedContext = { ...base, scope };
    return {
      response: route.handler(authed),
      pattern: route.pattern,
      orgId: scope.orgId,
    };
  }
  return { response: pages.notFoundPage(), pattern: null, orgId: null };
}
