import { isRefusal, refuse, type Result } from '../refusal.ts';
import { isId } from '../ids.ts';
import type { DraftLineInput } from '../db/repos/requisitions.ts';
import type { CatalogueItem } from '../domain/types.ts';
import { parseAmountMinor } from './amount.ts';
import type { Form } from './form.ts';
import type { EditorLine } from './views/editor.ts';

/**
 * The draft editor's form, turned into the same `DraftLineInput[]` the JSON API takes —
 * one validation of one shape, at the boundary (D-023). The catalogue picker is resolved
 * **here**, on the server: choosing an item and leaving the note and the price empty fills
 * them from the catalogue row, which is why the picker needs no JavaScript.
 */

export interface DraftForm {
  readonly costCentreId: string;
  readonly lines: readonly DraftLineInput[];
  /** What the fields held, so a refusal can be shown with the person's own input intact. */
  readonly editorLines: readonly EditorLine[];
}

const MAX_LINES = 50;

function rawLines(form: Form): EditorLine[] {
  const items = form.getAll('catalogueItemId');
  const descriptions = form.getAll('description');
  const quantities = form.getAll('quantity');
  const prices = form.getAll('unitPrice');
  const count = Math.max(items.length, descriptions.length, quantities.length, prices.length);
  const lines: EditorLine[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push({
      catalogueItemId: items[index] ?? '',
      description: descriptions[index] ?? '',
      quantity: quantities[index] ?? '',
      unitPrice: prices[index] ?? '',
    });
  }
  return lines;
}

function isBlank(line: EditorLine): boolean {
  return (
    line.catalogueItemId.trim() === '' &&
    line.description.trim() === '' &&
    line.quantity.trim() === '' &&
    line.unitPrice.trim() === ''
  );
}

function quantityOf(text: string): Result<number> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 1;
  }
  if (!/^[0-9]{1,9}$/.test(trimmed)) {
    return refuse('validation_failed', `"${text}" is not a quantity`);
  }
  const value = Number(trimmed);
  if (value < 1) {
    return refuse('validation_failed', 'a quantity must be at least 1');
  }
  return value;
}

export function parseDraftForm(
  form: Form,
  catalogue: readonly CatalogueItem[],
  currency: string,
): Result<DraftForm> {
  const costCentreId = form.get('costCentreId').trim();
  if (!isId(costCentreId)) {
    return refuse('validation_failed', 'choose a cost centre');
  }
  const editorLines = rawLines(form);
  if (editorLines.length > MAX_LINES) {
    return refuse('validation_failed', `a requisition may have at most ${String(MAX_LINES)} lines`);
  }
  const byId = new Map(catalogue.map((item) => [item.id, item]));
  const lines: DraftLineInput[] = [];
  let seq = 0;
  for (const line of editorLines) {
    seq += 1;
    if (isBlank(line)) {
      continue;
    }
    let item: CatalogueItem | undefined;
    if (line.catalogueItemId.trim() !== '') {
      item = byId.get(line.catalogueItemId.trim());
      if (item === undefined) {
        return refuse('validation_failed', `line ${String(seq)}: that catalogue item is not available`);
      }
      if (item.currency !== currency) {
        return refuse(
          'validation_failed',
          `line ${String(seq)}: that item is priced in ${item.currency}, not ${currency}`,
        );
      }
    }
    const description = line.description.trim() === '' ? (item?.name ?? '') : line.description.trim();
    if (description === '') {
      return refuse('validation_failed', `line ${String(seq)}: say what this line is for`);
    }
    const quantity = quantityOf(line.quantity);
    if (isRefusal(quantity)) {
      return refuse('validation_failed', `line ${String(seq)}: ${quantity.detail ?? 'bad quantity'}`);
    }
    let unitPriceMinor: number;
    if (line.unitPrice.trim() === '') {
      if (item === undefined) {
        return refuse('validation_failed', `line ${String(seq)}: give a unit price`);
      }
      unitPriceMinor = item.unitPriceMinor;
    } else {
      const parsed = parseAmountMinor(line.unitPrice, currency);
      if (isRefusal(parsed)) {
        return refuse('validation_failed', `line ${String(seq)}: ${parsed.detail ?? 'bad price'}`);
      }
      unitPriceMinor = parsed;
    }
    lines.push({
      description,
      quantity,
      unitPriceMinor,
      catalogueItemId: item === undefined ? null : item.id,
    });
  }
  if (lines.length === 0) {
    return refuse('validation_failed', 'a requisition needs at least one line');
  }
  return { costCentreId, lines, editorLines };
}

/** The rows the editor renders: what was typed, plus one blank spare to add a line without JS. */
export function editorLinesWithSpare(lines: readonly EditorLine[]): EditorLine[] {
  const kept = lines.filter((line) => !isBlank(line));
  return [...kept, { catalogueItemId: '', description: '', quantity: '', unitPrice: '' }];
}
