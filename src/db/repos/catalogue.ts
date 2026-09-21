import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import { newId } from '../../ids.ts';
import { refuse, type Result } from '../../refusal.ts';
import { isKnownCurrency } from '../../domain/money.ts';
import type { CatalogueItem } from '../../domain/types.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { rows } from '../row.ts';
import { sameDb } from './guard.ts';

interface CatalogueItemRow {
  readonly id: string;
  readonly org_id: string;
  readonly sku: string;
  readonly name: string;
  readonly unit_price_minor: number;
  readonly currency: string;
  readonly active: number;
  readonly created_at: string;
}

function toItem(row: CatalogueItemRow): CatalogueItem {
  return {
    id: row.id,
    orgId: row.org_id,
    sku: row.sku,
    name: row.name,
    unitPriceMinor: row.unit_price_minor,
    currency: row.currency,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, org_id, sku, name, unit_price_minor, currency, active, created_at';

export function catalogueRepo(db: DatabaseSync, scope: OrgScope, clock: Clock = systemClock) {
  const selectById = db.prepare(
    `SELECT ${COLUMNS} FROM catalogue_items WHERE org_id = ? AND id = ?`,
  );
  const selectAll = db.prepare(
    `SELECT ${COLUMNS} FROM catalogue_items WHERE org_id = ? ORDER BY sku`,
  );
  const selectActive = db.prepare(
    `SELECT ${COLUMNS} FROM catalogue_items WHERE org_id = ? AND active = 1 ORDER BY sku`,
  );
  const insertRow = db.prepare(
    `INSERT INTO catalogue_items (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    insert(
      tx: Tx,
      input: {
        sku: string;
        name: string;
        unitPriceMinor: number;
        currency: string;
        active?: boolean;
      },
    ): Result<CatalogueItem> {
      sameDb(db, tx);
      if (input.sku.trim() === '' || input.name.trim() === '') {
        return refuse('validation_failed', 'catalogue sku and name must not be empty');
      }
      if (!Number.isSafeInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
        return refuse('validation_failed', 'unitPriceMinor must be a non-negative safe integer');
      }
      if (!isKnownCurrency(input.currency)) {
        return refuse('validation_failed', `unknown currency: ${input.currency}`);
      }
      const item: CatalogueItem = {
        id: newId(),
        orgId: scope.orgId,
        sku: input.sku,
        name: input.name,
        unitPriceMinor: input.unitPriceMinor,
        currency: input.currency,
        active: input.active ?? true,
        createdAt: toIso(clock.now()),
      };
      insertRow.run(
        item.id,
        item.orgId,
        item.sku,
        item.name,
        item.unitPriceMinor,
        item.currency,
        item.active ? 1 : 0,
        item.createdAt,
      );
      return item;
    },

    byId(id: string): Result<CatalogueItem> {
      const row = selectById.get(scope.orgId, id) as CatalogueItemRow | undefined;
      return row === undefined ? refuse('not_found', 'catalogue item') : toItem(row);
    },

    list(options: { activeOnly?: boolean } = {}): CatalogueItem[] {
      const statement = options.activeOnly === true ? selectActive : selectAll;
      return rows<CatalogueItemRow>(statement.all(scope.orgId)).map(toItem);
    },
  };
}

export type CatalogueRepo = ReturnType<typeof catalogueRepo>;
