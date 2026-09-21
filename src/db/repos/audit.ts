import type { DatabaseSync } from 'node:sqlite';
import { systemClock, toIso, type Clock } from '../../clock.ts';
import type { AuditLine } from '../../domain/types.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { rows } from '../row.ts';
import { sameDb } from './guard.ts';

interface AuditRow {
  readonly id: number;
  readonly org_id: string;
  readonly requisition_id: string | null;
  readonly actor_person_id: string | null;
  readonly actor_kind: AuditLine['actorKind'];
  readonly action: string;
  readonly from_state: AuditLine['fromState'];
  readonly to_state: AuditLine['toState'];
  readonly rule_id: string | null;
  readonly total_minor: number | null;
  readonly currency: string | null;
  readonly reason: string | null;
  readonly at: string;
  readonly request_id: string | null;
}

function toLine(row: AuditRow): AuditLine {
  return {
    id: row.id,
    orgId: row.org_id,
    requisitionId: row.requisition_id,
    actorPersonId: row.actor_person_id,
    actorKind: row.actor_kind,
    action: row.action,
    fromState: row.from_state,
    toState: row.to_state,
    ruleId: row.rule_id,
    totalMinor: row.total_minor,
    currency: row.currency,
    reason: row.reason,
    at: row.at,
    requestId: row.request_id,
  };
}

const COLUMNS =
  'id, org_id, requisition_id, actor_person_id, actor_kind, action, from_state, to_state, rule_id, total_minor, currency, reason, at, request_id';

export type AuditInput = Omit<AuditLine, 'id' | 'orgId' | 'at'> & {
  readonly requisitionId?: string | null;
  readonly actorPersonId?: string | null;
};

/**
 * The append-only audit (D-007). `writeAudit` holds the only insert statement
 * against the table in the whole source tree — `test/db/sql-seam.test.ts` pins that by
 * scanning `src/` for the statement itself — and it takes the
 * open transaction, so the line and the state change commit or roll back together, and the
 * schema's `BEFORE UPDATE`/`BEFORE DELETE` triggers make the "append-only" part an engine
 * guarantee rather than a convention (D-020).
 */
export function auditRepo(db: DatabaseSync, scope: OrgScope, clock: Clock = systemClock) {
  const insertRow = db.prepare(
    `INSERT INTO audit_log (org_id, requisition_id, actor_person_id, actor_kind, action, from_state, to_state, rule_id, total_minor, currency, reason, at, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectForRequisition = db.prepare(
    `SELECT ${COLUMNS} FROM audit_log WHERE org_id = ? AND requisition_id = ? ORDER BY id`,
  );
  const selectAll = db.prepare(
    `SELECT ${COLUMNS} FROM audit_log WHERE org_id = ? ORDER BY id`,
  );

  return {
    writeAudit(tx: Tx, line: AuditInput): AuditLine {
      sameDb(db, tx);
      const at = toIso(clock.now());
      const result = insertRow.run(
        scope.orgId,
        line.requisitionId ?? null,
        line.actorPersonId ?? null,
        line.actorKind,
        line.action,
        line.fromState,
        line.toState,
        line.ruleId,
        line.totalMinor,
        line.currency,
        line.reason,
        at,
        line.requestId,
      );
      return {
        id: Number(result.lastInsertRowid),
        orgId: scope.orgId,
        requisitionId: line.requisitionId ?? null,
        actorPersonId: line.actorPersonId ?? null,
        actorKind: line.actorKind,
        action: line.action,
        fromState: line.fromState,
        toState: line.toState,
        ruleId: line.ruleId,
        totalMinor: line.totalMinor,
        currency: line.currency,
        reason: line.reason,
        at,
        requestId: line.requestId,
      };
    },

    listForRequisition(requisitionId: string): AuditLine[] {
      return rows<AuditRow>(selectForRequisition.all(scope.orgId, requisitionId)).map(toLine);
    },

    list(): AuditLine[] {
      return rows<AuditRow>(selectAll.all(scope.orgId)).map(toLine);
    },
  };
}

export type AuditRepo = ReturnType<typeof auditRepo>;
