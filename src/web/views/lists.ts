import { esc } from '../esc.ts';
import { amount, stateBadge } from './layout.ts';
import type { RequisitionSummary } from '../../app/requisitions.ts';
import { REQUISITION_STATES, type RequisitionState } from '../../domain/types.ts';

/** The names the row templates print for the ids a summary carries. */
export interface Lookups {
  readonly person: (id: string | null) => string;
  readonly costCentre: (id: string | null) => string;
}

function ruleCell(summary: RequisitionSummary): string {
  if (summary.rule === null) {
    return '<span class="muted">no rule yet</span>';
  }
  const suffix = summary.rule.source === 'would_match' ? ' <span class="muted">(would match)</span>' : '';
  return `${esc(summary.rule.ruleCode)}${suffix}`;
}

function when(value: string | null): string {
  return value === null
    ? '<span class="muted">—</span>'
    : `<time datetime="${esc(value)}">${esc(value)}</time>`;
}

export function stateFilter(selected: RequisitionState | null): string {
  const options = ['<option value="">Every state</option>']
    .concat(
      REQUISITION_STATES.map(
        (state) =>
          `<option value="${esc(state)}"${state === selected ? ' selected' : ''}>${esc(state)}</option>`,
      ),
    )
    .join('');
  return `<form method="get" action="/requisitions">
<label for="state">Filter by state</label>
<select id="state" name="state">${options}</select>
<button type="submit">Apply</button>
</form>`;
}

export function buyerList(input: {
  readonly items: readonly RequisitionSummary[];
  readonly selected: RequisitionState | null;
  readonly lookups: Lookups;
}): string {
  const rows = input.items
    .map(
      (item) => `<tr>
<td><a href="/requisitions/${esc(item.id)}">${esc(item.number)}</a></td>
<td>${stateBadge(item.state)}</td>
<td>${esc(input.lookups.costCentre(item.costCentreId))}</td>
<td class="amount">${amount(item.total)}</td>
<td>${ruleCell(item)}</td>
<td>${when(item.updatedAt)}</td>
</tr>`,
    )
    .join('\n');
  const table =
    input.items.length === 0
      ? '<p class="muted">No requisition here yet.</p>'
      : `<table>
<thead><tr><th>Number</th><th>State</th><th>Cost centre</th><th class="amount">Total</th><th>Rule</th><th>Updated</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
  return `${stateFilter(input.selected)}
${table}`;
}

export function approvalQueue(input: {
  readonly items: readonly RequisitionSummary[];
  readonly lookups: Lookups;
}): string {
  if (input.items.length === 0) {
    return '<p class="muted">Nothing is waiting for your decision.</p>';
  }
  const rows = input.items
    .map(
      (item) => `<tr>
<td><a href="/requisitions/${esc(item.id)}">${esc(item.number)}</a></td>
<td>${esc(input.lookups.person(item.buyerPersonId))}</td>
<td>${esc(input.lookups.costCentre(item.costCentreId))}</td>
<td class="amount">${amount(item.total)}</td>
<td>${ruleCell(item)}</td>
<td>${when(item.submittedAt)}</td>
</tr>`,
    )
    .join('\n');
  return `<table>
<thead><tr><th>Number</th><th>Buyer</th><th>Cost centre</th><th class="amount">Total</th><th>Rule</th><th>Waiting since</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}
