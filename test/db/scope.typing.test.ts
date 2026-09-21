import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../support/db.ts';
import { orgScope } from '../../src/db/scope.ts';
import { peopleRepo } from '../../src/db/repos/people.ts';

/**
 * The compile-time half of "a repository cannot be constructed without an `OrgScope`"
 * (D-004, D-022). `tsc --noEmit` is on the board, so an `@ts-expect-error` that stops being
 * an error fails the board — which is what makes this a check and not a comment.
 */
test('a repository needs a scope, and a scope needs orgScope()', () => {
  const db = makeDb();

  // Never called: the assertions are the two `@ts-expect-error` directives, checked by
  // `npm run typecheck`. If either call ever compiles, the directive becomes an error.
  const wouldNotCompile = (): void => {
    // @ts-expect-error a repository cannot be built without an OrgScope
    peopleRepo(db);
    // @ts-expect-error an object literal is not an OrgScope — only orgScope() makes one
    peopleRepo(db, {
      orgId: 'org-1',
      actor: { personId: null, kind: 'system', roles: new Set() },
    });
  };
  assert.equal(typeof wouldNotCompile, 'function');

  const scope = orgScope('org-1', { personId: null, kind: 'system', roles: new Set() });
  assert.equal(scope.orgId, 'org-1');
  // presence: with a real scope the same call succeeds.
  assert.ok(typeof peopleRepo(db, scope).list === 'function');
});

test('orgScope refuses an empty organisation id', () => {
  assert.throws(
    () => orgScope('', { personId: null, kind: 'system', roles: new Set() }),
    TypeError,
  );
});
