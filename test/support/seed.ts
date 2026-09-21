import type { DatabaseSync } from 'node:sqlite';
import { fixedClock, type Clock } from '../../src/clock.ts';
import { isRefusal, type Result } from '../../src/refusal.ts';
import { withTransaction } from '../../src/db/tx.ts';
import { orgScope, type OrgScope } from '../../src/db/scope.ts';
import { instanceCreateOrg } from '../../src/db/instance.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';
import type { Org, Person, Role } from '../../src/domain/types.ts';

export const TEST_CLOCK: Clock = fixedClock('2026-09-21T10:00:00.000Z');

/** Unwraps a `Result`, failing the test loudly rather than letting a refusal flow on. */
export function must<T>(value: Result<T>): T {
  if (isRefusal(value)) {
    throw new Error(`expected a value, got refusal ${value.code}: ${value.detail ?? ''}`);
  }
  return value as T;
}

export interface SeededOrg {
  readonly org: Org;
  readonly scope: OrgScope;
  readonly buyer: Person;
}

/**
 * One organisation with one buyer, built through the same repositories the service uses —
 * there is no tenancy escape hatch for tests either (D-004).
 */
export function seedOrg(
  db: DatabaseSync,
  options: { name?: string; currency?: string; roles?: readonly Role[]; clock?: Clock } = {},
): SeededOrg {
  const clock = options.clock ?? TEST_CLOCK;
  const roles = options.roles ?? ['buyer'];
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
    const buyer = must(people.insert(tx, { name: 'Bea Buyer', email: 'bea@example.test' }));
    for (const role of roles) {
      must(people.grantRole(tx, buyer.id, role));
    }
    const scope = orgScope(org.id, {
      personId: buyer.id,
      kind: 'user',
      roles: new Set(roles),
    });
    return { org, scope, buyer };
  });
}
