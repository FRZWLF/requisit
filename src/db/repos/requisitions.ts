import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import { newId } from '../../ids.ts';
import { isRefusal, refuse, type Result } from '../../refusal.ts';
import { lineTotal, sumMoney, type Money } from '../../domain/money.ts';
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

/** Bounds on hostile input that the create and the edit path share (D-023). */
export const MAX_LINES = 200;
export const MAX_DESCRIPTION_CHARS = 500;

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

export interface TransitionInput {
  readonly id: string;
  readonly expectedVersion: number;
  readonly toState: RequisitionState;
  readonly ruleId: string | null;
  readonly ruleCode: string | null;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
}

export interface ListFilter {
  readonly state?: RequisitionState;
  readonly buyerPersonId?: string;
}

/**
 * Drafts and the lifecycle transitions of split 02 (D-008…D-010). The total is not a column:
 * reads return the lines and the caller sums them with `sumMoney` (D-003). Authority and the
 * state machine live in `src/domain/` and `src/app/` — this file writes rows and nothing else.
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
  const deleteLines = db.prepare(
    'DELETE FROM requisition_lines WHERE org_id = ? AND requisition_id = ?',
  );
  const updateDraftRow = db.prepare(
    'UPDATE requisitions SET cost_centre_id = ?, version = version + 1, updated_at = ? WHERE org_id = ? AND id = ?',
  );
  // The version guard as a second line of defence: the service has already compared in code
  // inside this same `BEGIN IMMEDIATE`, so a miss here is a broken invariant, not a refusal.
  const updateTransition = db.prepare(
    `UPDATE requisitions
        SET state = ?, version = version + 1, rule_id = ?, rule_code = ?,
            updated_at = ?, submitted_at = ?, decided_at = ?
      WHERE org_id = ? AND id = ? AND version = ?`,
  );

  function nextNumber(year: number): string {
    const row = bumpSeq.get(scope.orgId) as { requisition_seq: number } | undefined;
    if (row === undefined) {
      throw new Error('requisitionsRepo: the scope points at an organisation that does not exist');
    }
    return `REQ-${String(year)}-${String(row.requisition_seq).padStart(6, '0')}`;
  }

  /**
   * One validation path for create and edit alike, run to completion *before* any write, so
   * a refusal never leaves half a line set behind.
   *
   * It validates each line **and their sum**: `lineTotal` per line is not enough, because two
   * individually safe line totals can still exceed the safe-integer ceiling together, and a
   * row the repository accepted but nobody can total is unreadable by its own service. A set
   * this function accepts is one `sumMoney` can always add up — which is what lets the service
   * treat a refused total *after* a write as an invariant violation (#3 review).
   */
  function prepareLines(
    currency: string,
    lines: readonly DraftLineInput[],
  ): Result<RequisitionLine[]> {
    if (lines.length === 0) {
      return refuse('validation_failed', 'a requisition needs at least one line');
    }
    if (lines.length > MAX_LINES) {
      return refuse(
        'validation_failed',
        `a requisition may not have more than ${String(MAX_LINES)} lines`,
      );
    }
    const prepared: RequisitionLine[] = [];
    const amounts: Money[] = [];
    let seq = 0;
    for (const line of lines) {
      seq += 1;
      if (typeof line.description !== 'string' || line.description.trim() === '') {
        return refuse('validation_failed', `line ${String(seq)}: description must not be empty`);
      }
      if (line.description.length > MAX_DESCRIPTION_CHARS) {
        return refuse(
          'validation_failed',
          `line ${String(seq)}: description must be at most ${String(MAX_DESCRIPTION_CHARS)} characters`,
        );
      }
      // Every line is put through the same arithmetic the totals use, so a line that
      // cannot be summed never reaches the database (D-003).
      const total = lineTotal(line.unitPriceMinor, line.quantity, currency);
      if (isRefusal(total)) {
        return refuse('validation_failed', `line ${String(seq)}: ${total.detail ?? 'invalid'}`);
      }
      const catalogueItemId = line.catalogueItemId ?? null;
      if (catalogueItemId !== null && selectItem.get(scope.orgId, catalogueItemId) === undefined) {
        return refuse('not_found', `line ${String(seq)}: catalogue item`);
      }
      amounts.push(total);
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
    // The sum is decided here, before the first INSERT: every refusal this path can produce
    // happens while nothing has been written yet (D-003, D-023).
    const total = sumMoney(currency, amounts);
    if (isRefusal(total)) {
      return refuse('validation_failed', total.detail ?? 'the line totals cannot be summed');
    }
    return prepared;
  }

  function writeLines(
    requisitionId: string,
    prepared: readonly RequisitionLine[],
  ): RequisitionLine[] {
    const lines = prepared.map((line) => ({ ...line, requisitionId }));
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
    return lines;
  }

  function byId(id: string): Result<RequisitionWithLines> {
    const row = selectById.get(scope.orgId, id) as RequisitionRow | undefined;
    if (row === undefined) {
      return refuse('not_found', 'requisition');
    }
    const lines = rows<LineRow>(selectLines.all(scope.orgId, id)).map(toLine);
    return { ...toRequisition(row), lines };
  }

  function insertWithLines(
    input: DraftInput & { readonly copiedFromId: string | null },
  ): Result<RequisitionWithLines> {
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
    const prepared = prepareLines(org.currency, input.lines);
    if (isRefusal(prepared)) {
      return prepared;
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
      currency: org.currency,
      ruleId: null,
      ruleCode: null,
      copiedFromId: input.copiedFromId,
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
    return { ...requisition, lines: writeLines(requisition.id, prepared) };
  }

  function list(filter: ListFilter = {}): Requisition[] {
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
  }

  /**
   * The list plus every line, in two statements instead of one per row. The `IN` list is
   * built from placeholders only — an id never reaches SQL by interpolation — and
   * `org_id = ?` still comes first (D-004).
   *
   * That `org_id` is **defence in depth, not the boundary**: the ids come from `list`, which
   * is already scoped, and `requisitions.id` is a globally unique primary key, so removing it
   * leaks nothing and no test can flip it. It stays because the invariant it relies on lives
   * in another statement, and the next reader should not have to re-derive that.
   */
  function listWithLines(filter: ListFilter = {}): RequisitionWithLines[] {
    const found = list(filter);
    if (found.length === 0) {
      return [];
    }
    const placeholders = found.map(() => '?').join(', ');
    const lineRows = rows<LineRow>(
      db
        .prepare(
          `SELECT ${LINE_COLUMNS} FROM requisition_lines
            WHERE org_id = ? AND requisition_id IN (${placeholders})
            ORDER BY requisition_id, seq`,
        )
        .all(scope.orgId, ...found.map((requisition) => requisition.id)),
    ).map(toLine);
    const byRequisition = new Map<string, RequisitionLine[]>();
    for (const line of lineRows) {
      const bucket = byRequisition.get(line.requisitionId);
      if (bucket === undefined) {
        byRequisition.set(line.requisitionId, [line]);
      } else {
        bucket.push(line);
      }
    }
    return found.map((requisition) => ({
      ...requisition,
      lines: byRequisition.get(requisition.id) ?? [],
    }));
  }

  return {
    insertDraft(tx: Tx, input: DraftInput): Result<RequisitionWithLines> {
      sameDb(db, tx);
      return insertWithLines({ ...input, copiedFromId: null });
    },

    /**
     * The whole line set is replaced, never patched: a partial edit would let an approver
     * later see a total nobody ever confirmed. Bumps `version` like every other write.
     */
    replaceDraft(
      tx: Tx,
      id: string,
      input: { readonly costCentreId?: string; readonly lines?: readonly DraftLineInput[] },
    ): Result<RequisitionWithLines> {
      sameDb(db, tx);
      const current = byId(id);
      if (isRefusal(current)) {
        return current;
      }
      const costCentreId = input.costCentreId ?? current.costCentreId;
      if (selectCostCentre.get(scope.orgId, costCentreId) === undefined) {
        return refuse('not_found', 'cost centre');
      }
      const prepared =
        input.lines === undefined ? null : prepareLines(current.currency, input.lines);
      if (prepared !== null && isRefusal(prepared)) {
        return prepared;
      }
      updateDraftRow.run(costCentreId, toIso(clock.now()), scope.orgId, id);
      if (prepared !== null && !isRefusal(prepared)) {
        deleteLines.run(scope.orgId, id);
        writeLines(id, prepared);
      }
      return byId(id);
    },

    /**
     * The one statement that moves a requisition. `changes !== 1` means the row vanished or
     * its version moved inside an open write transaction — an invariant, so it throws and
     * the whole transaction rolls back (D-010).
     */
    transition(tx: Tx, input: TransitionInput): RequisitionWithLines {
      sameDb(db, tx);
      const changed = updateTransition.run(
        input.toState,
        input.ruleId,
        input.ruleCode,
        toIso(clock.now()),
        input.submittedAt,
        input.decidedAt,
        scope.orgId,
        input.id,
        input.expectedVersion,
      );
      if (changed.changes !== 1) {
        throw new Error(
          `requisitionsRepo.transition: expected exactly one row, changed ${String(changed.changes)}`,
        );
      }
      const after = byId(input.id);
      if (isRefusal(after)) {
        throw new Error('requisitionsRepo.transition: the row disappeared inside the transaction');
      }
      return after;
    },

    /** A rejected requisition becomes a **new** draft; the source row is not touched (D-009). */
    copyForward(tx: Tx, sourceId: string): Result<RequisitionWithLines> {
      sameDb(db, tx);
      const source = byId(sourceId);
      if (isRefusal(source)) {
        return source;
      }
      return insertWithLines({
        buyerPersonId: source.buyerPersonId,
        costCentreId: source.costCentreId,
        lines: source.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          catalogueItemId: line.catalogueItemId,
        })),
        copiedFromId: source.id,
      });
    },

    byId,
    list,
    listWithLines,
  };
}

export type RequisitionsRepo = ReturnType<typeof requisitionsRepo>;
