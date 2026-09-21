import type { DatabaseSync } from 'node:sqlite';
import { newId } from '../../ids.ts';
import { refuse, type Result } from '../../refusal.ts';
import { APPROVER_KINDS, type ApprovalRule, type ApproverKind } from '../../domain/types.ts';
import type { OrgScope } from '../scope.ts';
import type { Tx } from '../tx.ts';
import { rows } from '../row.ts';
import { sameDb } from './guard.ts';

interface ApprovalRuleRow {
  readonly id: string;
  readonly org_id: string;
  readonly seq: number;
  readonly max_total_minor: number | null;
  readonly approver_kind: ApproverKind;
  readonly rule_code: string;
}

function toRule(row: ApprovalRuleRow): ApprovalRule {
  return {
    id: row.id,
    orgId: row.org_id,
    seq: row.seq,
    maxTotalMinor: row.max_total_minor,
    approverKind: row.approver_kind,
    ruleCode: row.rule_code,
  };
}

const COLUMNS = 'id, org_id, seq, max_total_minor, approver_kind, rule_code';

/** Storage only — first-match-wins matching against the total is split 02's (D-008). */
export function rulesRepo(db: DatabaseSync, scope: OrgScope) {
  const selectBySeq = db.prepare(
    `SELECT ${COLUMNS} FROM approval_rules WHERE org_id = ? ORDER BY seq`,
  );
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM approval_rules WHERE org_id = ? AND id = ?`);
  const insertRow = db.prepare(`INSERT INTO approval_rules (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`);

  return {
    insert(
      tx: Tx,
      input: {
        seq: number;
        maxTotalMinor: number | null;
        approverKind: ApproverKind;
        ruleCode: string;
      },
    ): Result<ApprovalRule> {
      sameDb(db, tx);
      if (!Number.isSafeInteger(input.seq) || input.seq < 1) {
        return refuse('validation_failed', 'rule seq must be an integer of at least 1');
      }
      if (
        input.maxTotalMinor !== null &&
        (!Number.isSafeInteger(input.maxTotalMinor) || input.maxTotalMinor < 0)
      ) {
        return refuse('validation_failed', 'maxTotalMinor must be null or a non-negative integer');
      }
      if (!APPROVER_KINDS.includes(input.approverKind)) {
        return refuse('validation_failed', 'unknown approver kind');
      }
      if (input.ruleCode.trim() === '') {
        return refuse('validation_failed', 'rule code must not be empty');
      }
      const rule: ApprovalRule = {
        id: newId(),
        orgId: scope.orgId,
        seq: input.seq,
        maxTotalMinor: input.maxTotalMinor,
        approverKind: input.approverKind,
        ruleCode: input.ruleCode,
      };
      insertRow.run(
        rule.id,
        rule.orgId,
        rule.seq,
        rule.maxTotalMinor,
        rule.approverKind,
        rule.ruleCode,
      );
      return rule;
    },

    /**
     * The row a submitted requisition stored. Approve and reject re-read *this*, never
     * re-match against the total, so an admin's later edit of the rule table cannot change
     * who may decide a requisition that is already in flight (D-008 addendum).
     */
    byId(id: string): Result<ApprovalRule> {
      const row = selectById.get(scope.orgId, id) as ApprovalRuleRow | undefined;
      return row === undefined ? refuse('not_found', 'approval rule') : toRule(row);
    },

    listBySeq(): ApprovalRule[] {
      return rows<ApprovalRuleRow>(selectBySeq.all(scope.orgId)).map(toRule);
    },
  };
}

export type RulesRepo = ReturnType<typeof rulesRepo>;
