import { esc } from '../esc.ts';
import { actionFields, refusalBlock } from './layout.ts';
import type { Refusal } from '../../refusal.ts';
import type { CatalogueItem, CostCentre } from '../../domain/types.ts';
import { formatMoney, money } from '../../domain/money.ts';
import type { Preview } from '../preview.ts';

/** One editable line, as it currently stands in the form (not yet a `DraftLineInput`). */
export interface EditorLine {
  readonly catalogueItemId: string;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
}

export interface EditorInput {
  /** `POST` target: `/requisitions` for a new draft, `/requisitions/:id/edit` for an old one. */
  readonly action: string;
  readonly costCentres: readonly CostCentre[];
  readonly catalogue: readonly CatalogueItem[];
  readonly costCentreId: string;
  readonly lines: readonly EditorLine[];
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly version: number | null;
  readonly preview: Preview | null;
  readonly previewText: string;
  readonly refusal: Refusal | null;
}

function catalogueOptions(items: readonly CatalogueItem[], selected: string): string {
  const options = items.map(
    (item) =>
      `<option value="${esc(item.id)}"${item.id === selected ? ' selected' : ''}>${esc(item.sku)} — ${esc(item.name)} (${esc(formatMoney(money(item.unitPriceMinor, item.currency)))})</option>`,
  );
  return ['<option value="">Free text line</option>'].concat(options).join('');
}

function lineFields(line: EditorLine, index: number, catalogue: readonly CatalogueItem[]): string {
  const n = String(index + 1);
  return `<fieldset>
<legend>Line ${esc(n)}</legend>
<label for="item-${esc(n)}">Catalogue item</label>
<select id="item-${esc(n)}" name="catalogueItemId">${catalogueOptions(catalogue, line.catalogueItemId)}</select>
<label for="description-${esc(n)}">Note — what this line is for</label>
<input id="description-${esc(n)}" name="description" type="text" maxlength="500" value="${esc(line.description)}">
<label for="quantity-${esc(n)}">Quantity</label>
<input id="quantity-${esc(n)}" name="quantity" type="number" min="1" step="1" value="${esc(line.quantity)}">
<label for="price-${esc(n)}">Unit price</label>
<input id="price-${esc(n)}" name="unitPrice" type="text" inputmode="decimal" value="${esc(line.unitPrice)}">
</fieldset>`;
}

/**
 * The draft editor (D-013). The figures under the lines are the *server's* answer — the
 * page ships them rendered, and the client script only asks for a fresh pair when a field
 * changes (D-008: the rule is never matched in the browser). Without JavaScript the
 * "Recalculate" button posts the same form and the same figures come back.
 *
 * A blank spare line is always appended, which is how a line is added without JavaScript.
 */
export function editorPage(input: EditorInput): string {
  const centres = input.costCentres
    .map(
      (centre) =>
        `<option value="${esc(centre.id)}"${centre.id === input.costCentreId ? ' selected' : ''}>${esc(centre.code)} — ${esc(centre.name)}</option>`,
    )
    .join('');
  const lines = input.lines
    .map((line, index) => lineFields(line, index, input.catalogue))
    .join('\n');
  return `${input.refusal === null ? '' : refusalBlock(input.refusal)}
<form method="post" action="${esc(input.action)}" data-preview="/requisitions/preview">
${actionFields(input.idempotencyKey, input.version)}
<label for="costCentreId">Cost centre</label>
<select id="costCentreId" name="costCentreId">${centres}</select>
${lines}
<p class="preview">Total: <strong id="preview-total">${esc(input.preview === null ? input.previewText : input.preview.totalText)}</strong>
· <span id="preview-rule">${esc(input.preview === null ? input.previewText : input.preview.ruleText)}</span></p>
<div class="actions">
<button class="secondary" type="submit" name="action" value="preview">Recalculate</button>
<button type="submit" name="action" value="save">Save draft</button>
</div>
</form>
<p class="muted">Amounts are entered in ${esc(input.currency)}.</p>
`;
}
