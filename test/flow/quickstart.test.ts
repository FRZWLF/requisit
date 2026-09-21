import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `flow/quickstart` — the README's **commands**, run as commands (#5 fix round).
 *
 * `flow/end-to-end` drives the same nine calls in process and therefore cannot see whether
 * `npm run seed` and `npm start` work at all: a missing build step and an unread `.env` both
 * reached review behind a green board because no case ran them. This suite spawns them, with
 * a temporary `REQUISIT_DB_PATH`, a freshly generated secret and a free `PORT` — nothing of
 * the developer's machine is used and nothing is left behind — and walks the requisition
 * over a real socket, exactly as the README block does with `curl`.
 *
 * Offline: the only child processes are `npm run seed` and `npm start`, both of which run
 * code from this tree (`npm ci` is the board's step, not this suite's).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const START_TIMEOUT_MS = 120_000;

async function freePort(): Promise<number> {
  // A listener on 0, whose port the kernel just handed out, closed again before the service
  // asks for it. `PORT=0` is not an option: D-018 bounds the variable to 1–65535. Both the
  // bind and the close are awaited — `address()` before `listening` is `null`.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  assert.ok(address !== null && typeof address === 'object', 'the probe bound a port');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => {
    resolve();
  }));
  return port;
}

interface Quickstart {
  readonly costCentreId: string;
  readonly tokens: Readonly<Record<string, string>>;
}

/**
 * The `Acme GmbH` block of the seed's stdout, read the way a person reads it: the cost
 * centre id next to `CC-OPS`, and the token on the line under each label.
 */
function parseSeedOutput(stdout: string): Quickstart {
  const lines = stdout.split('\n');
  const start = lines.findIndex((line) => line.startsWith('Acme GmbH ·'));
  assert.ok(start >= 0, `the seed printed an Acme GmbH block:\n${stdout}`);
  const end = lines.findIndex((line, index) => index > start && line.trim() === '');
  const block = lines.slice(start, end < 0 ? lines.length : end);
  const centre = block.find((line) => line.includes('cost centre'));
  assert.ok(centre !== undefined, 'the seed printed the cost centre');
  const centreId = centre.trim().split(/\s+/).at(-1);
  assert.ok(centreId !== undefined, 'the cost centre line ends in an id');
  const tokens: Record<string, string> = {};
  for (const [index, line] of block.entries()) {
    const label = /^ {2}(buyer|approver|finance|merchant) {2,}/.exec(line)?.[1];
    if (label === undefined) {
      continue;
    }
    const token = block[index + 1]?.trim();
    assert.ok(token !== undefined && token.startsWith('v1.'), `${label} has a token`);
    tokens[label] = token;
  }
  for (const label of ['buyer', 'approver', 'merchant']) {
    assert.ok(label in tokens, `the seed printed the ${label} token`);
  }
  return { costCentreId: centreId, tokens };
}

async function waitForReady(base: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`the service exited with ${String(child.exitCode)}:\n${log()}`);
    }
    try {
      // Unauthenticated on purpose: a 401 proves the route table is up without a token.
      const probe = await fetch(`${base}/requisitions`);
      if (probe.status === 401) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`the service did not answer within ${String(START_TIMEOUT_MS)} ms:\n${log()}`);
}

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  base: string,
  method: string,
  path: string,
  token: string,
  key?: string,
  body?: unknown,
): Promise<Answer> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (key !== undefined) {
    headers['Idempotency-Key'] = key;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

/**
 * The other half of the quickstart's configuration: a reader who follows the README writes
 * a `.env` and never exports anything, so every script the quickstart names has to hand
 * that file to Node itself. The suite below runs the commands with exported variables (it
 * must not write into the developer's own `.env`), so this reads the contract off
 * `package.json` — cheap, and it is exactly the line whose absence broke the quickstart.
 */
test('every script the quickstart names reads `.env`, and `npm start` builds first', () => {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  const start = pkg.scripts['start'] ?? '';
  assert.match(start, /\bbuild\b/, '`npm start` builds before it serves');
  for (const name of ['serve', 'seed', 'mint-token']) {
    assert.match(
      pkg.scripts[name] ?? '',
      /--env-file-if-exists=\.env/,
      `npm run ${name} reads .env the documented way`,
    );
  }
  // `start` reaches the flag through `serve`, so it inherits it rather than repeating it.
  assert.match(start, /\bserve\b/);
});

test('the README quickstart runs as written: npm run seed, npm start, the walkthrough over a socket', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'requisit-quickstart-'));
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REQUISIT_DB_PATH: join(dir, 'requisit.db'),
    REQUISIT_TOKEN_SECRET: randomBytes(32).toString('hex'),
    PORT: String(port),
    NODE_ENV: 'development',
    REQUISIT_LOG_LEVEL: 'warn',
  };
  const base = `http://127.0.0.1:${String(port)}/api/v1`;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 1 · `npm run seed` — a real process, reading its configuration the documented way.
  const seeded = spawnSync(NPM, ['run', '--silent', 'seed'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: START_TIMEOUT_MS,
  });
  assert.equal(seeded.status, 0, `npm run seed failed:\n${seeded.stdout}\n${seeded.stderr}`);
  const { costCentreId, tokens } = parseSeedOutput(seeded.stdout);

  // 2 · `npm start` — which has to build before it runs, or the quickstart is a lie.
  // `detached` puts `npm start` and the `node dist/main.js` it spawns in one process group,
  // so the stop below reaches the **service** and not only the npm wrapper — which is what a
  // terminal's Ctrl-C does, and without it the service outlives the suite.
  const service = spawn(NPM, ['start', '--silent'], { cwd: ROOT, env, detached: true });
  let output = '';
  service.stdout.setEncoding('utf8');
  service.stderr.setEncoding('utf8');
  service.stdout.on('data', (chunk: string) => (output += chunk));
  service.stderr.on('data', (chunk: string) => (output += chunk));
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    service.on('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
  const stop = (): void => {
    try {
      process.kill(-(service.pid ?? 0), 'SIGTERM');
    } catch {
      // Already gone.
    }
  };
  t.after(async () => {
    if (service.exitCode === null) {
      stop();
      await exited;
    }
  });
  await waitForReady(base, service, () => output);

  // 3 · the walkthrough, over the socket, with the tokens the seed printed.
  const buyer = tokens['buyer'] ?? '';
  const approver = tokens['approver'] ?? '';
  const merchant = tokens['merchant'] ?? '';

  const draft = await call(base, 'POST', '/requisitions', buyer, 'q-1', {
    costCentreId,
    lines: [{ description: 'Laptop 13"', quantity: 2, unitPriceMinor: 129_900 }],
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const id = String(draft.body['id']);
  assert.deepEqual(draft.body['total'], { amountMinor: 259_800, currency: 'EUR' });

  const submitted = await call(base, 'POST', `/requisitions/${id}/submit`, buyer, 'q-2', {});
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body['state'], 'submitted');

  const approved = await call(base, 'POST', `/requisitions/${id}/approve`, approver, 'q-3', {
    version: 2,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body['state'], 'approved');

  const feed = await call(base, 'GET', '/outbox?after=0', merchant);
  assert.equal(feed.status, 200, JSON.stringify(feed.body));
  const items = feed.body['items'] as { id: number; requisitionId: string; payload: unknown }[];
  assert.equal(items.length, 1);
  assert.equal(items[0]?.requisitionId, id);
  // The next poll's cursor is the answer's own `nextAfter`, not a number the client invents.
  assert.equal(feed.body['nextAfter'], items[0]?.id);
  const empty = await call(base, 'GET', `/outbox?after=${String(feed.body['nextAfter'])}`, merchant);
  assert.deepEqual(empty.body['items'], []);

  const acked = await call(base, 'POST', '/outbox/ack', merchant, 'q-4', {
    through_id: items[0]?.id,
  });
  assert.equal(acked.status, 200, JSON.stringify(acked.body));
  assert.deepEqual(acked.body['ordered'], [id]);

  const detail = await call(base, 'GET', `/requisitions/${id}`, buyer);
  assert.equal(detail.body['state'], 'ordered');

  // 4 · and the narrowing of #5's review, over the same socket: the merchant token that
  // just acknowledged an order reads nothing else of the organisation.
  for (const path of ['/requisitions', `/requisitions/${id}`, '/rules']) {
    const refused = await call(base, 'GET', path, merchant);
    assert.equal(refused.status, 403, `${path} refuses a merchant-only token`);
    assert.equal(refused.body['code'], 'not_authorised');
  }

  // 5 · SIGTERM is the documented stop: the group goes down and the port stops answering.
  // The `npm` wrapper dies *by* the signal, so a `null` code with `SIGTERM` is the clean
  // outcome; what matters is that nothing is left listening.
  stop();
  const { code, signal } = await exited;
  assert.ok(code === 0 || signal === 'SIGTERM', `SIGTERM stopped it cleanly:\n${output}`);
  await assert.rejects(fetch(`${base}/requisitions`), 'the port is closed afterwards');
});
