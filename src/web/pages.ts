import { isRefusal, refuse, type Refusal, type Result } from '../refusal.ts';
import { newId } from '../ids.ts';
import { withTransaction, type Tx } from '../db/tx.ts';
import { hasRole } from '../db/scope.ts';
import { idempotencyKeysRepo } from '../db/repos/idempotency.ts';
import { endpointOf, fingerprintOf, isIdempotencyKey } from '../http/idempotency.ts';
import type { HttpResponse } from '../http/types.ts';
import {
  approve,
  cancel,
  copyForward,
  createDraft,
  detail as detailOf,
  list,
  reject,
  submit,
  updateDraft,
  type RequisitionDetail,
} from '../app/requisitions.ts';
import { REQUISITION_STATES, type RequisitionState } from '../domain/types.ts';
import type { Action } from '../domain/lifecycle.ts';
import { CLIENT_SCRIPT, STYLESHEET } from './assets.ts';
import { amountField } from './amount.ts';
import {
  catalogueOf,
  chromeOf,
  costCentresOf,
  currencyOf,
  hostOf,
  lookupsFor,
  serviceOf,
  type AuthedContext,
  type WebContext,
} from './context.ts';
import { editorLinesWithSpare, parseDraftForm } from './draft-form.ts';
import { parseForm, type Form } from './form.ts';
import { previewOf, previewRefusalText, type Preview } from './preview.ts';
import { asset, html, json, redirect, statusOf } from './respond.ts';
import { clearedCookie, scopeFor, sessionCookie } from './session.ts';
import { page, refusalBlock, type Chrome } from './views/layout.ts';
import { approvalQueue, buyerList } from './views/lists.ts';
import { detailPage } from './views/detail.ts';
import { editorPage, type EditorLine } from './views/editor.ts';
import { signInPage } from './views/signin.ts';

/**
 * The page handlers (D-013). Each one reads what it needs, calls the **same** use case in
 * `src/app/requisitions.ts` the JSON API calls, and renders the answer — authority, the
 * state machine, rule matching and the audit line are never decided here. A refusal becomes
 * a page carrying the human sentence and the stable code (D-016).
 */

function errorPage(chrome: Chrome | null, refusal: Refusal): HttpResponse {
  return html(
    statusOf(refusal),
    page({
      title: refusal.code === 'not_found' ? 'Not found' : 'Refused',
      heading: refusal.code === 'not_found' ? 'Not found' : 'That did not happen',
      chrome,
      body: refusalBlock(refusal),
    }),
  );
}

export function notFoundPage(): HttpResponse {
  return errorPage(null, refuse('not_found', 'there is no page at this address'));
}

function refusedFor(ctx: AuthedContext, refusal: Refusal): HttpResponse {
  return errorPage(chromeOf(ctx), refusal);
}

function formOf(ctx: WebContext): Result<Form> {
  return parseForm(ctx.request.body, ctx.request.headers['content-type']);
}

/**
 * One mutating form post, with the D-010 ledger the JSON API uses. The key is a hidden
 * field the server rendered into the form, so the browser reuses exactly one key per user
 * action — a double-click, a reload of the POST or a retry is one state change. A `303`
 * stores its `Location` (the page is regenerated on replay); anything else stores the page.
 */
function runAction(ctx: AuthedContext, key: string, run: (tx: Tx) => HttpResponse): HttpResponse {
  const fingerprint = fingerprintOf(ctx.request.method, ctx.url.pathname, ctx.request.body);
  return withTransaction(ctx.app.db, (tx) => {
    const keys = idempotencyKeysRepo(ctx.app.db, ctx.scope, ctx.app.clock);
    const endpoint = endpointOf(ctx.request.method, ctx.pattern);
    const seen = keys.find(endpoint, key);
    if (seen !== undefined) {
      if (seen.fingerprint !== fingerprint) {
        // Not stored: a reuse refusal must not overwrite the answer the key already owns.
        return refusedFor(
          ctx,
          refuse('idempotency_key_reuse', 'reload the page and try again'),
        );
      }
      return seen.status === 303 ? redirect(seen.body) : html(seen.status, seen.body);
    }
    const response = run(tx);
    keys.insert(tx, {
      endpoint,
      key,
      fingerprint,
      status: response.status,
      body: response.status === 303 ? (response.headers['Location'] ?? '/') : response.body,
    });
    return response;
  });
}

function keyFrom(form: Form): Result<string> {
  const key = form.get('idempotencyKey');
  if (!isIdempotencyKey(key)) {
    return refuse('validation_failed', 'this form is stale — reload the page');
  }
  return key;
}

function versionFrom(form: Form): Result<number | undefined> {
  const raw = form.get('version').trim();
  if (raw === '') {
    return undefined;
  }
  if (!/^[0-9]{1,15}$/.test(raw)) {
    return refuse('validation_failed', 'that form carried no usable version');
  }
  return Number(raw);
}

// ── sign in / sign out ──────────────────────────────────────────────────────────────────

export function signIn(): HttpResponse {
  return html(200, page({ title: 'Sign in', heading: 'Sign in', chrome: null, body: signInPage(null) }));
}

export function signInSubmit(ctx: WebContext): HttpResponse {
  const form = formOf(ctx);
  if (isRefusal(form)) {
    return errorPage(null, form);
  }
  const scope = scopeFor(ctx.app, form.get('token').trim());
  if (isRefusal(scope)) {
    return html(
      statusOf(scope),
      page({ title: 'Sign in', heading: 'Sign in', chrome: null, body: signInPage(scope) }),
    );
  }
  const cookie = sessionCookie(form.get('token').trim(), hostOf(ctx.request));
  if (isRefusal(cookie)) {
    return errorPage(null, cookie);
  }
  return redirect('/', { 'Set-Cookie': cookie });
}

export function signOut(ctx: WebContext): HttpResponse {
  return redirect('/sign-in', { 'Set-Cookie': clearedCookie(hostOf(ctx.request)) });
}

// ── read pages ──────────────────────────────────────────────────────────────────────────

/** `/` sends a buyer to their own requisitions and anybody else to the shared queue. */
export function root(ctx: AuthedContext): HttpResponse {
  return redirect(hasRole(ctx.scope, 'buyer') ? '/requisitions' : '/approvals');
}

function stateFromQuery(url: URL): Result<RequisitionState | null> {
  const raw = url.searchParams.get('state');
  if (raw === null || raw === '') {
    return null;
  }
  const hit = REQUISITION_STATES.find((state) => state === raw);
  return hit === undefined ? refuse('validation_failed', 'that is not a requisition state') : hit;
}

export function requisitions(ctx: AuthedContext): HttpResponse {
  const state = stateFromQuery(ctx.url);
  if (isRefusal(state)) {
    return refusedFor(ctx, state);
  }
  const found = list(serviceOf(ctx), { mine: true, ...(state === null ? {} : { state }) });
  if (isRefusal(found)) {
    return refusedFor(ctx, found);
  }
  return html(
    200,
    page({
      title: 'My requisitions',
      heading: 'My requisitions',
      chrome: chromeOf(ctx),
      body: buyerList({
        items: found.items,
        selected: state,
        lookups: lookupsFor(ctx.app.db, ctx.scope),
      }),
    }),
  );
}

/** The approver queue: what this caller may decide, oldest wait first. */
export function approvals(ctx: AuthedContext): HttpResponse {
  const found = list(serviceOf(ctx), { awaitingMe: true });
  if (isRefusal(found)) {
    return refusedFor(ctx, found);
  }
  const items = [...found.items].sort((left, right) =>
    (left.submittedAt ?? '').localeCompare(right.submittedAt ?? ''),
  );
  return html(
    200,
    page({
      title: 'Approvals',
      heading: 'Waiting for your decision',
      chrome: chromeOf(ctx),
      body: approvalQueue({ items, lookups: lookupsFor(ctx.app.db, ctx.scope) }),
    }),
  );
}

function renderDetail(
  ctx: AuthedContext,
  found: RequisitionDetail,
  refusal: Refusal | null,
): HttpResponse {
  return html(
    refusal === null ? 200 : statusOf(refusal),
    page({
      title: `Requisition ${found.number}`,
      heading: `Requisition ${found.number}`,
      chrome: chromeOf(ctx),
      body: detailPage({
        detail: found,
        lookups: lookupsFor(ctx.app.db, ctx.scope),
        // One fresh key per form per rendering: two different buttons on one page must not
        // share a key, or the second would replay the first one's answer (D-010).
        keyFor: (_action: Action) => newId(),
        refusal,
      }),
    }),
  );
}

export function requisitionDetail(ctx: AuthedContext): HttpResponse {
  const found = detailOf(serviceOf(ctx), ctx.params['id'] as string);
  return isRefusal(found) ? refusedFor(ctx, found) : renderDetail(ctx, found, null);
}

// ── the draft editor ────────────────────────────────────────────────────────────────────

function editor(
  ctx: AuthedContext,
  input: {
    readonly action: string;
    readonly costCentreId: string;
    readonly lines: readonly EditorLine[];
    readonly currency: string;
    readonly version: number | null;
    readonly preview: Preview | null;
    readonly previewText: string;
    readonly refusal: Refusal | null;
    readonly heading: string;
    readonly status: number;
  },
): HttpResponse {
  return html(
    input.status,
    page({
      title: input.heading,
      heading: input.heading,
      chrome: chromeOf(ctx),
      body: editorPage({
        action: input.action,
        costCentres: costCentresOf(ctx),
        catalogue: catalogueOf(ctx),
        costCentreId: input.costCentreId,
        lines: editorLinesWithSpare(input.lines),
        currency: input.currency,
        idempotencyKey: newId(),
        version: input.version,
        preview: input.preview,
        previewText: input.previewText,
        refusal: input.refusal,
      }),
    }),
  );
}

const BLANK_LINE: EditorLine = { catalogueItemId: '', description: '', quantity: '', unitPrice: '' };

export function newDraft(ctx: AuthedContext): HttpResponse {
  const currency = currencyOf(ctx);
  if (isRefusal(currency)) {
    return refusedFor(ctx, currency);
  }
  const centres = costCentresOf(ctx);
  return editor(ctx, {
    action: '/requisitions',
    costCentreId: centres[0]?.id ?? '',
    lines: [BLANK_LINE],
    currency,
    version: null,
    preview: null,
    previewText: 'Add a line to see the total and the rule.',
    refusal: null,
    heading: 'New requisition',
    status: 200,
  });
}

export function editDraft(ctx: AuthedContext): HttpResponse {
  const id = ctx.params['id'] as string;
  const found = detailOf(serviceOf(ctx), id);
  if (isRefusal(found)) {
    return refusedFor(ctx, found);
  }
  if (!found.actions.includes('edit')) {
    return refusedFor(
      ctx,
      found.state === 'draft'
        ? refuse('not_authorised', 'this draft is not yours to edit', { requisitionId: id })
        : refuse('wrong_state', `a ${found.state} requisition cannot be edited`, {
            requisitionId: id,
          }),
    );
  }
  const preview = previewOf(
    ctx.app.db,
    ctx.scope,
    found.currency,
    found.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      catalogueItemId: line.catalogueItemId,
    })),
  );
  return editor(ctx, {
    action: `/requisitions/${id}/edit`,
    costCentreId: found.costCentreId,
    lines: found.lines.map((line) => ({
      catalogueItemId: line.catalogueItemId ?? '',
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: amountField(line.unitPriceMinor, line.currency),
    })),
    currency: found.currency,
    version: found.version,
    preview: isRefusal(preview) ? null : preview,
    previewText: isRefusal(preview) ? previewRefusalText(preview) : '',
    refusal: null,
    heading: `Edit requisition ${found.number}`,
    status: 200,
  });
}

interface EditorPost {
  readonly form: Form;
  readonly currency: string;
  readonly action: string;
  readonly heading: string;
  readonly version: number | null;
}

/** The `Recalculate` button, and the refusal path — both re-render the editor as typed. */
function reEditor(
  ctx: AuthedContext,
  post: EditorPost,
  refusal: Refusal | null,
  status: number,
): HttpResponse {
  const lines = parseDraftForm(post.form, catalogueOf(ctx), post.currency);
  const typed: EditorLine[] = [
    ...post.form.getAll('description').map((description, index) => ({
      catalogueItemId: post.form.getAll('catalogueItemId')[index] ?? '',
      description,
      quantity: post.form.getAll('quantity')[index] ?? '',
      unitPrice: post.form.getAll('unitPrice')[index] ?? '',
    })),
  ];
  const preview = isRefusal(lines)
    ? lines
    : previewOf(ctx.app.db, ctx.scope, post.currency, lines.lines);
  return editor(ctx, {
    action: post.action,
    costCentreId: post.form.get('costCentreId'),
    lines: typed.length === 0 ? [BLANK_LINE] : typed,
    currency: post.currency,
    version: post.version,
    preview: isRefusal(preview) ? null : preview,
    previewText: isRefusal(preview) ? previewRefusalText(preview) : '',
    refusal: refusal ?? (isRefusal(lines) ? lines : null),
    heading: post.heading,
    status,
  });
}

function editorPost(ctx: AuthedContext, existing: RequisitionDetail | null): HttpResponse {
  const form = formOf(ctx);
  if (isRefusal(form)) {
    return refusedFor(ctx, form);
  }
  const currency = existing === null ? currencyOf(ctx) : existing.currency;
  if (isRefusal(currency)) {
    return refusedFor(ctx, currency);
  }
  const post: EditorPost = {
    form,
    currency,
    action: existing === null ? '/requisitions' : `/requisitions/${existing.id}/edit`,
    heading: existing === null ? 'New requisition' : `Edit requisition ${existing.number}`,
    version: existing === null ? null : existing.version,
  };
  if (form.get('action') !== 'save') {
    return reEditor(ctx, post, null, 200);
  }
  const key = keyFrom(form);
  if (isRefusal(key)) {
    return reEditor(ctx, post, key, statusOf(key));
  }
  const parsed = parseDraftForm(form, catalogueOf(ctx), currency);
  if (isRefusal(parsed)) {
    return reEditor(ctx, post, parsed, statusOf(parsed));
  }
  const version = versionFrom(form);
  if (isRefusal(version)) {
    return reEditor(ctx, post, version, statusOf(version));
  }
  return runAction(ctx, key, (tx) => {
    const written =
      existing === null
        ? createDraft(serviceOf(ctx), tx, {
            costCentreId: parsed.costCentreId,
            lines: parsed.lines,
          })
        : updateDraft(serviceOf(ctx), tx, existing.id, {
            costCentreId: parsed.costCentreId,
            lines: parsed.lines,
            ...(version === undefined ? {} : { version }),
          });
    if (isRefusal(written)) {
      return reEditor(ctx, post, written, statusOf(written));
    }
    return redirect(`/requisitions/${written.id}`);
  });
}

export function createRequisition(ctx: AuthedContext): HttpResponse {
  return editorPost(ctx, null);
}

export function updateRequisition(ctx: AuthedContext): HttpResponse {
  const found = detailOf(serviceOf(ctx), ctx.params['id'] as string);
  return isRefusal(found) ? refusedFor(ctx, found) : editorPost(ctx, found);
}

/**
 * What the client script asks for on every keystroke: the server's total and the server's
 * matched rule for the lines as they stand. It writes nothing, so it needs no key; it
 * answers `200` with a sentence even when the lines do not add up, so the editor can say
 * *why* instead of going quiet.
 */
export function preview(ctx: AuthedContext): HttpResponse {
  const form = formOf(ctx);
  if (isRefusal(form)) {
    return json(400, { totalText: '—', ruleText: previewRefusalText(form) });
  }
  const currency = currencyOf(ctx);
  if (isRefusal(currency)) {
    return json(400, { totalText: '—', ruleText: previewRefusalText(currency) });
  }
  const parsed = parseDraftForm(form, catalogueOf(ctx), currency);
  if (isRefusal(parsed)) {
    return json(200, { totalText: '—', ruleText: parsed.detail ?? previewRefusalText(parsed) });
  }
  const answer = previewOf(ctx.app.db, ctx.scope, currency, parsed.lines);
  if (isRefusal(answer)) {
    return json(200, { totalText: '—', ruleText: previewRefusalText(answer) });
  }
  return json(200, {
    totalText: answer.totalText,
    ruleText: answer.ruleText,
    ruleCode: answer.ruleCode,
  });
}

// ── the decisions ───────────────────────────────────────────────────────────────────────

type Decision = 'submit' | 'approve' | 'reject' | 'cancel' | 'copy';

function decisionHandler(which: Decision) {
  return (ctx: AuthedContext): HttpResponse => {
    const id = ctx.params['id'] as string;
    const form = formOf(ctx);
    if (isRefusal(form)) {
      return refusedFor(ctx, form);
    }
    const key = keyFrom(form);
    if (isRefusal(key)) {
      return refusedFor(ctx, key);
    }
    const version = versionFrom(form);
    if (isRefusal(version)) {
      return refusedFor(ctx, version);
    }
    const reason = form.get('reason');
    return runAction(ctx, key, (tx) => {
      const service = serviceOf(ctx);
      const input = {
        ...(version === undefined ? {} : { version }),
        ...(reason === '' ? {} : { reason }),
      };
      const moved =
        which === 'submit'
          ? submit(service, tx, id, input)
          : which === 'approve'
            ? approve(service, tx, id, input)
            : which === 'reject'
              ? reject(service, tx, id, input)
              : which === 'cancel'
                ? cancel(service, tx, id, input)
                : copyForward(service, tx, id);
      if (!isRefusal(moved)) {
        // `copy` lands on the **new** draft; every other decision stays on this requisition.
        return redirect(`/requisitions/${moved.id}`);
      }
      // The reason a decision was refused belongs on the page it was refused from, with the
      // requisition still in front of the person (D-016) — never a bare error page.
      const still = detailOf(service, id);
      return isRefusal(still) ? refusedFor(ctx, still) : renderDetail(ctx, still, moved);
    });
  };
}

export const submitRequisition = decisionHandler('submit');
export const approveRequisition = decisionHandler('approve');
export const rejectRequisition = decisionHandler('reject');
export const cancelRequisition = decisionHandler('cancel');
export const copyRequisition = decisionHandler('copy');

// ── static assets ───────────────────────────────────────────────────────────────────────

export function stylesheet(): HttpResponse {
  return asset('text/css; charset=utf-8', STYLESHEET);
}

export function clientScript(): HttpResponse {
  return asset('text/javascript; charset=utf-8', CLIENT_SCRIPT);
}
