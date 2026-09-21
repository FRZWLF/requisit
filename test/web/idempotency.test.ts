import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requisitionsRepo } from '../../src/db/repos/requisitions.ts';
import { auditRepo } from '../../src/db/repos/audit.ts';
import { scopeOf } from '../support/http.ts';
import { draftThroughPages, formWith, keyIn, setUpWeb, visit } from './support.ts';

/**
 * D-010 through the pages: the key is a hidden field the server rendered, so posting the
 * very same form twice — a double-click, a reload, a retry — is one state change and one
 * audit line. Each case fires the identical request twice and counts what moved.
 */

test('double-clicking submit produces one state change and one audit line', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, {
    description: 'Monitor',
    quantity: '2',
    unitPrice: '500.00',
  });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  const form = { idempotencyKey: keyIn(formWith(detail.body, 'Submit for approval')), version: '1' };

  const first = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form,
  });
  const second = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form,
  });
  assert.equal(first.status, 303);
  assert.equal(second.status, 303, 'the replay answers exactly as the first call did');
  assert.equal(second.location, first.location);

  const scope = scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id);
  const row = requisitionsRepo(fixture.db, scope).byId(id);
  assert.ok(!('refused' in row));
  assert.equal(row.state, 'submitted');
  assert.equal(row.version, 2, 'one version bump, not two');
  const history = auditRepo(fixture.db, scope).listForRequisition(id);
  assert.equal(history.filter((line) => line.action === 'submit').length, 1);
});

test('double-clicking approve approves once', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, {
    description: 'Monitor',
    quantity: '2',
    unitPrice: '500.00',
  });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form: { idempotencyKey: keyIn(formWith(detail.body, 'Submit for approval')), version: '1' },
  });
  const ownerView = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.ownerToken });
  const form = { idempotencyKey: keyIn(formWith(ownerView.body, 'Approve')), version: '2' };

  const first = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/approve`,
    token: fixture.ownerToken,
    form,
  });
  const second = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/approve`,
    token: fixture.ownerToken,
    form,
  });
  assert.equal(first.status, 303);
  assert.equal(second.status, 303);

  const scope = scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.owner.id);
  const history = auditRepo(fixture.db, scope).listForRequisition(id);
  assert.equal(history.filter((line) => line.action === 'approve').length, 1);
  // presence: without the key, the second call would be a `conflict` on the stale version —
  // which is a *different* answer, and the point of replaying the first one.
  const withoutKey = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/approve`,
    token: fixture.ownerToken,
    form: { idempotencyKey: 'a-different-key', version: '2' },
  });
  assert.ok(withoutKey.status >= 400, 'a fresh key on a stale version refuses');
});

test('double-clicking save creates one draft', () => {
  const fixture = setUpWeb();
  const editor = visit(fixture.app, { path: '/requisitions/new', token: fixture.buyerToken });
  const form = {
    idempotencyKey: keyIn(editor.body),
    costCentreId: fixture.seed.costCentre.id,
    action: 'save',
    catalogueItemId: '',
    description: 'Monitor',
    quantity: '1',
    unitPrice: '5.00',
  };
  const first = visit(fixture.app, { method: 'POST', path: '/requisitions', token: fixture.buyerToken, form });
  const second = visit(fixture.app, { method: 'POST', path: '/requisitions', token: fixture.buyerToken, form });
  assert.equal(first.status, 303);
  assert.equal(second.location, first.location, 'the second click lands on the same draft');

  const scope = scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id);
  assert.equal(requisitionsRepo(fixture.db, scope).list({}).length, 1);
});

test('one key reused for a different action is refused, not replayed', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, { description: 'Pens', quantity: '1', unitPrice: '5.00' });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  const key = keyIn(formWith(detail.body, 'Submit for approval'));
  const first = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/cancel`,
    token: fixture.buyerToken,
    form: { idempotencyKey: key, version: '1', reason: 'changed my mind' },
  });
  assert.equal(first.status, 303);
  const reused = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/cancel`,
    token: fixture.buyerToken,
    form: { idempotencyKey: key, version: '1', reason: 'a different reason' },
  });
  assert.equal(reused.status, 409);
  assert.match(reused.body, /<code>idempotency_key_reuse<\/code>/);
});

test('a form without a usable key is refused before anything is written', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, { description: 'Pens', quantity: '1', unitPrice: '5.00' });
  const answer = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form: { idempotencyKey: '', version: '1' },
  });
  assert.equal(answer.status, 400);
  assert.match(answer.body, /reload the page/);
  const scope = scopeOf(fixture.db, fixture.seed.org.id, fixture.seed.buyer.id);
  const row = requisitionsRepo(fixture.db, scope).byId(id);
  assert.ok(!('refused' in row));
  assert.equal(row.state, 'draft');
});
