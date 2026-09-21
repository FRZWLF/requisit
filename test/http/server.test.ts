import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../src/http/server.ts';
import { makeApp, seedLifecycleOrg, tokenFor } from '../support/http.ts';

/**
 * The one suite that binds a socket — on `127.0.0.1:0`, so it takes an ephemeral port and
 * never collides with a developer's running service (D-012, D-014). Everything else about
 * the routes is asserted in-process against `dispatch`.
 */
test('the server binds an ephemeral loopback port, round-trips a request and closes', async () => {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  const token = tokenFor(seed.org.id, seed.buyer.id);
  const server = createServer(app);

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  assert.equal(address.address, '127.0.0.1');
  assert.ok(address.port > 0);

  try {
    const made = await fetch(`http://127.0.0.1:${String(address.port)}/api/v1/requisitions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'server-1',
      },
      body: JSON.stringify({
        costCentreId: seed.costCentre.id,
        lines: [{ description: 'Laptop', quantity: 1, unitPriceMinor: 250_000 }],
      }),
    });
    assert.equal(made.status, 201);
    assert.equal(made.headers.get('content-type'), 'application/json');
    assert.ok(made.headers.get('x-request-id') !== null);
    const detail = (await made.json()) as { id: string; total: { amountMinor: number } };
    assert.equal(detail.total.amountMinor, 250_000);
    assert.equal(made.headers.get('location'), `/api/v1/requisitions/${detail.id}`);

    const read = await fetch(
      `http://127.0.0.1:${String(address.port)}/api/v1/requisitions/${detail.id}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(read.status, 200);

    // the same shape a client without a token sees
    const denied = await fetch(`http://127.0.0.1:${String(address.port)}/api/v1/rules`);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('www-authenticate'), 'Bearer');
  } finally {
    server.close();
    await once(server, 'close');
  }
  assert.equal(server.listening, false);
});
