import type { DatabaseSync } from 'node:sqlite';
import { refuse, type Result } from '../refusal.ts';
import type { Role } from '../domain/types.ts';
import { orgScope, type OrgScope } from '../db/scope.ts';
import { peopleRepo } from '../db/repos/people.ts';
import type { TokenClaims } from './token.ts';

/**
 * Token → authority, in exactly one place (D-005, D-006, G-001). Roles are read *now*, from
 * `person_roles`, so a role granted or revoked a second ago is already in force for a token
 * minted yesterday. Nothing is cached.
 *
 * A person who does not exist in the claimed organisation is `unauthenticated`, not
 * `not_authorised`: their token no longer identifies anybody, and the answer must not tell a
 * caller whether that id exists in some other organisation (D-016).
 *
 * An empty role set is a valid scope: an identity with no authority, which every authority
 * check then refuses with `not_authorised`.
 */
export function resolveScope(db: DatabaseSync, claims: TokenClaims): Result<OrgScope> {
  const bootstrap = orgScope(claims.org, {
    personId: claims.sub,
    kind: 'user',
    roles: new Set<Role>(),
  });
  const people = peopleRepo(db, bootstrap);
  const person = people.byId(claims.sub);
  if ('refused' in person) {
    return refuse('unauthenticated', 'unknown person');
  }
  return orgScope(claims.org, {
    personId: person.id,
    kind: 'user',
    roles: people.rolesOf(person.id),
  });
}
