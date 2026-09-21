import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, type AddressInfo } from 'node:net';
import { MAX_BODY_BYTES } from '../../src/http/body.ts';
import { shutdownHandler } from '../../src/shutdown.ts';
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

/**
 * The two socket-level corrections of the #3 review: the body cap is enforced *while* the
 * request is read, and a shutdown does not wait on an idle keep-alive client before it
 * closes the database.
 *
 * Both checks are about something that must happen *without* waiting, so each one races the
 * event it expects against a deadline and asserts on the winner. A bare `await` would hang
 * forever under the very regression it pins — `npm test` sets no `--test-timeout`, so a hung
 * test is a board that never finishes rather than a board that goes red.
 */
const DEADLINE_MS = 5_000;

async function within<T>(promise: Promise<T>, what: string): Promise<void> {
  const outcome = await Promise.race([promise.then(() => 'happened'), delay(DEADLINE_MS, 'timed out')]);
  assert.equal(outcome, 'happened', what);
}
test('an over-size body is refused mid-upload and the socket is cut', async () => {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  const token = tokenFor(seed.org.id, seed.buyer.id);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  try {
    const socket = connect(port, '127.0.0.1');
    await once(socket, 'connect');
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
    });
    const closed = once(socket, 'close');

    socket.write(
      [
        'POST /api/v1/requisitions HTTP/1.1',
        'Host: 127.0.0.1',
        `Authorization: Bearer ${token}`,
        'Content-Type: application/json',
        'Idempotency-Key: oversize-1',
        'Transfer-Encoding: chunked',
        '',
        '',
      ].join('\r\n'),
    );
    const payload = 'a'.repeat(MAX_BODY_BYTES + 1);
    socket.write(`${payload.length.toString(16)}\r\n${payload}\r\n`);

    // The terminating `0\r\n\r\n` chunk is never sent: the answer must come anyway, and the
    // connection must be gone — before the fix the stream was drained to its end instead.
    await within(closed, 'the socket must be cut on the first over-size chunk');
    assert.match(received, /^HTTP\/1\.1 400 /);
    assert.match(received, /the request body may be at most/);
    assert.equal(socket.destroyed, true);
  } finally {
    // `closeAllConnections` so that teardown cannot hang on the very socket this test is
    // about — a failed assertion has to surface as a failure, not as a board that never ends.
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});

test('a shutdown closes an idle keep-alive connection and then the database', async () => {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  const token = tokenFor(seed.org.id, seed.buyer.id);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  // A client that made one request and is holding the connection open for the next one —
  // `server.close()` on its own waits for it, and `closeDatabase` never runs.
  const held = connect(port, '127.0.0.1');
  await once(held, 'connect');
  held.setEncoding('utf8');
  const answered = once(held, 'data');
  held.write(
    ['GET /api/v1/rules HTTP/1.1', 'Host: 127.0.0.1', `Authorization: Bearer ${token}`, 'Connection: keep-alive', '', ''].join('\r\n'),
  );
  assert.match(String((await answered)[0]), /^HTTP\/1\.1 200 /);

  const timer = setInterval(() => undefined, 60_000);
  const stopped = once(server, 'close');
  // The grace period is a minute here: if the idle socket were not closed outright, this
  // test would hang rather than pass.
  try {
    shutdownHandler(server, db, timer, 60_000)();
    await within(stopped, 'the idle keep-alive socket must not delay the close');
  } finally {
    held.destroy();
    server.closeAllConnections();
  }
  assert.equal(server.listening, false);
  assert.throws(() => db.prepare('SELECT 1').get(), 'the database must be closed');
});

test('a request still in flight is force-closed after the grace period', async () => {
  const { db, app } = makeApp();
  const seed = seedLifecycleOrg(db);
  const token = tokenFor(seed.org.id, seed.buyer.id);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  // Not idle: the headers promise 100 bytes and only ten arrive, so the server is inside the
  // request and `close()` waits for it however long the client likes. This is the connection
  // the grace period exists for — `closeIdleConnections()` does nothing to it.
  const stalled = connect(port, '127.0.0.1');
  await once(stalled, 'connect');
  stalled.on('error', () => undefined);
  stalled.write(
    [
      'POST /api/v1/requisitions HTTP/1.1',
      'Host: 127.0.0.1',
      `Authorization: Bearer ${token}`,
      'Content-Type: application/json',
      'Idempotency-Key: stalled-1',
      'Content-Length: 100',
      '',
      '{"lines":[',
    ].join('\r\n'),
  );

  const timer = setInterval(() => undefined, 60_000);
  const stopped = once(server, 'close');
  try {
    shutdownHandler(server, db, timer, 50)();
    await within(stopped, 'an in-flight request must not hold the process open past the grace period');
  } finally {
    stalled.destroy();
    server.closeAllConnections();
  }
  assert.equal(server.listening, false);
  assert.throws(() => db.prepare('SELECT 1').get(), 'the database must be closed');
});
