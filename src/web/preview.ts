import { isRefusal, type Refusal, type Result } from '../refusal.ts';
import type { OrgScope } from '../db/scope.ts';
import { rulesRepo } from '../db/repos/rules.ts';
import type { DraftLineInput } from '../db/repos/requisitions.ts';
import { formatMoney, lineTotal, sumMoney, type Money } from '../domain/money.ts';
import { describeRule, matchRule } from '../domain/rules.ts';
import type { DatabaseSync } from 'node:sqlite';

/**
 * What the draft editor shows while it is being typed: the computed total, and the rule
 * that *would* match it.
 *
 * Both come from the same functions the submit path calls — `lineTotal`/`sumMoney` (D-003)
 * and `matchRule` over this organisation's rows (D-008). The browser never decides either;
 * it asks this endpoint and prints the answer, which is why a rule change in the table
 * cannot leave the editor showing something the server would not do.
 */

export interface Preview {
  readonly total: Money;
  readonly totalText: string;
  readonly ruleCode: string | null;
  readonly ruleText: string;
}

export function previewOf(
  db: DatabaseSync,
  scope: OrgScope,
  currency: string,
  lines: readonly DraftLineInput[],
): Result<Preview> {
  const parts: Money[] = [];
  for (const line of lines) {
    const part = lineTotal(line.unitPriceMinor, line.quantity, currency);
    if (isRefusal(part)) {
      return part;
    }
    parts.push(part);
  }
  const total = sumMoney(currency, parts);
  if (isRefusal(total)) {
    return total;
  }
  const rule = matchRule(rulesRepo(db, scope).listBySeq(), total.amountMinor);
  return {
    total,
    totalText: formatMoney(total),
    ruleCode: isRefusal(rule) ? null : rule.ruleCode,
    ruleText: isRefusal(rule)
      ? 'No rule in this organisation covers this amount yet.'
      : `Rule ${rule.ruleCode} — ${describeRule(rule)} approves.`,
  };
}

/** The placeholder the editor shows when the lines cannot be totalled at all. */
export function previewRefusalText(refusal: Refusal): string {
  return `The total cannot be computed yet (${refusal.code}).`;
}
