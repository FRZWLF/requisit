import type { Refusal } from '../refusal.ts';
import { statusFor } from '../http/problem.ts';
import type { HttpResponse } from '../http/types.ts';

/**
 * Every response this layer produces, HTML and redirect alike (D-012, D-013).
 *
 * `nosniff` is the header D-012's addendum made global; the rest are the ones an HTML
 * surface owes that a JSON one did not. The policy is deliberately narrow: the pages load
 * exactly one stylesheet and one script, both from this origin, and nothing else — no
 * inline script, no inline style, no frame, no form target but this origin. `no-store`
 * keeps an approver's amounts out of a shared machine's disk cache and out of the back
 * button after sign-out.
 */
const CSP =
  "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; " +
  "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

function baseHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
}

export function html(status: number, body: string, extra: Record<string, string> = {}): HttpResponse {
  return { status, headers: { ...baseHeaders(HTML_CONTENT_TYPE), ...extra }, body };
}

export function json(status: number, body: unknown, extra: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { ...baseHeaders('application/json'), ...extra },
    body: JSON.stringify(body),
  };
}

/**
 * A `303` after every successful form POST — the browser follows it with a GET, so a reload
 * of the result page cannot repeat the action. The `Location` is always a path this service
 * built; no request value ever reaches it (an open redirect is one string concatenation
 * away otherwise).
 */
export function redirect(location: string, extra: Record<string, string> = {}): HttpResponse {
  return {
    status: 303,
    headers: { ...baseHeaders(HTML_CONTENT_TYPE), Location: location, ...extra },
    body: '',
  };
}

export function asset(contentType: string, body: string): HttpResponse {
  return {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
    body,
  };
}

/** The HTTP status a refusal is rendered with — the same table the JSON surface uses (D-016). */
export function statusOf(refusal: Refusal): number {
  return statusFor(refusal.code);
}
