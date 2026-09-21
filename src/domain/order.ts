import { isRefusal, type Result } from '../refusal.ts';
import { lineTotal, sumMoney } from './money.ts';
import type { RequisitionWithLines } from './types.ts';

/**
 * The order the merchant receives (D-011 addendum, #5). Pure: it takes the requisition rows
 * the approving transaction just read and returns the document that is stored in
 * `order_outbox.payload_json`.
 *
 * The total is **recomputed here, from the lines**, with the same `lineTotal`/`sumMoney` the
 * rest of the service uses (D-003) — never copied from a cached or passed-in figure, so an
 * order can never carry an amount no line set adds up to. Amounts are integer minor units
 * with their currency next to them, which is what makes a JPY requisition (exponent 0)
 * correct without anyone dividing by 100.
 *
 * `version` is the payload's own shape version: the merchant reads it before the rest, so a
 * later addendum to D-011 that adds or moves a field is detectable rather than silent.
 */

export const ORDER_PAYLOAD_VERSION = 1;

export interface OrderPayloadLine {
  readonly seq: number;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly currency: string;
  readonly catalogueItemId: string | null;
}

export interface OrderPayload {
  readonly version: number;
  readonly requisitionId: string;
  readonly orgId: string;
  readonly number: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly buyerPersonId: string;
  readonly costCentreId: string;
  readonly ruleId: string | null;
  readonly ruleCode: string | null;
  readonly approvedAt: string | null;
  readonly lines: readonly OrderPayloadLine[];
}

export function orderPayload(requisition: RequisitionWithLines): Result<OrderPayload> {
  const lines: OrderPayloadLine[] = [];
  for (const line of requisition.lines) {
    const amount = lineTotal(line.unitPriceMinor, line.quantity, line.currency);
    if (isRefusal(amount)) {
      return amount;
    }
    lines.push({
      seq: line.seq,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: amount.amountMinor,
      currency: line.currency,
      catalogueItemId: line.catalogueItemId,
    });
  }
  const total = sumMoney(
    requisition.currency,
    lines.map((line) => ({ amountMinor: line.lineTotalMinor, currency: line.currency })),
  );
  if (isRefusal(total)) {
    return total;
  }
  return {
    version: ORDER_PAYLOAD_VERSION,
    requisitionId: requisition.id,
    orgId: requisition.orgId,
    number: requisition.number,
    currency: total.currency,
    totalMinor: total.amountMinor,
    buyerPersonId: requisition.buyerPersonId,
    costCentreId: requisition.costCentreId,
    ruleId: requisition.ruleId,
    ruleCode: requisition.ruleCode,
    approvedAt: requisition.decidedAt,
    lines,
  };
}
