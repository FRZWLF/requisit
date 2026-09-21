import type { DatabaseSync } from 'node:sqlite';
import { isRefusal, refuse, type Refusal, type Result } from '../refusal.ts';
import { hasRole, type OrgScope } from '../db/scope.ts';
import { instanceFindOrg } from '../db/instance.ts';
import { peopleRepo } from '../db/repos/people.ts';
import { costCentresRepo } from '../db/repos/cost-centres.ts';
import { catalogueRepo } from '../db/repos/catalogue.ts';
import { rulesRepo } from '../db/repos/rules.ts';
import type { ServiceContext } from '../app/requisitions.ts';
import type { App } from '../http/app.ts';
import type { HttpRequest } from '../http/types.ts';
import type { CatalogueItem, CostCentre, Org } from '../domain/types.ts';
import type { Chrome } from './views/layout.ts';
import type { DetailLookups } from './views/detail.ts';

/** What every page handler is handed. `scope` is present exactly on the authenticated routes. */
export interface WebContext {
  readonly app: App;
  readonly request: HttpRequest;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly requestId: string;
  /** The route pattern that matched — the `endpoint` an idempotency key is stored under. */
  readonly pattern: string;
}

export interface AuthedContext extends WebContext {
  readonly scope: OrgScope;
}

export function serviceOf(ctx: AuthedContext): ServiceContext {
  return {
    db: ctx.app.db,
    scope: ctx.scope,
    clock: ctx.app.clock,
    requestId: ctx.requestId,
  };
}

export function hostOf(request: HttpRequest): string | undefined {
  return request.headers['host'];
}

/**
 * The names the pages print for the ids the service returns, read once per request through
 * the scoped repositories — a person or a rule from another organisation is simply not in
 * the map, so an id that leaked would render as itself and never as a foreign name (D-004).
 */
export function lookupsFor(db: DatabaseSync, scope: OrgScope): DetailLookups {
  const people = new Map(peopleRepo(db, scope).list().map((person) => [person.id, person.name]));
  const centres = new Map(
    costCentresRepo(db, scope)
      .list()
      .map((centre) => [centre.id, `${centre.code} — ${centre.name}`]),
  );
  const rules = new Map(rulesRepo(db, scope).listBySeq().map((rule) => [rule.id, rule.ruleCode]));
  const nameOf = (map: Map<string, string>, id: string | null): string =>
    id === null ? '' : (map.get(id) ?? id);
  return {
    person: (id) => nameOf(people, id),
    costCentre: (id) => nameOf(centres, id),
    rule: (id) => nameOf(rules, id),
  };
}

export function orgOf(ctx: AuthedContext): Result<Org> {
  return instanceFindOrg(ctx.app.db, ctx.scope.orgId);
}

export function chromeOf(ctx: AuthedContext): Chrome {
  const org = orgOf(ctx);
  const personId = ctx.scope.actor.personId;
  const person = personId === null ? null : peopleRepo(ctx.app.db, ctx.scope).byId(personId);
  return {
    who: person === null || isRefusal(person) ? 'unknown person' : person.name,
    orgName: isRefusal(org) ? null : org.name,
    canBuy: hasRole(ctx.scope, 'buyer'),
  };
}

export function catalogueOf(ctx: AuthedContext): CatalogueItem[] {
  return catalogueRepo(ctx.app.db, ctx.scope).list({ activeOnly: true });
}

export function costCentresOf(ctx: AuthedContext): CostCentre[] {
  return costCentresRepo(ctx.app.db, ctx.scope).list();
}

/** The organisation's currency — the one every amount on a page is denominated in (D-003). */
export function currencyOf(ctx: AuthedContext): Result<string> {
  const org = orgOf(ctx);
  return isRefusal(org) ? org : org.currency;
}

export function asRefusal(value: unknown): Refusal {
  return isRefusal(value) ? value : refuse('not_found', 'not found');
}
