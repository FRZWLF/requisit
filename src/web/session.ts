import { isRefusal, refuse, type Result } from '../refusal.ts';
import { verifyToken } from '../auth/token.ts';
import { resolveScope } from '../auth/scope.ts';
import type { OrgScope } from '../db/scope.ts';
import type { App } from '../http/app.ts';
import type { HttpRequest } from '../http/types.ts';

/**
 * The browser session (D-025, which amends D-013's `sessionStorage` clause).
 *
 * The pages are server-rendered and must read without JavaScript, and a navigation carries
 * no `Authorization` header — so the personal token travels in a cookie that the browser
 * attaches by itself. The attributes are what make that safe, and each one closes a
 * specific hole:
 *
 * - `HttpOnly` — `sessionStorage` hands the token to every line of script on the page; this
 *   hands it to none. An XSS on these pages can act *as* the session but cannot read the
 *   token and walk away with it.
 * - `SameSite=Strict` — the cookie is not attached to a request another site started, which
 *   is what stands between a link in a mail and a cross-site approval. Every mutating page
 *   route additionally checks `Sec-Fetch-Site` (`sameSiteOk` below).
 * - `Path=/; Secure` off localhost — the demo runs on `http://127.0.0.1`, where `Secure`
 *   would mean no session at all; anywhere else the cookie is https-only.
 *
 * The value is the same signed personal token the API takes as a bearer, so there is one
 * identity mechanism and one `resolveScope` (D-005, D-006) — not a second session store.
 */

export const SESSION_COOKIE = 'requisit_session';
const MAX_AGE_SECONDS = 3600;

/** The characters a D-021 token is made of, so a value that cannot be a token never gets set. */
const COOKIE_SAFE = /^[A-Za-z0-9._-]{1,4096}$/;

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

function isLocal(host: string | undefined): boolean {
  const name = (host ?? '').split(':')[0]?.toLowerCase() ?? '';
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '';
}

export function sessionCookie(token: string, host: string | undefined): Result<string> {
  if (!COOKIE_SAFE.test(token)) {
    return refuse('validation_failed', 'that does not look like a token');
  }
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${String(MAX_AGE_SECONDS)}`,
  ];
  if (!isLocal(host)) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

export function clearedCookie(host: string | undefined): string {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (!isLocal(host)) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

export function sessionToken(request: HttpRequest): string | undefined {
  return readCookie(request.headers['cookie'], SESSION_COOKIE);
}

/** Cookie → `OrgScope`, through the same two functions the bearer path uses (D-005). */
export function scopeFor(app: App, token: string): Result<OrgScope> {
  const claims = verifyToken(app.tokenKeys, token, app.clock);
  if (isRefusal(claims)) {
    return claims;
  }
  const scope = resolveScope(app.db, claims);
  if (isRefusal(scope)) {
    return refuse('unauthenticated', scope.detail);
  }
  return scope;
}

export function sessionScope(app: App, request: HttpRequest): Result<OrgScope> {
  const token = sessionToken(request);
  if (token === undefined) {
    return refuse('unauthenticated', 'sign in to use the requisition pages');
  }
  return scopeFor(app, token);
}

/**
 * Defence in depth behind `SameSite=Strict`: a browser that sends `Sec-Fetch-Site` says
 * where the request came from, and a mutating page route accepts only its own origin (or a
 * typed URL / bookmark, which is `none`). A browser too old to send the header falls back
 * to the cookie attribute alone — stated rather than assumed.
 */
export function sameSiteOk(request: HttpRequest): boolean {
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}
