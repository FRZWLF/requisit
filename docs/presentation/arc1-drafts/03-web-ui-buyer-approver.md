# The web UI for buyer and approver

## Goal
Four server-rendered pages — buyer list, draft editor, requisition detail with its history, and the
approver queue — that make the rule, the amount and the reason visible before and after a decision.

## Context
Builds on split {{02}}: the same HTTP API, the same typed refusals, the same `OrgScope`. The UI is a
client of the API, not a second implementation of the rules.

Honor D-013 (server-rendered HTML from small template functions + a ~50-line vanilla-JS `fetch`
helper; **no framework, no bundler, no build step**; one hand-written stylesheet served static; all
output through one `esc()` helper — templates take data, never raw HTML; the demo token is entered
once and kept in `sessionStorage`, never in a URL, a log or a query string), D-012 (the same
`node:http` router serves the pages and the static assets), D-016 (a refusal is rendered as a human
sentence carrying its stable `code`; a cross-org id shows the same "not found" page as an unknown
id), D-010 (the client generates an `Idempotency-Key` per user action — a submit/approve/reject
button press — and reuses it on retry, so a double-click is one state change), D-003 (amounts always
rendered with their currency via `formatMoney`; never a bare number), D-009 (a rejection form
requires a reason before it will submit; a rejected requisition offers "copy to a new draft", not
"reopen"), D-007 (the detail page renders the audit history verbatim: actor, action, rule, amount,
timestamp, reason).

**Do NOT**: add React/Vue/Svelte/htmx or any npm package; add a bundler or a CSS framework; put the
token in a URL or a cookie without `HttpOnly`/`SameSite` reasoning written in the PR; re-implement
rule matching or authority checks in the browser (ask the API, render the answer); build HTML by
string concatenation of untrusted values or use `innerHTML` with server data; hide a refusal behind
a generic "something went wrong".

Pages: `GET /` (redirect by role) · `/requisitions` (buyer list, filter by state) ·
`/requisitions/new` and `/requisitions/:id/edit` (draft editor: catalogue picker, quantity, cost
centre, note, live computed total and the rule that would match) · `/requisitions/:id` (detail +
history + the action buttons the actor is actually allowed) · `/approvals` (the approver queue,
oldest first, with amount and matched rule per row).

New rows: none reserved. A `D-` row is expected only if the token-handling choice in the browser
needs to differ from D-013 — in which case write it, do not quietly diverge.

## Acceptance criteria
- [ ] The four routes render valid HTML with no JavaScript required for every **read** path; a test
      asserts the detail and queue pages render fully with the client script removed.
- [ ] The draft editor shows the computed total and the rule that would match, updating when a line
      or quantity changes, and a test asserts the displayed rule equals the API's answer for the
      same input (no second implementation).
- [ ] Escaping: a requisition note, an item name and a rejection reason each containing
      `<img src=x onerror=alert(1)>` and `"><script>` render as text; a test asserts the raw string
      is absent from the response and the escaped form is present, for every template that takes
      free text.
- [ ] Buttons reflect authority: an approver who may not approve this requisition sees no approve
      button **and** a direct POST returns `not_authorised` (the server is the gate; the UI is a
      courtesy) — both asserted.
- [ ] Rejecting requires a reason; the buyer's detail page shows that reason verbatim; the history
      block shows every audit line with actor, rule and amount.
- [ ] Double-clicking submit or approve produces one state change: the client reuses one
      `Idempotency-Key` per action, asserted by a test that fires the same action twice.
- [ ] Every amount on every page carries its currency; a JPY organisation renders no decimals.
- [ ] No token appears in any URL, any server log line, or any rendered page source; a test greps
      the captured log output of a full walkthrough for the token string.
- [ ] `npm ci` installs no runtime dependency and no build step was added; the board is green.

## Test expectations
`node --test` with the router invoked in-process; assertions on the returned HTML string (substring
and absence assertions — no DOM library, no headless browser). A `ui/walkthrough` test drives the
whole buyer→approver→buyer story through the page handlers and asserts what each page shows at each
step. An `ui/escaping` table test covers every free-text field × every template. Accessibility floor
asserted mechanically where it is cheap: every input has a label, every button has text, the page has
a `<title>` and one `<h1>`.

## Out of scope
Visual design beyond a plain, legible stylesheet; mobile-specific work and anything PWA (G-003);
notifications (G-014); the outbox and merchant-facing pages (04) — the merchant has no UI in v1;
admin screens for editing rules or people (seed script only); i18n; the agent (Arc 2).

Depends on: #{{02}}

## Suggested routing
area:web · size:M · risk:medium — triage makes the final call
