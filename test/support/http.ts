import { Buffer } from 'node:buffer';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../src/clock.ts';
import { mintToken } from '../../src/auth/token.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { orgScope, type OrgScope } from '../../src/db/scope.ts';
import { instanceCreateOrg } from '../../src/db/instance.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';
import { costCentresRepo } from '../../src/db/repos/cost-centres.ts';
import { rulesRepo } from '../../src/db/repos/rules.ts';
import { createApp, dispatch, type App } from '../../src/http/app.ts';
import type { ApprovalRule, CostCentre, Org, Person } from '../../src/domain/types.ts';
import { setLogLevel } from '../../src/log.ts';
import { makeDb } from './db.ts';
import { must, TEST_CLOCK } from './seed.ts';

/**
 * The in-process HTTP fixture (D-014). Nothing here listens on a port: `call` builds an
 * `HttpRequest` and hands it to `dispatch`, which is what makes every route assertion a unit
 * test. `test/http/server.test.ts` is the one suite that binds a socket, and it binds port 0.
 */

// The request log is not what these suites assert on; `test/config/log.test.ts` owns it.
setLogLevel('error');

export const TEST_SECRET = 'a-test-secret-that-is-long-enough-32';
export const ACTIVE_KID = '1';

export interface TestApp {
  readonly db: DatabaseSync;
  readonly app: App;
  readonly clock: Clock;
}

export function makeApp(clock: Clock = TEST_CLOCK): TestApp {
  const db = makeDb();
  const tokenKeys = new Map([[ACTIVE_KID, Buffer.from(TEST_SECRET, 'utf8')]]);
  return { db, app: createApp({ db, tokenKeys, clock }), clock };
}

export function tokenFor(orgId: string, personId: string, clock: Clock = TEST_CLOCK): string {
  return mintToken(
    { kid: ACTIVE_KID, secret: Buffer.from(TEST_SECRET, 'utf8') },
    { sub: personId, org: orgId, ttlSeconds: 3600 },
    clock,
  );
}

export interface LifecycleOrg {
  readonly org: Org;
  readonly scope: OrgScope;
  /** Holds `buyer`; the buyer of every requisition the suites seed. */
  readonly buyer: Person;
  /** Owns `costCentre`; holds `approver`, which the rules deliberately do not consult. */
  readonly owner: Person;
  /** Holds `finance` (and `buyer`, to prove the roles do not rescue a buyer's own approval). */
  readonly finance: Person;
  /** Holds `buyer` only — a member of the organisation with no authority over these rows. */
  readonly stranger: Person;
  /** Holds `merchant` only — the order-feed integration of this organisation (D-011). */
  readonly merchant: Person;
  readonly costCentre: CostCentre;
  /** seq 10 `self` ≤ 10 000 · seq 20 `cost_centre_owner` ≤ 500 000 · seq 30 `finance` unbounded. */
  readonly rules: readonly ApprovalRule[];
}

/**
 * The organisation every lifecycle suite runs against. The rule seqs leave gaps (10/20/30)
 * so a test can insert a tighter row at seq 15 and show a stored rule does not move.
 */
export function seedLifecycleOrg(
  db: DatabaseSync,
  options: { currency?: string; name?: string; clock?: Clock } = {},
): LifecycleOrg {
  const clock = options.clock ?? TEST_CLOCK;
  return withTransaction(db, (tx) => {
    const org = must(
      instanceCreateOrg(
        tx,
        { name: options.name ?? 'Acme GmbH', currency: options.currency ?? 'EUR' },
        clock,
      ),
    );
    const bootstrap = orgScope(org.id, { personId: null, kind: 'system', roles: new Set() });
    const people = peopleRepo(db, bootstrap, clock);
    const slug = org.id.slice(0, 8);

    const buyer = must(people.insert(tx, { name: 'Bea Buyer', email: `bea-${slug}@example.test` }));
    must(people.grantRole(tx, buyer.id, 'buyer'));
    const owner = must(people.insert(tx, { name: 'Otto Owner', email: `otto-${slug}@example.test` }));
    must(people.grantRole(tx, owner.id, 'approver'));
    const finance = must(
      people.insert(tx, { name: 'Fiona Finance', email: `fiona-${slug}@example.test` }),
    );
    must(people.grantRole(tx, finance.id, 'finance'));
    must(people.grantRole(tx, finance.id, 'buyer'));
    const stranger = must(
      people.insert(tx, { name: 'Sam Stranger', email: `sam-${slug}@example.test` }),
    );
    must(people.grantRole(tx, stranger.id, 'buyer'));

    const merchant = must(
      people.insert(tx, { name: 'Morgan Merchant', email: `morgan-${slug}@example.test` }),
    );
    must(people.grantRole(tx, merchant.id, 'merchant'));

    const costCentre = must(
      costCentresRepo(db, bootstrap, clock).insert(tx, {
        code: 'CC-1',
        name: 'Ops',
        ownerPersonId: owner.id,
      }),
    );

    const rulesFor = rulesRepo(db, bootstrap);
    const rules = [
      must(
        rulesFor.insert(tx, {
          seq: 10,
          maxTotalMinor: 10_000,
          approverKind: 'self',
          ruleCode: 'R1',
        }),
      ),
      must(
        rulesFor.insert(tx, {
          seq: 20,
          maxTotalMinor: 500_000,
          approverKind: 'cost_centre_owner',
          ruleCode: 'R2',
        }),
      ),
      must(
        rulesFor.insert(tx, {
          seq: 30,
          maxTotalMinor: null,
          approverKind: 'finance',
          ruleCode: 'R3',
        }),
      ),
    ];

    return {
      org,
      scope: orgScope(org.id, {
        personId: buyer.id,
        kind: 'user',
        roles: new Set(['buyer'] as const),
      }),
      buyer,
      owner,
      finance,
      stranger,
      merchant,
      costCentre,
      rules,
    };
  });
}

export interface CallOptions {
  readonly method: string;
  readonly path: string;
  readonly token?: string;
  readonly key?: string;
  readonly body?: unknown;
  /** Raw bytes instead of `body`, for the limit and content-type cases. */
  readonly raw?: Buffer;
  readonly contentType?: string | null;
  readonly headers?: Record<string, string>;
}

export interface CallResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly json: Record<string, unknown>;
}

export function call(app: App, options: CallOptions): CallResult {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token !== undefined) {
    headers['authorization'] = `Bearer ${options.token}`;
  }
  if (options.key !== undefined) {
    headers['idempotency-key'] = options.key;
  }
  const raw =
    options.raw ??
    (options.body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(options.body), 'utf8'));
  if (raw.length > 0 && options.contentType !== null) {
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  const response = dispatch(app, {
    method: options.method,
    url: options.path,
    headers,
    body: raw,
  });
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(response.body);
    json = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: response.status, headers: response.headers, body: response.body, json };
}

/** A body every suite reuses: two lines whose total is `2 * unitPriceMinor`. */
export function draftBody(costCentreId: string, unitPriceMinor: number): Record<string, unknown> {
  return {
    costCentreId,
    lines: [{ description: 'Laptop', quantity: 2, unitPriceMinor: unitPriceMinor / 2 }],
  };
}

/** The scope a token would resolve to, without minting one — for service-seam suites. */
export function scopeOf(db: DatabaseSync, orgId: string, personId: string): OrgScope {
  const bootstrap = orgScope(orgId, { personId, kind: 'user', roles: new Set() });
  return orgScope(orgId, {
    personId,
    kind: 'user',
    roles: peopleRepo(db, bootstrap, TEST_CLOCK).rolesOf(personId),
  });
}
