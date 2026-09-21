import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import { newId } from '../../ids.ts';
import { refuse, type Result } from '../../refusal.ts';
import { ROLES, type Person, type Role } from '../../domain/types.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { rows } from '../row.ts';
import { sameDb } from './guard.ts';

interface PersonRow {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly email: string;
  readonly created_at: string;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

/**
 * People and their roles inside one organisation (D-006). Roles live in their own table and
 * are read at the moment of use — never carried in a token (D-005).
 */
export function peopleRepo(db: DatabaseSync, scope: OrgScope, clock: Clock = systemClock) {
  const selectById = db.prepare(
    'SELECT id, org_id, name, email, created_at FROM people WHERE org_id = ? AND id = ?',
  );
  const selectAll = db.prepare(
    'SELECT id, org_id, name, email, created_at FROM people WHERE org_id = ? ORDER BY created_at, id',
  );
  const selectRoles = db.prepare(
    'SELECT role FROM person_roles WHERE org_id = ? AND person_id = ? ORDER BY role',
  );
  const insertPerson = db.prepare(
    'INSERT INTO people (id, org_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertRole = db.prepare(
    'INSERT OR IGNORE INTO person_roles (org_id, person_id, role, granted_at) VALUES (?, ?, ?, ?)',
  );
  const deleteRole = db.prepare(
    'DELETE FROM person_roles WHERE org_id = ? AND person_id = ? AND role = ?',
  );

  function byId(id: string): Result<Person> {
    const row = selectById.get(scope.orgId, id) as PersonRow | undefined;
    // A person in another organisation is `not_found`, never `not_authorised` (D-016).
    return row === undefined ? refuse('not_found', 'person') : toPerson(row);
  }

  return {
    insert(tx: Tx, input: { name: string; email: string }): Result<Person> {
      sameDb(db, tx);
      if (input.name.trim() === '' || input.email.trim() === '') {
        return refuse('validation_failed', 'person name and email must not be empty');
      }
      const person: Person = {
        id: newId(),
        orgId: scope.orgId,
        name: input.name,
        email: input.email,
        createdAt: toIso(clock.now()),
      };
      insertPerson.run(person.id, person.orgId, person.name, person.email, person.createdAt);
      return person;
    },

    byId,

    list(): Person[] {
      return rows<PersonRow>(selectAll.all(scope.orgId)).map(toPerson);
    },

    rolesOf(personId: string): ReadonlySet<Role> {
      const granted = rows<{ role: Role }>(selectRoles.all(scope.orgId, personId));
      return new Set(granted.map((entry) => entry.role));
    },

    grantRole(tx: Tx, personId: string, role: Role): Result<void> {
      sameDb(db, tx);
      if (!ROLES.includes(role)) {
        return refuse('validation_failed', 'unknown role');
      }
      const person = byId(personId);
      if ('refused' in person) {
        return person;
      }
      insertRole.run(scope.orgId, personId, role, toIso(clock.now()));
      return undefined;
    },

    revokeRole(tx: Tx, personId: string, role: Role): Result<void> {
      sameDb(db, tx);
      const person = byId(personId);
      if ('refused' in person) {
        return person;
      }
      deleteRole.run(scope.orgId, personId, role);
      return undefined;
    },
  };
}

export type PeopleRepo = ReturnType<typeof peopleRepo>;
