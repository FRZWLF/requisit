import { esc } from '../esc.ts';
import type { Refusal } from '../../refusal.ts';
import { formatMoney, type Money } from '../../domain/money.ts';
import type { Action } from '../../domain/lifecycle.ts';
import type { RequisitionState } from '../../domain/types.ts';

/**
 * The page shell and the fragments every page shares (D-013). Templates take data and call
 * `esc` on every value; a function here that returned caller-supplied markup would be the
 * hole the escaping table test exists to find.
 */

export interface Chrome {
  /** The signed-in person's name, or `null` on the sign-in page. */
  readonly who: string | null;
  readonly orgName: string | null;
  readonly canBuy: boolean;
}

export function page(input: {
  readonly title: string;
  readonly heading: string;
  readonly chrome: Chrome | null;
  readonly body: string;
}): string {
  const chrome = input.chrome;
  const bar =
    chrome === null
      ? ''
      : `<header class="bar">
<a href="/requisitions">My requisitions</a>
<a href="/approvals">Approvals</a>
${chrome.canBuy ? '<a href="/requisitions/new">New requisition</a>' : ''}
<span class="who">${esc(chrome.who)}${chrome.orgName === null ? '' : ` · ${esc(chrome.orgName)}`}
<form class="inline" method="post" action="/sign-out"><button class="secondary" type="submit">Sign out</button></form>
</span>
</header>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} · Requisit</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
${bar}
<main>
<h1>${esc(input.heading)}</h1>
${input.body}
</main>
<script src="/static/app.js" defer></script>
</body>
</html>
`;
}

/**
 * A refusal as a human sentence carrying its stable code (D-016) — never a generic
 * "something went wrong", and never a code without a sentence.
 */
export function refusalBlock(refusal: Refusal): string {
  return `<div class="refusal" role="alert">
<p>${esc(sentenceFor(refusal))}</p>
<p class="muted">Code: <code>${esc(refusal.code)}</code></p>
</div>`;
}

const SENTENCES: Readonly<Record<string, string>> = {
  not_authorised: 'You may not do that.',
  wrong_state: 'That is not possible in this state.',
  no_rule_matched: 'No approval rule in this organisation covers that amount.',
  idempotency_key_reuse: 'That form was already used for a different action. Reload the page.',
  conflict: 'Somebody changed this requisition while you were looking at it. Reload the page.',
  not_found: 'There is no such requisition.',
  validation_failed: 'That input cannot be accepted.',
  unauthenticated: 'Your session is not valid. Sign in again.',
};

export function sentenceFor(refusal: Refusal): string {
  const head = SENTENCES[refusal.code] ?? 'That request was refused.';
  return refusal.detail === undefined ? head : `${head} ${refusal.detail}`;
}

/** Every amount is rendered here, with its currency, and nowhere else (D-003). */
export function amount(money: Money): string {
  return esc(formatMoney(money));
}

export function stateBadge(state: RequisitionState): string {
  return `<span class="state">${esc(state)}</span>`;
}

const ACTION_LABELS: Readonly<Record<Action, string>> = {
  edit: 'Edit',
  submit: 'Submit for approval',
  cancel: 'Cancel',
  approve: 'Approve',
  reject: 'Reject',
  copy: 'Copy to a new draft',
  order: 'Order',
};

export function actionLabel(action: Action): string {
  return ACTION_LABELS[action];
}

/**
 * The hidden fields every mutating form carries: the idempotency key the server minted for
 * *this* rendering of the page, so a double-click — or a retry from a flaky train — is one
 * state change (D-010), and the version the caller saw, so an edit made meanwhile is a
 * `conflict` rather than a silent overwrite.
 */
export function actionFields(key: string, version: number | null): string {
  const versionField =
    version === null ? '' : `<input type="hidden" name="version" value="${esc(version)}">`;
  return `<input type="hidden" name="idempotencyKey" value="${esc(key)}">${versionField}`;
}
