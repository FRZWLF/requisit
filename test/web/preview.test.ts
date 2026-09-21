import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call } from '../support/http.ts';
import { keyIn, setUpWeb, visit } from './support.ts';

/**
 * The editor's figures are the server's figures (D-008, D-013). For the same lines, the
 * rule the editor displays must be the rule the API stores at submission — if the browser
 * ever grew its own matcher, these two columns would drift apart at a threshold.
 */

const CASES = [
  { price: '5.00', quantity: 1, minor: 500 },
  { price: '100.00', quantity: 1, minor: 10_000 }, // exactly on the R1 ceiling: inclusive
  { price: '100.01', quantity: 1, minor: 10_001 },
  { price: '2500.00', quantity: 2, minor: 500_000 }, // exactly on the R2 ceiling
  { price: '2500.01', quantity: 2, minor: 500_002 },
] as const;

test('the rule the editor shows is the rule the API stores for the same input', () => {
  const fixture = setUpWeb();
  const seen = new Set<string>();
  for (const one of CASES) {
    // What the page shows — the server-rendered editor and the JSON the client asks for.
    const fresh = visit(fixture.app, { path: '/requisitions/new', token: fixture.buyerToken });
    const form = {
      idempotencyKey: keyIn(fresh.body),
      costCentreId: fixture.seed.costCentre.id,
      action: 'preview',
      catalogueItemId: '',
      description: 'Monitor',
      quantity: String(one.quantity),
      unitPrice: one.price,
    };
    const rendered = visit(fixture.app, {
      method: 'POST',
      path: '/requisitions',
      token: fixture.buyerToken,
      form,
    });
    const asked = visit(fixture.app, {
      method: 'POST',
      path: '/requisitions/preview',
      token: fixture.buyerToken,
      form,
    });
    assert.equal(asked.status, 200);
    const answer = JSON.parse(asked.body) as { ruleCode: string; totalText: string };

    // What the API does with the very same lines.
    const created = call(fixture.app, {
      method: 'POST',
      path: '/api/v1/requisitions',
      token: fixture.buyerToken,
      key: `api-${one.price}`,
      body: {
        costCentreId: fixture.seed.costCentre.id,
        lines: [
          {
            description: 'Monitor',
            quantity: one.quantity,
            unitPriceMinor: one.minor / one.quantity,
          },
        ],
      },
    });
    assert.equal(created.status, 201, created.body);
    const id = created.json['id'] as string;
    const submitted = call(fixture.app, {
      method: 'POST',
      path: `/api/v1/requisitions/${id}/submit`,
      token: fixture.buyerToken,
      key: `api-submit-${one.price}`,
      body: { version: 1 },
    });
    assert.equal(submitted.status, 200, submitted.body);
    const stored = (submitted.json['rule'] as { ruleCode: string }).ruleCode;

    assert.equal(answer.ruleCode, stored, `${one.price}: the preview named a different rule`);
    assert.ok(
      rendered.body.includes(`Rule ${stored} —`),
      `${one.price}: the rendered editor named a different rule`,
    );
    assert.ok(rendered.body.includes(answer.totalText), 'the page and the JSON agree on the total');
    seen.add(stored);
  }
  // presence: the cases really do straddle the thresholds, so an equality that always held
  // for one rule cannot be what made this test pass.
  assert.deepEqual([...seen].sort(), ['R1', 'R2', 'R3']);
});

test('lines that cannot be totalled say why instead of going quiet', () => {
  const fixture = setUpWeb();
  const fresh = visit(fixture.app, { path: '/requisitions/new', token: fixture.buyerToken });
  const asked = visit(fixture.app, {
    method: 'POST',
    path: '/requisitions/preview',
    token: fixture.buyerToken,
    form: {
      idempotencyKey: keyIn(fresh.body),
      costCentreId: fixture.seed.costCentre.id,
      catalogueItemId: '',
      description: 'Monitor',
      quantity: 'lots',
      unitPrice: '5.00',
    },
  });
  assert.equal(asked.status, 200);
  const answer = JSON.parse(asked.body) as { ruleText: string; totalText: string };
  assert.match(answer.ruleText, /is not a quantity/);
  assert.equal(answer.totalText, '—');
});

test('the preview endpoint needs a session of its own', () => {
  const fixture = setUpWeb();
  const anonymous = visit(fixture.app, {
    method: 'POST',
    path: '/requisitions/preview',
    form: { costCentreId: fixture.seed.costCentre.id },
  });
  assert.equal(anonymous.status, 401);
});
