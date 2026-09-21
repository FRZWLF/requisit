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
