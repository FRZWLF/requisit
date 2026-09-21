import { Buffer } from 'node:buffer';
import type { Clock } from '../../src/clock.ts';
import { dispatch, type App } from '../../src/http/app.ts';
import { SESSION_COOKIE } from '../../src/web/session.ts';
import { makeApp, seedLifecycleOrg, tokenFor, type LifecycleOrg, type TestApp } from '../support/http.ts';
import { must, TEST_CLOCK } from '../support/seed.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { orgScope } from '../../src/db/scope.ts';
import { catalogueRepo } from '../../src/db/repos/catalogue.ts';
import type { CatalogueItem } from '../../src/domain/types.ts';

/**
 * The page fixture: the same in-process `dispatch` the API suites use (D-014), with the
 * session cookie a browser would send. Nothing binds a port here.
 */

export interface PageResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly location: string;
}

export interface PageOptions {
  readonly method?: 'GET' | 'POST';
  readonly path: string;
  readonly token?: string;
  readonly form?: Record<string, string | readonly string[]>;
  readonly raw?: string;
  readonly contentType?: string;
  readonly headers?: Record<string, string>;
}

export function formBody(fields: Record<string, string | readonly string[]>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const one of value) {
        params.append(name, one);
      }
    } else {
      params.append(name, value as string);
    }
  }
  return params.toString();
}

export function visit(app: App, options: PageOptions): PageResult {
  const headers: Record<string, string> = { host: '127.0.0.1:3000', ...(options.headers ?? {}) };
  if (options.token !== undefined) {
    headers['cookie'] = `${SESSION_COOKIE}=${options.token}`;
  }
  const method = options.method ?? 'GET';
  const text = options.raw ?? (options.form === undefined ? '' : formBody(options.form));
  if (text.length > 0) {
    headers['content-type'] = options.contentType ?? 'application/x-www-form-urlencoded';
  }
  const response = dispatch(app, {
    method,
    url: options.path,
    headers,
    body: Buffer.from(text, 'utf8'),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    location: response.headers['Location'] ?? '',
  };
}

/** The hidden `idempotencyKey` of the nth form on a page — what a browser would post back. */
export function keyIn(body: string, occurrence = 0): string {
  const matches = [...body.matchAll(/name="idempotencyKey" value="([^"]+)"/g)];
  const hit = matches[occurrence];
  if (hit === undefined) {
    throw new Error(`no idempotency key #${String(occurrence)} in the page`);
  }
  return hit[1] as string;
}

/** The `action` of the form whose submit button carries `label`. */
export function formActionFor(body: string, label: string): string {
  const forms = [...body.matchAll(/<form[^>]*action="([^"]+)"[\s\S]*?<\/form>/g)];
  for (const form of forms) {
    if ((form[0] as string).includes(label)) {
      return form[1] as string;
    }
  }
  throw new Error(`no form with a ${label} button`);
}

/** The whole form (fields included) whose submit button carries `label`. */
export function formWith(body: string, label: string): string {
  const forms = [...body.matchAll(/<form[\s\S]*?<\/form>/g)];
  for (const form of forms) {
    if ((form[0] as string).includes(label)) {
      return form[0] as string;
    }
  }
  throw new Error(`no form with a ${label} button`);
}

export interface WebFixture extends TestApp {
  readonly seed: LifecycleOrg;
  readonly items: readonly CatalogueItem[];
  readonly buyerToken: string;
  readonly ownerToken: string;
  readonly financeToken: string;
  readonly strangerToken: string;
  readonly merchantToken: string;
}

export function setUpWeb(
  options: { currency?: string; clock?: Clock; name?: string; itemName?: string } = {},
): WebFixture {
  const fixture = makeApp(options.clock ?? TEST_CLOCK);
  const seed = seedLifecycleOrg(fixture.db, {
    ...(options.currency === undefined ? {} : { currency: options.currency }),
    ...(options.name === undefined ? {} : { name: options.name }),
  });
  const currency = options.currency ?? 'EUR';
  const bootstrap = orgScope(seed.org.id, { personId: null, kind: 'system', roles: new Set() });
  const items = withTransaction(fixture.db, (tx) => {
    const catalogue = catalogueRepo(fixture.db, bootstrap, TEST_CLOCK);
    return [
      must(
        catalogue.insert(tx, {
          sku: 'SKU-1',
          name: options.itemName ?? 'Laptop <stand>',
          unitPriceMinor: currency === 'JPY' ? 4000 : 400000,
          currency,
        }),
      ),
      must(
        catalogue.insert(tx, {
          sku: 'SKU-2',
          name: 'Pencil',
          unitPriceMinor: currency === 'JPY' ? 100 : 100,
          currency,
        }),
      ),
    ];
  });
  return {
    ...fixture,
    seed,
    items,
    buyerToken: tokenFor(seed.org.id, seed.buyer.id, fixture.clock),
    ownerToken: tokenFor(seed.org.id, seed.owner.id, fixture.clock),
    financeToken: tokenFor(seed.org.id, seed.finance.id, fixture.clock),
    strangerToken: tokenFor(seed.org.id, seed.stranger.id, fixture.clock),
    merchantToken: tokenFor(seed.org.id, seed.merchant.id, fixture.clock),
  };
}

/** Creates a saved draft through the pages and returns its id. */
export function draftThroughPages(
  fixture: WebFixture,
  input: { token?: string; description: string; quantity: string; unitPrice: string },
): string {
  const token = input.token ?? fixture.buyerToken;
  const newPage = visit(fixture.app, { path: '/requisitions/new', token });
  const created = visit(fixture.app, {
    method: 'POST',
    path: '/requisitions',
    token,
    form: {
      idempotencyKey: keyIn(newPage.body),
      costCentreId: fixture.seed.costCentre.id,
      action: 'save',
      catalogueItemId: '',
      description: input.description,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
    },
  });
  if (created.status !== 303) {
    throw new Error(`draft not created: ${String(created.status)} ${created.body.slice(0, 400)}`);
  }
  return created.location.replace('/requisitions/', '');
}
