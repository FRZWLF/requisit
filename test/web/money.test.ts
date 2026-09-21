import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountField, parseAmountMinor } from '../../src/web/amount.ts';
import { isRefusal } from '../../src/refusal.ts';
import { draftThroughPages, formWith, keyIn, setUpWeb, visit } from './support.ts';

/** D-003 on the surface: no bare number anywhere, and an exponent-0 currency with no decimals. */

test('an amount field parses exactly, or not at all', () => {
  assert.equal(parseAmountMinor('12.34', 'EUR'), 1234);
  assert.equal(parseAmountMinor('12,34', 'EUR'), 1234);
  assert.equal(parseAmountMinor('12', 'EUR'), 1200);
  assert.equal(parseAmountMinor('12.3', 'EUR'), 1230);
  assert.equal(parseAmountMinor('4000', 'JPY'), 4000);
  for (const [text, currency] of [
    ['12.345', 'EUR'],
    ['40.5', 'JPY'],
    ['-5', 'EUR'],
    ['1e3', 'EUR'],
    ['', 'EUR'],
    ['12.34', 'XXX'],
  ] as const) {
    assert.ok(isRefusal(parseAmountMinor(text, currency)), `${text} ${currency} must refuse`);
  }
  assert.equal(amountField(1234, 'EUR'), '12.34');
  assert.equal(amountField(4, 'EUR'), '0.04');
  assert.equal(amountField(4000, 'JPY'), '4000');
});

test('every amount on every page carries its currency', () => {
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
  for (const path of ['/requisitions', '/approvals', `/requisitions/${id}`, '/requisitions/new']) {
    const token = path === '/approvals' ? fixture.ownerToken : fixture.buyerToken;
    const body = visit(fixture.app, { path, token }).body;
    let money = 0;
    // Every figure inside an amount cell or the preview line carries the currency symbol.
    for (const cell of body.matchAll(/<td class="amount">([\s\S]*?)<\/td>/g)) {
      const text = (cell[1] ?? '').replace(/<[^>]*>/g, '').trim();
      if (text === '' || text === '—' || /^[0-9]+$/.test(text)) {
        continue; // a quantity column is not money
      }
      money += 1;
      assert.match(text, /€/, `${path}: an amount without its currency: ${text}`);
    }
    // presence: the scan above passes vacuously on a page with no amount cell at all.
    assert.ok(money > 0 || path === '/requisitions/new', `${path}: no amount was rendered`);
    assert.ok(!/>\s*100000\s*</.test(body), `${path}: a bare minor-unit number is rendered`);
  }
});

test('a JPY organisation renders no decimals anywhere', () => {
  const fixture = setUpWeb({ currency: 'JPY' });
  const id = draftThroughPages(fixture, {
    description: 'Monitor',
    quantity: '2',
    unitPrice: '5000',
  });
  const detail = visit(fixture.app, { path: `/requisitions/${id}`, token: fixture.buyerToken });
  assert.match(detail.body, /¥10,000/);
  assert.doesNotMatch(detail.body, /¥[0-9,]+\.[0-9]/, 'JPY has no decimal places');
  // The editor pre-fills the price field in major units — which for JPY is the minor unit.
  const editor = visit(fixture.app, { path: `/requisitions/${id}/edit`, token: fixture.buyerToken });
  assert.match(editor.body, /name="unitPrice" type="text" inputmode="decimal" value="5000"/);
  // …and a decimal in a JPY field is refused rather than rounded.
  const refused = visit(fixture.app, {
    method: 'POST',
    path: `/requisitions/${id}/edit`,
    token: fixture.buyerToken,
    form: {
      idempotencyKey: keyIn(editor.body),
      costCentreId: fixture.seed.costCentre.id,
      version: '1',
      action: 'save',
      catalogueItemId: '',
      description: 'Monitor',
      quantity: '2',
      unitPrice: '5000.5',
    },
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body, /JPY has no decimal places/);
});

test('a catalogue item fills the note and the price when the fields are left empty', () => {
  const fixture = setUpWeb();
  const editor = visit(fixture.app, { path: '/requisitions/new', token: fixture.buyerToken });
  assert.match(editor.body, /€4,000\.00/, 'the picker shows the catalogue price with its currency');
  const created = visit(fixture.app, {
    method: 'POST',
    path: '/requisitions',
    token: fixture.buyerToken,
    form: {
      idempotencyKey: keyIn(editor.body),
      costCentreId: fixture.seed.costCentre.id,
      action: 'save',
      catalogueItemId: fixture.items[0]?.id ?? '',
      description: '',
      quantity: '1',
      unitPrice: '',
    },
  });
  assert.equal(created.status, 303);
  const detail = visit(fixture.app, {
    path: created.location,
    token: fixture.buyerToken,
  });
  assert.match(detail.body, /Laptop &lt;stand&gt;/, 'the name came from the catalogue row');
  assert.match(detail.body, /€4,000\.00/);
});
