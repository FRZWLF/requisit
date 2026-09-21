import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../../src/web/esc.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { orgScope } from '../../src/db/scope.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';
import { costCentresRepo } from '../../src/db/repos/cost-centres.ts';
import { must } from '../support/seed.ts';
import { tokenFor } from '../support/http.ts';
import { formWith, keyIn, setUpWeb, visit } from './support.ts';

/**
 * The escaping table (D-013). Every free-text field the UI takes, in every template that
 * renders it: the raw payload must be absent from the response and its escaped form
 * present — the absence assertion alone would pass on a page that simply lost the value.
 */

const IMG = '<img src=x onerror=alert(1)>';
const BREAKOUT = '"><script>alert("xss")</script>';
const PAYLOADS = [IMG, BREAKOUT] as const;

test('esc turns every dangerous character into its entity, and nothing else', () => {
  assert.equal(esc(IMG), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(BREAKOUT), '&quot;&gt;&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(esc("O'Hara & Sons"), 'O&#39;Hara &amp; Sons');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
  assert.equal(esc('plain text'), 'plain text');
});

function assertEscaped(body: string, value: string, where: string): void {
  assert.ok(!body.includes(value), `${where}: the raw payload reached the page`);
  assert.ok(body.includes(esc(value)), `${where}: the escaped payload is missing`);
}

for (const payload of PAYLOADS) {
  test(`free text is escaped in every template: ${payload.slice(0, 12)}…`, () => {
    const fixture = setUpWeb({ name: `Org ${payload}`, itemName: `Item ${payload}` });

    // A person and a cost centre whose names are the payload too — the list, the detail,
    // the history and the chrome all print them.
    const bootstrap = orgScope(fixture.seed.org.id, {
      personId: null,
      kind: 'system',
      roles: new Set(),
    });
    const nasty = withTransaction(fixture.db, (tx) => {
      const people = peopleRepo(fixture.db, bootstrap);
      const person = must(
        people.insert(tx, { name: `Buyer ${payload}`, email: 'nasty@example.test' }),
      );
      must(people.grantRole(tx, person.id, 'buyer'));
      const centre = must(
        costCentresRepo(fixture.db, bootstrap).insert(tx, {
          code: 'CC-9',
          name: `Centre ${payload}`,
          ownerPersonId: fixture.seed.owner.id,
        }),
      );
      return { person, centre };
    });
    const token = tokenFor(fixture.seed.org.id, nasty.person.id, fixture.clock);

    // 1 · the draft editor: the catalogue name, the cost centre name and the chrome.
    const editor = visit(fixture.app, { path: '/requisitions/new', token });
    assert.equal(editor.status, 200);
    assertEscaped(editor.body, `Item ${payload}`, 'editor: catalogue item name');
    assertEscaped(editor.body, `Centre ${payload}`, 'editor: cost centre name');
    assertEscaped(editor.body, `Buyer ${payload}`, 'editor: chrome');
    assertEscaped(editor.body, `Org ${payload}`, 'editor: organisation name');

    // 2 · the refusal block: a validation sentence that quotes what was typed.
    const refused = visit(fixture.app, {
      method: 'POST',
      path: '/requisitions',
      token,
      form: {
        idempotencyKey: keyIn(editor.body),
        costCentreId: nasty.centre.id,
        action: 'save',
        catalogueItemId: '',
        description: `Note ${payload}`,
        quantity: '1',
        unitPrice: payload,
      },
    });
    assert.equal(refused.status, 400);
    assertEscaped(refused.body, payload, 'refusal sentence');
    assertEscaped(refused.body, `Note ${payload}`, 'editor: the note as typed back');

    // 3 · a saved draft: the note in the editor, the detail and the history.
    const created = visit(fixture.app, {
      method: 'POST',
      path: '/requisitions',
      token,
      form: {
        idempotencyKey: keyIn(refused.body),
        costCentreId: nasty.centre.id,
        action: 'save',
        catalogueItemId: '',
        description: `Note ${payload}`,
        quantity: '2',
        unitPrice: '500.00',
      },
    });
    assert.equal(created.status, 303);
    const id = created.location.replace('/requisitions/', '');

    const detail = visit(fixture.app, { path: `/requisitions/${id}`, token });
    assertEscaped(detail.body, `Note ${payload}`, 'detail: line description');
    assertEscaped(detail.body, `Buyer ${payload}`, 'detail: buyer name');
    assertEscaped(detail.body, `Centre ${payload}`, 'detail: cost centre name');

    const editAgain = visit(fixture.app, { path: `/requisitions/${id}/edit`, token });
    assertEscaped(editAgain.body, `Note ${payload}`, 'editor: a stored note');

    const list = visit(fixture.app, { path: '/requisitions', token });
    assertEscaped(list.body, `Centre ${payload}`, 'buyer list: cost centre name');

    // 4 · the queue and the rejection reason, verbatim on the detail and in the history.
    const submitForm = formWith(detail.body, 'Submit for approval');
    visit(fixture.app, {
      method: 'POST',
      path: `/requisitions/${id}/submit`,
      token,
      form: { idempotencyKey: keyIn(submitForm), version: '1' },
    });
    const queue = visit(fixture.app, { path: '/approvals', token: fixture.ownerToken });
    assertEscaped(queue.body, `Buyer ${payload}`, 'queue: buyer name');
    assertEscaped(queue.body, `Centre ${payload}`, 'queue: cost centre name');

    const approverView = visit(fixture.app, {
      path: `/requisitions/${id}`,
      token: fixture.ownerToken,
    });
    const rejectForm = formWith(approverView.body, 'Reject');
    const rejected = visit(fixture.app, {
      method: 'POST',
      path: `/requisitions/${id}/reject`,
      token: fixture.ownerToken,
      form: {
        idempotencyKey: keyIn(rejectForm),
        version: '2',
        reason: `Reason ${payload}`,
      },
    });
    assert.equal(rejected.status, 303);
    const afterReject = visit(fixture.app, { path: `/requisitions/${id}`, token });
    assertEscaped(afterReject.body, `Reason ${payload}`, 'detail: rejection reason in history');
  });
}
