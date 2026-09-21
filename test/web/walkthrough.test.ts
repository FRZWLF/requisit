import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftThroughPages, formWith, keyIn, setUpWeb, visit } from './support.ts';

/**
 * The whole v1 story through the page handlers: a buyer drafts and submits, the resolved
 * approver rejects with a reason, the buyer reads the reason and copies forward, and the
 * approver approves. Every step asserts what the page *shows*, not what the database holds.
 */
test('buyer → approver → buyer, end to end through the pages', () => {
  const fixture = setUpWeb();

  // The buyer signs in with a token and is sent to their own requisitions.
  const signedIn = visit(fixture.app, {
    method: 'POST',
    path: '/sign-in',
    form: { token: fixture.buyerToken },
  });
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.location, '/');
  const root = visit(fixture.app, { path: '/', token: fixture.buyerToken });
  assert.equal(root.location, '/requisitions');

  // A draft above the `self` ceiling (10 000) and below the owner ceiling (500 000).
  const id = draftThroughPages(fixture, {
    description: 'Monitor',
    quantity: '2',
    unitPrice: '500.00',
  });

  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  assert.equal(detail.status, 200);
  assert.match(detail.body, /€1,000\.00/, 'the total is shown with its currency');
  assert.match(detail.body, /Rule <strong>R2<\/strong>/, 'the rule that would match is named');
  assert.match(detail.body, /would match/, 'and it is marked as not yet stored');
  assert.match(detail.body, /Submit for approval/);

  // Submitting moves it to the approver's queue.
  const submitForm = formWith(detail.body, 'Submit for approval');
  const submitted = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form: { idempotencyKey: keyIn(submitForm), version: '1' },
  });
  assert.equal(submitted.status, 303);

  const afterSubmit = visit(fixture.app, {
    path: `/requisitions/${id}`,
    token: fixture.buyerToken,
  });
  assert.match(afterSubmit.body, /Waiting on <strong>Otto Owner<\/strong>/);
  assert.doesNotMatch(afterSubmit.body, /would match/, 'the rule is stored now, not a guess');

  // The stranger sees it (organisation-wide read, D-024) but is offered no decision.
  const stranger = visit(fixture.app, {
    path: `/requisitions/${id}`,
    token: fixture.strangerToken,
  });
  assert.equal(stranger.status, 200);
  assert.doesNotMatch(stranger.body, /<button[^>]*>Approve</);

  // The cost centre owner finds it in the queue, oldest first, with amount and rule.
  const queue = visit(fixture.app, { path: '/approvals', token: fixture.ownerToken });
  assert.equal(queue.status, 200);
  assert.match(queue.body, /€1,000\.00/);
  assert.match(queue.body, /R2/);
  assert.match(queue.body, new RegExp(`/requisitions/${id}`));

  // …and rejects it with a reason.
  const approverView = visit(fixture.app, {
    path: `/requisitions/${id}`,
    token: fixture.ownerToken,
  });
  const rejectForm = formWith(approverView.body, 'Reject');
  assert.match(rejectForm, /required/, 'D-009: the reason field is required');
  const rejected = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/reject`,
    token: fixture.ownerToken,
    form: { idempotencyKey: keyIn(rejectForm), version: '2', reason: 'Wrong cost centre' },
  });
  assert.equal(rejected.status, 303);

  // The buyer reads the reason verbatim and the full history.
  const afterReject = visit(fixture.app, {
    path: `/requisitions/${id}`,
    token: fixture.buyerToken,
  });
  assert.match(afterReject.body, /Wrong cost centre/);
  assert.match(afterReject.body, /Otto Owner/, 'the history names the actor');
  assert.match(afterReject.body, /draft\.created/);
  assert.match(afterReject.body, /Copy to a new draft/);
  assert.doesNotMatch(afterReject.body, /Reopen/);

  // Copy forward lands on a new draft that carries the lines.
  const copyForm = formWith(afterReject.body, 'Copy to a new draft');
  const copied = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/copy`,
    token: fixture.buyerToken,
    form: { idempotencyKey: keyIn(copyForm), version: '3' },
  });
  assert.equal(copied.status, 303);
  const copyId = copied.location.replace('/requisitions/', '');
  assert.notEqual(copyId, id);
  const copyPage = visit(fixture.app, { path: `/requisitions/${copyId}`, token: fixture.buyerToken });
  assert.match(copyPage.body, /Monitor/);
  assert.match(copyPage.body, /Copied from/);

  // Submit the copy and approve it this time.
  const copySubmit = formWith(copyPage.body, 'Submit for approval');
  visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${copyId}/submit`,
    token: fixture.buyerToken,
    form: { idempotencyKey: keyIn(copySubmit), version: '1' },
  });
  const ownerView = visit(fixture.app, {
    path: `/requisitions/${copyId}`,
    token: fixture.ownerToken,
  });
  const approveForm = formWith(ownerView.body, 'Approve');
  const approved = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${copyId}/approve`,
    token: fixture.ownerToken,
    form: { idempotencyKey: keyIn(approveForm), version: '2' },
  });
  assert.equal(approved.status, 303);

  const finalPage = visit(fixture.app, {
    path: `/requisitions/${copyId}`,
    token: fixture.buyerToken,
  });
  assert.match(finalPage.body, /class="state">approved</);
  assert.match(finalPage.body, /You have no action to take/);
  // The history block carries actor, action, rule and amount for every line.
  assert.match(finalPage.body, /<td>approve<\/td>/);
  assert.match(finalPage.body, /<td>R2<\/td>/);
  assert.match(finalPage.body, /€1,000\.00/);

  // An empty queue says so rather than breaking.
  const empty = visit(fixture.app, { path: '/approvals', token: fixture.financeToken });
  assert.equal(empty.status, 200);
  assert.match(empty.body, /Nothing is waiting/);
});

test('a self rule approves at submission and offers nobody an approve button', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, { description: 'Pens', quantity: '1', unitPrice: '50.00' });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  assert.match(detail.body, /Rule <strong>R1<\/strong>/);
  const submitForm = formWith(detail.body, 'Submit for approval');
  visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form: { idempotencyKey: keyIn(submitForm), version: '1' },
  });
  const after = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  assert.match(after.body, /class="state">approved</);
  assert.match(after.body, /the system/, 'the automatic approval names a system actor');
  assert.doesNotMatch(after.body, /<button[^>]*>Approve</);
});
