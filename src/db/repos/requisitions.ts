import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import { newId } from '../../ids.ts';
import { isRefusal, refuse, type Result } from '../../refusal.ts';
import { lineTotal } from '../../domain/money.ts';
import type {
  Requisition,
  RequisitionLine,
  RequisitionState,
  RequisitionWithLines,
} from '../../domain/types.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { rows } from '../row.ts';
import { sameDb } from './guard.ts';

interface RequisitionRow {
  readonly id: string;
  readonly org_id: string;
  readonly number: string;
  readonly buyer_person_id: string;
  readonly cost_centre_id: string;
  readonly state: RequisitionState;
  readonly version: number;
  readonly currency: string;
  readonly rule_id: string | null;
  readonly rule_code: string | null;
  readonly copied_from_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly submitted_at: string | null;
  readonly decided_at: string | null;
}

interface LineRow {
  readonly id: string;
  readonly org_id: string;
  readonly requisition_id: string;
  readonly seq: number;
  readonly catalogue_item_id: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly unit_price_minor: number;
  readonly currency: string;
}

function toRequisition(row: RequisitionRow): Requisition {
  return {
    id: row.id,
    orgId: row.org_id,
    number: row.number,
    buyerPersonId: row.buyer_person_id,
    costCentreId: row.cost_centre_id,
    state: row.state,
    version: row.version,
    currency: row.currency,
    ruleId: row.rule_id,
    ruleCode: row.rule_code,
    copiedFromId: row.copied_from_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
  };
}

function toLine(row: LineRow): RequisitionLine {
  return {
    id: row.id,
    orgId: row.org_id,
    requisitionId: row.requisition_id,
    seq: row.seq,
    catalogueItemId: row.catalogue_item_id,
    description: row.description,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    currency: row.currency,
  };
}

const REQ_COLUMNS =
  'id, org_id, number, buyer_person_id, cost_centre_id, state, version, currency, rule_id, rule_code, copied_from_id, created_at, updated_at, submitted_at, decided_at';
const LINE_COLUMNS =
  'id, org_id, requisition_id, seq, catalogue_item_id, description, quantity, unit_price_minor, currency';

export interface DraftLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly catalogueItemId?: string | null;
}

export interface DraftInput {
  readonly buyerPersonId: string;
  readonly costCentreId: string;
  readonly lines: readonly DraftLineInput[];
}

/**
 * Drafts only. The lifecycle transitions (submit, approve, reject, cancel, order) and the
 * rule matching that goes with them are split 02's (D-008…D-010); this repository exists so
 * that split writes behaviour and not SQL. The total is not a column: `byId` returns the
 * lines and the caller sums them with `sumMoney` (D-003).
 */
export function requisitionsRepo(db: DatabaseSync, scope: OrgScope, clock: Clock = systemClock) {
  const selectOrg = db.prepare('SELECT currency, requisition_seq FROM orgs WHERE id = ?');
  const bumpSeq = db.prepare(
    'UPDATE orgs SET requisition_seq = requisition_seq + 1 WHERE id = ? RETURNING requisition_seq',
  );
  const selectBuyer = db.prepare('SELECT id FROM people WHERE org_id = ? AND id = ?');
  const selectCostCentre = db.prepare('SELECT id FROM cost_centres WHERE org_id = ? AND id = ?');
  const selectItem = db.prepare('SELECT id FROM catalogue_items WHERE org_id = ? AND id = ?');
  const selectById = db.prepare(`SELECT ${REQ_COLUMNS} FROM requisitions WHERE org_id = ? AND id = ?`);
  const selectLines = db.prepare(
    `SELECT ${LINE_COLUMNS} FROM requisition_lines WHERE org_id = ? AND requisition_id = ? ORDER BY seq`,
  );
  const insertRequisition = db.prepare(
    `INSERT INTO requisitions (${REQ_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO requisition_lines (${LINE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function nextNumber(year: number): string {
    const row = bumpSeq.get(scope.orgId) as { requisition_seq: number } | undefined;
    if (row === undefined) {
      throw new Error('requisitionsRepo: the scope points at an organisation that does not exist');
    }
    return `REQ-${String(year)}-${String(row.requisition_seq).padStart(6, '0')}`;
  }

  return {
    insertDraft(tx: Tx, input: DraftInput): Result<RequisitionWithLines> {
      sameDb(db, tx);
      const org = selectOrg.get(scope.orgId) as { currency: string } | undefined;
      if (org === undefined) {
        return refuse('not_found', 'org');
      }
      if (selectBuyer.get(scope.orgId, input.buyerPersonId) === undefined) {
        return refuse('not_found', 'buyer');
      }
      if (selectCostCentre.get(scope.orgId, input.costCentreId) === undefined) {
        return refuse('not_found', 'cost centre');
      }
      if (input.lines.length === 0) {
        return refuse('validation_failed', 'a requisition needs at least one line');
      }

      const currency = org.currency;
      const prepared: RequisitionLine[] = [];
      let seq = 0;
      for (const line of input.lines) {
        seq += 1;
        if (line.description.trim() === '') {
          return refuse('validation_failed', `line ${seq}: description must not be empty`);
        }
        // Every line is put through the same arithmetic the totals use, so a line that
        // cannot be summed never reaches the database (D-003).
        const total = lineTotal(line.unitPriceMinor, line.quantity, currency);
        if (isRefusal(total)) {
          return refuse('validation_failed', `line ${seq}: ${total.detail ?? 'invalid'}`);
        }
        const catalogueItemId = line.catalogueItemId ?? null;
        if (
          catalogueItemId !== null &&
          selectItem.get(scope.orgId, catalogueItemId) === undefined
        ) {
          return refuse('not_found', `line ${seq}: catalogue item`);
        }
        prepared.push({
          id: newId(),
          orgId: scope.orgId,
          requisitionId: '',
          seq,
          catalogueItemId,
          description: line.description,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          currency,
        });
      }

      const now = toIso(clock.now());
      const requisition: Requisition = {
        id: newId(),
        orgId: scope.orgId,
        number: nextNumber(clock.now().getUTCFullYear()),
        buyerPersonId: input.buyerPersonId,
        costCentreId: input.costCentreId,
        state: 'draft',
        version: 1,
        currency,
        ruleId: null,
        ruleCode: null,
        copiedFromId: null,
        createdAt: now,
        updatedAt: now,
        submittedAt: null,
        decidedAt: null,
      };
      insertRequisition.run(
        requisition.id,
        requisition.orgId,
        requisition.number,
        requisition.buyerPersonId,
        requisition.costCentreId,
        requisition.state,
        requisition.version,
        requisition.currency,
        requisition.ruleId,
        requisition.ruleCode,
        requisition.copiedFromId,
        requisition.createdAt,
        requisition.updatedAt,
        requisition.submittedAt,
        requisition.decidedAt,
      );
      const lines = prepared.map((line) => ({ ...line, requisitionId: requisition.id }));
      for (const line of lines) {
        insertLine.run(
          line.id,
          line.orgId,
          line.requisitionId,
          line.seq,
          line.catalogueItemId,
          line.description,
          line.quantity,
          line.unitPriceMinor,
          line.currency,
        );
      }
      return { ...requisition, lines };
    },

    byId(id: string): Result<RequisitionWithLines> {
      const row = selectById.get(scope.orgId, id) as RequisitionRow | undefined;
      if (row === undefined) {
        return refuse('not_found', 'requisition');
      }
      const lines = rows<LineRow>(selectLines.all(scope.orgId, id)).map(toLine);
      return { ...toRequisition(row), lines };
    },

    list(filter: { state?: RequisitionState; buyerPersonId?: string } = {}): Requisition[] {
      const clauses = ['org_id = ?'];
      const values: (string | number)[] = [scope.orgId];
      if (filter.state !== undefined) {
        clauses.push('state = ?');
        values.push(filter.state);
      }
      if (filter.buyerPersonId !== undefined) {
        clauses.push('buyer_person_id = ?');
        values.push(filter.buyerPersonId);
      }
      const found = rows<RequisitionRow>(
        db
          .prepare(
            `SELECT ${REQ_COLUMNS} FROM requisitions WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id`,
          )
          .all(...values),
      );
      return found.map(toRequisition);
    },
  };
}

export type RequisitionsRepo = ReturnType<typeof requisitionsRepo>;
