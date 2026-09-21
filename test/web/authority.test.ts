import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftThroughPages, formWith, keyIn, setUpWeb, visit } from './support.ts';

/**
 * The buttons are a courtesy; the server is the gate (D-024). Every case here asserts both
 * halves: the page offers no button **and** a direct POST of the same action refuses.
 */

function submitted(fixture: ReturnType<typeof setUpWeb>, unitPrice: string): string {
  const id = draftThroughPages(fixture, { description: 'Monitor', quantity: '1', unitPrice });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  const form = formWith(detail.body, 'Submit for approval');
  visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form: { idempotencyKey: keyIn(form), version: '1' },
  });
  return id;
}

test('an approver who may not approve this requisition sees no button and is refused', () => {
  const fixture = setUpWeb();
  // R2 (≤ 500 000) resolves to the cost centre owner, so finance is not the approver here.
  const id = submitted(fixture, '1000.00');

  const financeView = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.financeToken });
  assert.equal(financeView.status, 200, 'organisation-wide read still works');
  assert.doesNotMatch(financeView.body, /<button[^>]*>Approve</, 'no approve button is offered');
  assert.doesNotMatch(financeView.body, /<button[^>]*>Reject</);
  assert.match(financeView.body, /You have no action to take/);

  const posted = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/approve`,
    token: fixture.financeToken,
    form: { idempotencyKey: 'direct-post-1', version: '2' },
  });
  assert.equal(posted.status, 403);
  assert.match(posted.body, /<code>not_authorised<\/code>/);
  assert.match(posted.body, /only the cost centre owner may approve under rule R2/);

  // presence: the requisition is still submitted, and the real approver is still offered it.
  const ownerView = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.ownerToken });
  assert.match(ownerView.body, /class="state">submitted</);
  assert.match(ownerView.body, /<button[^>]*>Approve<\/button>/);
});

test('a buyer may not approve their own requisition, by button or by post', () => {
  const fixture = setUpWeb();
  const id = submitted(fixture, '1000.00');
  const view = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  assert.doesNotMatch(view.body, /<button[^>]*>Approve</);
  const posted = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/approve`,
    token: fixture.buyerToken,
    form: { idempotencyKey: 'buyer-self-1', version: '2' },
  });
  assert.equal(posted.status, 403);
  assert.match(posted.body, /a buyer may not approve their own requisition/);
});

test('rejecting without a reason is refused by the server, not only by the browser', () => {
  const fixture = setUpWeb();
  const id = submitted(fixture, '1000.00');
  const view = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.ownerToken });
  assert.match(formWith(view.body, 'Reject'), /<textarea[^>]*required/);

  const posted = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/reject`,
    token: fixture.ownerToken,
    form: { idempotencyKey: 'no-reason-1', version: '2', reason: '   ' },
  });
  assert.equal(posted.status, 400);
  assert.match(posted.body, /reject requires a reason/);
  // The requisition is still in front of the approver, with its own detail, not an error page.
  assert.match(posted.body, /class="state">submitted</);
});

test('a requisition of another organisation is the same "not found" as an unknown id', () => {
  const fixture = setUpWeb();
  const other = setUpWeb();
  const id = draftThroughPages(other, { description: 'Theirs', quantity: '1', unitPrice: '5.00' });
  const foreign = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  const unknown = visit(fixture.app, {
    path: '/requisitions/00000000-0000-4000-8000-000000000000',
    token: fixture.buyerToken,
  });
  assert.equal(foreign.status, 404);
  assert.equal(unknown.status, 404);
  assert.equal(foreign.body, unknown.body, 'the two answers must be indistinguishable');
  assert.match(foreign.body, /<code>not_found<\/code>/);
});

test('a malformed id never reaches a repository — it is the page router\'s 404', () => {
  const fixture = setUpWeb();
  const answer = visit(fixture.app, { path: '/requisitions/not-a-uuid', token: fixture.buyerToken });
  assert.equal(answer.status, 404);
  assert.match(answer.body, /there is no page at this address/);
});

test('a member without the buyer role is offered no editor and no new requisition link', () => {
  const fixture = setUpWeb();
  const queue = visit(fixture.app, { path: '/approvals', token: fixture.ownerToken });
  assert.doesNotMatch(queue.body, /href="\/requisitions\/new"/);
  const posted = visit(fixture.app, {
    method: 'POST',
    path: '/requisitions',
    token: fixture.ownerToken,
    form: {
      idempotencyKey: 'owner-draft-1',
      costCentreId: fixture.seed.costCentre.id,
      action: 'save',
      catalogueItemId: '',
      description: 'Monitor',
      quantity: '1',
      unitPrice: '5.00',
    },
  });
  assert.equal(posted.status, 403);
  assert.match(posted.body, /the buyer role is required/);
});
