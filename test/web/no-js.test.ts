import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftThroughPages, formWith, keyIn, setUpWeb, visit } from './support.ts';

/** The page with every `<script>` element taken out — what a phone with JS off receives. */
function withoutScript(body: string): string {
  return body.replace(/<script[\s\S]*?<\/script>/g, '');
}

test('the detail and the queue are complete with the client script removed', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, {
    description: 'Monitor',
    quantity: '2',
    unitPrice: '500.00',
  });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  const submitForm = formWith(detail.body, 'Submit for approval');
  visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/submit`,
    token: fixture.buyerToken,
    form: { idempotencyKey: keyIn(submitForm), version: '1' },
  });

  const approverDetail = visit(fixture.app, {
    path: `/requisitions/${id}`,
    token: fixture.ownerToken,
  });
  const noJs = withoutScript(approverDetail.body);
  assert.ok(!noJs.includes('<script'), 'presence: the script really was removed');
  for (const needed of ['€1,000.00', 'R2', 'Monitor', 'Otto Owner', 'Approve', 'Reject', 'History']) {
    assert.ok(noJs.includes(needed), `the detail lost "${needed}" without JavaScript`);
  }
  // The decision forms are plain forms: a method, an action and the hidden key.
  assert.match(noJs, /<form[^>]*method="post"[^>]*action="\/requisitions\/[^"]+\/approve"/);
  assert.match(noJs, /name="idempotencyKey" value="[0-9a-f-]{36}"/);
  assert.match(noJs, /name="version" value="2"/);

  const queue = withoutScript(
    visit(fixture.app, { path: '/approvals', token: fixture.ownerToken }).body,
  );
  for (const needed of ['€1,000.00', 'R2', 'Bea Buyer', 'Waiting since']) {
    assert.ok(queue.includes(needed), `the queue lost "${needed}" without JavaScript`);
  }
  assert.match(queue, new RegExp(`href="/requisitions/${id}"`));
});

test('the editor recalculates the total and the rule without JavaScript', () => {
  const fixture = setUpWeb();
  const fresh = visit(fixture.app, { path: '/requisitions/new', token: fixture.buyerToken });
  const recalculated = visit(fixture.app, {
    method: 'POST',
    path: '/requisitions',
    token: fixture.buyerToken,
    form: {
      idempotencyKey: keyIn(fresh.body),
      costCentreId: fixture.seed.costCentre.id,
      action: 'preview',
      catalogueItemId: '',
      description: 'Monitor',
      quantity: '3',
      unitPrice: '500.00',
    },
  });
  assert.equal(recalculated.status, 200);
  const noJs = withoutScript(recalculated.body);
  assert.match(noJs, /€1,500\.00/, 'the server computed the total');
  assert.match(noJs, /Rule R2 — the cost centre owner approves\./);
  assert.match(noJs, /value="Monitor"/, 'the typed line came back');
});

test('the accessibility floor holds on every page', () => {
  const fixture = setUpWeb();
  const id = draftThroughPages(fixture, { description: 'Pens', quantity: '1', unitPrice: '5.00' });
  const pages = [
    visit(fixture.app, { path: '/sign-in' }),
    visit(fixture.app, { path: '/requisitions', token: fixture.buyerToken }),
    visit(fixture.app, { path: '/requisitions/new', token: fixture.buyerToken }),
    visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken }),
    visit(fixture.app, { path: `/requisitions/${id}/edit`, token: fixture.buyerToken }),
    visit(fixture.app, { path: '/approvals', token: fixture.ownerToken }),
  ];
  for (const rendered of pages) {
    assert.equal(rendered.status, 200);
    const body = rendered.body;
    assert.match(body, /<html lang="en">/);
    assert.equal((body.match(/<title>/g) ?? []).length, 1, 'exactly one <title>');
    assert.equal((body.match(/<h1>/g) ?? []).length, 1, 'exactly one <h1>');
    // Every visible input, select and textarea carries a label bound to its id.
    for (const field of body.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      const tag = field[0] as string;
      if (tag.includes('type="hidden"')) {
        continue;
      }
      const id = /\bid="([^"]+)"/.exec(tag)?.[1];
      assert.ok(id !== undefined, `a field without an id: ${tag}`);
      assert.ok(body.includes(`<label for="${id}"`), `no label for "${id ?? ''}"`);
    }
    // Every button says what it does.
    for (const button of body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      assert.ok((button[1] ?? '').trim().length > 0, 'a button with no text');
    }
  }
});
