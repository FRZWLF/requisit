import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLogLevel } from '../../src/log.ts';
import { SESSION_COOKIE, readCookie } from '../../src/web/session.ts';
import { draftThroughPages, formWith, keyIn, setUpWeb, visit } from './support.ts';

/**
 * D-025: the token lives in an `HttpOnly`, `SameSite=Strict` cookie and nowhere else. The
 * last test here is the one that matters — it captures the service's own log output over a
 * full walkthrough and greps it for the token string.
 */

test('signing in sets an HttpOnly, SameSite=Strict cookie and nothing else carries the token', () => {
  const fixture = setUpWeb();
  const signedIn = visit(fixture.app, {
    method: 'POST',
    path: '/sign-in',
    form: { token: fixture.buyerToken },
  });
  assert.equal(signedIn.status, 303);
  const cookie = signedIn.headers['Set-Cookie'] ?? '';
  assert.match(cookie, /^requisit_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=3600/);
  // `Secure` would mean no session at all on the http demo host; anywhere else it is set.
  assert.doesNotMatch(cookie, /Secure/, 'not on 127.0.0.1');
  const remote = visit(fixture.app, {
    method: 'POST',
    path: '/sign-in',
    form: { token: fixture.buyerToken },
    headers: { host: 'requisit.example.com' },
  });
  assert.match(remote.headers['Set-Cookie'] ?? '', /Secure/);
  assert.equal(readCookie(cookie, SESSION_COOKIE), fixture.buyerToken);
  // The redirect says where to go and says nothing about the token.
  assert.equal(signedIn.location, '/');
  assert.equal(signedIn.body, '');
});

test('a bad token is a sentence with its code, not a generic failure', () => {
  const fixture = setUpWeb();
  const refused = visit(fixture.app, {
    method: 'POST',
    path: '/sign-in',
    form: { token: 'v1.nonsense.nonsense' },
  });
  assert.equal(refused.status, 401);
  assert.match(refused.body, /<code>unauthenticated<\/code>/);
  assert.equal(refused.headers['Set-Cookie'], undefined, 'nothing is stored for a bad token');
});

test('signing out clears the cookie and the pages ask for a sign-in again', () => {
  const fixture = setUpWeb();
  const out = visit(fixture.app, { method: 'POST', path: '/sign-out' });
  assert.equal(out.status, 303);
  assert.equal(out.location, '/sign-in');
  assert.match(out.headers['Set-Cookie'] ?? '', /Max-Age=0/);
  const anonymous = visit(fixture.app, { path: '/requisitions' });
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.location, '/sign-in');
  const anonymousPost = visit(fixture.app, {
    method: 'POST',
    path: '/requisitions/00000000-0000-4000-8000-000000000000/approve',
    form: { idempotencyKey: 'k-1', version: '1' },
  });
  assert.equal(anonymousPost.status, 401);
});

test('a cross-site form post is refused before it reaches a handler', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, { description: 'Pens', quantity: '1', unitPrice: '5.00' });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  const form = { idempotencyKey: keyIn(formWith(detail.body, 'Submit for approval')), version: '1' };
  const foreign = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form,
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(foreign.status, 403);
  assert.match(foreign.body, /did not come from this site/);
  // presence: the same request from this origin goes through.
  const ours = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form,
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(ours.status, 303);
});

test('every page carries nosniff and a policy that allows no inline script', () => {
  const fixture = setUpWeb();
  for (const path of ['/sign-in', '/requisitions', '/static/app.css', '/static/app.js']) {
    const answer = visit(fixture.app, { path, token: fixture.buyerToken });
    assert.equal(answer.headers['X-Content-Type-Options'], 'nosniff', path);
  }
  const page = visit(fixture.app, { path: '/requisitions', token: fixture.buyerToken });
  assert.match(page.headers['Content-Security-Policy'] ?? '', /script-src 'self'/);
  assert.match(page.headers['Content-Security-Policy'] ?? '', /frame-ancestors 'none'/);
  assert.equal(page.headers['Cache-Control'], 'no-store');
  assert.equal(page.headers['Referrer-Policy'], 'no-referrer');
  assert.doesNotMatch(page.body, /<script(?![^>]*src=)/, 'no inline script on the page');
  assert.doesNotMatch(page.body, / on[a-z]+="/, 'no inline event handler on the page');
});

test('no token reaches a URL, a log line or a page source in a full walkthrough', () => {
  const fixture = setUpWeb();
  const token = fixture.buyerToken;
  const captured: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const urls: string[] = [];
  const bodies: string[] = [];

  setLogLevel('info');
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    captured.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    captured.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const signIn = visit(fixture.app, { method: 'POST', path: '/sign-in', form: { token } });
    urls.push(signIn.location);
    bodies.push(signIn.body, signIn.headers['Set-Cookie'] ?? '');
    const id = draftThroughPages(fixture, {
      description: 'Monitor',
      quantity: '2',
      unitPrice: '500.00',
    });
    const detail = visit(fixture.app, { path: `/requisitions/${id}`, token });
    bodies.push(detail.body);
    const submitted = visit(fixture.app, {
      method: 'POST',
      path: `/requisitions/${id}/submit`,
      token,
      form: { idempotencyKey: keyIn(formWith(detail.body, 'Submit for approval')), version: '1' },
    });
    urls.push(submitted.location);
    const queue = visit(fixture.app, { path: '/approvals', token: fixture.ownerToken });
    bodies.push(queue.body);
    const approverView = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.ownerToken });
    const approved = visit(fixture.app, {
      method: 'POST',
      path: `/requisitions/${id}/approve`,
      token: fixture.ownerToken,
      form: { idempotencyKey: keyIn(formWith(approverView.body, 'Approve')), version: '2' },
    });
    urls.push(approved.location);
    bodies.push(visit(fixture.app, { path: `/requisitions/${id}`, token }).body);
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    setLogLevel('error');
  }

  const log = captured.join('');
  assert.ok(log.includes('"msg":"request"'), 'presence: the walkthrough really was logged');
  assert.ok(log.length > 500, 'presence: several request lines were captured');
  assert.ok(!log.includes(token), 'a token reached the log');
  assert.ok(!log.includes(fixture.ownerToken), 'an approver token reached the log');
  for (const url of urls) {
    assert.ok(!url.includes(token), `a token reached a URL: ${url}`);
  }
  for (const body of bodies) {
    // The Set-Cookie header is the one place the token travels, by design (D-025).
    if (body.startsWith(`${SESSION_COOKIE}=`)) {
      continue;
    }
    assert.ok(!body.includes(token), 'a token reached a rendered page');
  }
});
