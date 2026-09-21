import type { ActorKind, Role } from '../domain/types.ts';

const scopeBrand: unique symbol = Symbol('requisit.orgScope');

export interface Actor {
  /** `null` only for a system actor that is not a person (a migration, the outbox drain). */
  readonly personId: string | null;
  readonly kind: ActorKind;
  readonly roles: ReadonlySet<Role>;
}

/**
 * The tenancy boundary as a value (D-004). Every repository factory takes one, and every
 * statement they run binds `scope.orgId` first — a query without an organisation cannot be
 * written. `orgScope` is the only constructor; the brand makes an object literal not fit.
 */
export interface OrgScope {
  readonly orgId: string;
  readonly actor: Actor;
  readonly [scopeBrand]: true;
}

export function orgScope(orgId: string, actor: Actor): OrgScope {
  if (orgId === '') {
    throw new TypeError('orgScope: orgId must not be empty');
  }
  return { orgId, actor, [scopeBrand]: true } as OrgScope;
}

export function hasRole(scope: OrgScope, role: Role): boolean {
  return scope.actor.roles.has(role);
}

/**
 * The four roles a *person* holds. `merchant` is deliberately not among them: it is the
 * order-feed integration of an organisation (D-006 addendum, #5), an outside party, and the
 * only surface it reaches is D-011's two outbox routes.
 */
export const HUMAN_ROLES: readonly Role[] = ['buyer', 'approver', 'finance', 'admin'];

/**
 * Does this scope belong to a member of the organisation, rather than to a merchant
 * integration? The API and the pages gate on this rather than on organisation membership
 * alone — a `merchant`-only token is a counterparty's credential, and the queue, a
 * requisition's detail and the rule table with its thresholds are internal control data
 * (#5 security review, D-006 addendum). A person who holds `merchant` *and* a human role
 * passes: the combination is an administration question, not an authentication one (G-022).
 *
 * A `system` actor passes too. It is the seed, a migration and the outbox drain — code of
 * this process, never a credential: `resolveScope` only ever builds a `user` actor, so no
 * request can present one.
 */
export function isMember(scope: OrgScope): boolean {
  return scope.actor.kind === 'system' || HUMAN_ROLES.some((role) => scope.actor.roles.has(role));
}
