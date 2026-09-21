import { esc } from '../esc.ts';
import { actionFields, actionLabel, amount, refusalBlock, stateBadge } from './layout.ts';
import type { Lookups } from './lists.ts';
import type { Refusal } from '../../refusal.ts';
import type { RequisitionDetail } from '../../app/requisitions.ts';
import type { Action } from '../../domain/lifecycle.ts';
import { money } from '../../domain/money.ts';
import type { AuditLine } from '../../domain/types.ts';

export interface DetailLookups extends Lookups {
  /** The `rule_code` of a rule id, so a history line names the rule and not a UUID. */
  readonly rule: (id: string | null) => string;
}

function awaitingLine(detail: RequisitionDetail, lookups: DetailLookups): string {
  if (detail.awaiting === null) {
    return '';
  }
  const who =
    detail.awaiting.personId === null
      ? 'whoever holds finance'
      : lookups.person(detail.awaiting.personId);
  return `<p>Waiting on <strong>${esc(who)}</strong> <span class="muted">(${esc(detail.awaiting.kind)})</span></p>`;
}

function linesTable(detail: RequisitionDetail): string {
  const rows = detail.lines
    .map(
      (line) => `<tr>
<td>${esc(line.description)}</td>
<td class="amount">${esc(line.quantity)}</td>
<td class="amount">${amount(money(line.unitPriceMinor, line.currency))}</td>
<td class="amount">${amount(money(line.lineTotalMinor, line.currency))}</td>
</tr>`,
    )
    .join('\n');
  return `<table>
<thead><tr><th>Item</th><th class="amount">Qty</th><th class="amount">Unit price</th><th class="amount">Line total</th></tr></thead>
<tbody>
${rows}
</tbody>
<tfoot><tr><th colspan="3">Total</th><td class="amount"><strong>${amount(detail.total)}</strong></td></tr></tfoot>
</table>`;
}

/** The audit history, verbatim: actor, action, rule, amount, timestamp, reason (D-007). */
function historyTable(history: readonly AuditLine[], lookups: DetailLookups): string {
  if (history.length === 0) {
    return '<p class="muted">No history yet.</p>';
  }
  const rows = history
    .map((line) => {
      const actor =
        line.actorPersonId === null
          ? `the ${esc(line.actorKind)}`
          : esc(lookups.person(line.actorPersonId));
      const total =
        line.totalMinor === null || line.currency === null
          ? '<span class="muted">—</span>'
          : amount(money(line.totalMinor, line.currency));
      const states =
        line.fromState === null
          ? esc(line.toState)
          : `${esc(line.fromState)} → ${esc(line.toState)}`;
      return `<tr>
<td><time datetime="${esc(line.at)}">${esc(line.at)}</time></td>
<td>${actor}</td>
<td>${esc(line.action)}</td>
<td>${states}</td>
<td>${esc(lookups.rule(line.ruleId))}</td>
<td class="amount">${total}</td>
<td>${esc(line.reason ?? '')}</td>
</tr>`;
    })
    .join('\n');
  return `<table>
<thead><tr><th>When</th><th>Who</th><th>Action</th><th>State</th><th>Rule</th><th class="amount">Amount</th><th>Reason</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function actionForm(
  detail: RequisitionDetail,
  action: Action,
  keyFor: (action: Action) => string,
): string {
  if (action === 'edit') {
    return `<a class="button secondary" href="/requisitions/${esc(detail.id)}/edit">${esc(actionLabel(action))}</a>`;
  }
  const fields = actionFields(keyFor(action), detail.version);
  if (action === 'reject') {
    // D-009: no rejection without a reason. `required` stops the browser, and the service
    // refuses a blank one anyway — the button is a courtesy, the server is the gate.
    return `<form method="post" action="/requisitions/${esc(detail.id)}/reject" data-once>
${fields}
<label for="reject-reason">Reason for rejecting (required)</label>
<textarea id="reject-reason" name="reason" rows="2" required maxlength="500"></textarea>
<button type="submit">${esc(actionLabel(action))}</button>
</form>`;
  }
  if (action === 'cancel') {
    return `<form method="post" action="/requisitions/${esc(detail.id)}/cancel" data-once>
${fields}
<label for="cancel-reason">Reason for cancelling (optional)</label>
<input id="cancel-reason" name="reason" type="text" maxlength="500">
<button class="secondary" type="submit">${esc(actionLabel(action))}</button>
</form>`;
  }
  return `<form class="inline" method="post" action="/requisitions/${esc(detail.id)}/${esc(action)}" data-once>
${fields}
<button type="submit">${esc(actionLabel(action))}</button>
</form>`;
}

export function detailPage(input: {
  readonly detail: RequisitionDetail;
  readonly lookups: DetailLookups;
  readonly keyFor: (action: Action) => string;
  readonly refusal: Refusal | null;
}): string {
  const { detail, lookups } = input;
  const ruleLine =
    detail.rule === null
      ? '<p class="muted">No approval rule matches this total yet.</p>'
      : `<p>Rule <strong>${esc(detail.rule.ruleCode)}</strong> · ${esc(detail.rule.approverKind)}
${detail.rule.source === 'would_match' ? '<span class="muted">(would match — not submitted yet)</span>' : ''}</p>`;
  const actions = detail.actions
    .map((action) => actionForm(detail, action, input.keyFor))
    .join('\n');
  const copiedFrom =
    detail.copiedFromId === null
      ? ''
      : `<p class="muted">Copied from <a href="/requisitions/${esc(detail.copiedFromId)}">an earlier requisition</a>.</p>`;
  return `${input.refusal === null ? '' : refusalBlock(input.refusal)}
<div class="card">
<p>${stateBadge(detail.state)} · buyer ${esc(lookups.person(detail.buyerPersonId))} · cost centre ${esc(lookups.costCentre(detail.costCentreId))}</p>
${ruleLine}
${awaitingLine(detail, lookups)}
${copiedFrom}
</div>
<h2>Lines</h2>
${linesTable(detail)}
${detail.actions.length === 0 ? '<p class="muted">You have no action to take on this requisition.</p>' : `<div class="actions">${actions}</div>`}
<h2>History</h2>
${historyTable(detail.history, lookups)}
`;
}
