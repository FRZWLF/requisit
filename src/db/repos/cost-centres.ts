import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import { newId } from '../../ids.ts';
import { refuse, type Result } from '../../refusal.ts';
import type { CostCentre } from '../../domain/types.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { rows } from '../row.ts';
import { sameDb } from './guard.ts';

interface CostCentreRow {
  readonly id: string;
  readonly org_id: string;
  readonly code: string;
  readonly name: string;
  readonly owner_person_id: string;
  readonly created_at: string;
}

function toCostCentre(row: CostCentreRow): CostCentre {
  return {
    id: row.id,
    orgId: row.org_id,
    code: row.code,
    name: row.name,
    ownerPersonId: row.owner_person_id,
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, org_id, code, name, owner_person_id, created_at';

/** Cost-centre ownership is a relation of its own, not a role (D-006). */
export function costCentresRepo(db: DatabaseSync, scope: OrgScope, clock: Clock = systemClock) {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM cost_centres WHERE org_id = ? AND id = ?`);
  const selectAll = db.prepare(
    `SELECT ${COLUMNS} FROM cost_centres WHERE org_id = ? ORDER BY code`,
  );
  const selectOwner = db.prepare('SELECT id FROM people WHERE org_id = ? AND id = ?');
  const insertRow = db.prepare(
    `INSERT INTO cost_centres (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  return {
    insert(
      tx: Tx,
      input: { code: string; name: string; ownerPersonId: string },
    ): Result<CostCentre> {
      sameDb(db, tx);
      if (input.code.trim() === '' || input.name.trim() === '') {
        return refuse('validation_failed', 'cost centre code and name must not be empty');
      }
      // The owner must be a person of *this* organisation; one from another org is
      // `not_found`, which is also what an id-probing caller learns (D-016).
      if (selectOwner.get(scope.orgId, input.ownerPersonId) === undefined) {
        return refuse('not_found', 'owner person');
      }
      const centre: CostCentre = {
        id: newId(),
        orgId: scope.orgId,
        code: input.code,
        name: input.name,
        ownerPersonId: input.ownerPersonId,
        createdAt: toIso(clock.now()),
      };
      insertRow.run(
        centre.id,
        centre.orgId,
        centre.code,
        centre.name,
        centre.ownerPersonId,
        centre.createdAt,
      );
      return centre;
    },

    byId(id: string): Result<CostCentre> {
      const row = selectById.get(scope.orgId, id) as CostCentreRow | undefined;
      return row === undefined ? refuse('not_found', 'cost centre') : toCostCentre(row);
    },

    list(): CostCentre[] {
      return rows<CostCentreRow>(selectAll.all(scope.orgId)).map(toCostCentre);
    },
  };
}

export type CostCentresRepo = ReturnType<typeof costCentresRepo>;
