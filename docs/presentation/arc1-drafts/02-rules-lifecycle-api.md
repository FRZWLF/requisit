# Approval rules and the requisition lifecycle API

## Goal
Make a requisition move — draft, submit, approve, reject, cancel — through an ordered rule table,
one state machine, one transaction per transition, and idempotent HTTP endpoints.

## Context
Builds on split {{01}}: the `OrgScope` repositories, `writeAudit`, the money helpers, the token
verifier and the typed refusal type already exist and are reused, not re-created.

Honor D-008 (rule rows `(org_id, seq, max_total_minor NULL = unbounded, approver_kind ∈
{self, cost_centre_owner, finance}, rule_code)`; walk by `seq` ascending, first row whose
`max_total_minor` is NULL or ≥ the total wins; each org **must** have a terminal unbounded row;
`approver_kind='self'` auto-approves at submission with its own audit line; the matched `rule_code`
is shown before submission and **stored on the requisition** at submission), D-009 (states
`draft → submitted → approved | rejected | cancelled`, `approved → ordered`; one table-driven state
machine; `rejected` and `cancelled` are terminal and a rejected requisition is **copied forward** to
a new draft, never reopened; a rejection requires a non-empty reason ≤ 500 chars; `ordered` is set by
the outbox ack in {{04}}, never by the approver), D-010 (`Idempotency-Key` on every mutating
endpoint, `UNIQUE (org_id, endpoint, key)` + a request fingerprint, stored status and body replayed
verbatim, a different fingerprint is `409 idempotency_key_reuse`, the key row is written **in the
same transaction** as the state change, rows swept after 24 h; plus an optimistic `version` guard on
approve/reject returning `409 conflict`), D-012 (`node:http` + a table router, JSON bodies with a
hard size limit, one auth step, one error mapper), D-016 (stable codes `not_authorised`,
`wrong_state`, `no_rule_matched`, `idempotency_key_reuse`, `conflict`, `not_found`,
`validation_failed`; **a cross-org id is `not_found`, never `403`**), D-004, D-007, D-017.

**Do NOT**: add a web framework or a validation library (D-012, D-001); let an admin's later rule
edit change an already-submitted requisition (the stored rule is the one re-checked at approval);
allow a buyer to approve their own requisition unless the matched rule is literally `self`; mark a
requisition `ordered` here; edit a submitted requisition (edits exist on drafts only); throw for a
refusal (refusals are returned values); write the audit line outside the transaction.

Endpoints (the contract splits 03 and 04 build on):
`POST /api/v1/requisitions` (create draft) · `PATCH /api/v1/requisitions/:id` (draft only) ·
`GET /api/v1/requisitions?state=&mine=&awaiting_me=` · `GET /api/v1/requisitions/:id` (includes the
computed total, the matched-or-stored rule, and the audit history) ·
`POST /api/v1/requisitions/:id/submit` · `/approve` · `/reject` · `/cancel` ·
`GET /api/v1/rules` (the org's rule table, read-only in this split).

New rows: none reserved. An addendum to D-008 or D-010 is expected if rule resolution or the
fingerprint needs a shape this issue did not name — append it in this branch.

## Acceptance criteria
- [ ] `matchRule(orgRules, totalMinor)` is a pure function with table-driven tests: below the first
      threshold, exactly on a threshold (≥ is inclusive — assert it), between rows, above every
      bounded row, and an org **without** a terminal unbounded row → `no_rule_matched`.
- [ ] `GET /api/v1/requisitions/:id` on a draft returns the rule that *would* match; after submission
      it returns the rule that *was* stored, and a test edits the org's rule table between the two
      and shows the stored answer does not change.
- [ ] The state machine is one table; every `(state, action, actor)` triple is covered by a test,
      and an illegal transition returns `wrong_state {from, action}` — including approve on a draft,
      approve twice, cancel after approval, and reject without a reason (`validation_failed`).
- [ ] Authority: an approver who is not the resolved approver gets `not_authorised {rule}`; a buyer
      approving their own requisition gets `not_authorised` unless the matched rule is `self`; a
      `self`-matched submission lands `approved` with two audit lines (submit, approve) and an
      actor of `system` on the automatic one.
- [ ] Idempotency: the same key + same body replays the first response byte-for-byte and creates no
      second audit line; the same key + a different body is `409 idempotency_key_reuse`; a missing
      key on a mutating endpoint is `validation_failed`; a forced failure mid-transaction leaves
      neither the key nor the state change (test with an injected fault).
- [ ] Concurrency: two approvals with different keys and the same stale `version` produce exactly one
      `approved` and one `409 conflict`; the audit holds exactly one approval line.
- [ ] Cross-org: every endpoint called with org B's token against org A's id returns `not_found`
      with no timing or body difference from a genuinely unknown id; the leak suite from {{01}} is
      extended to cover all of them.
- [ ] Every transition writes exactly one audit line carrying actor, `actor_kind`, `from_state`,
      `to_state`, `rule_id`, `total_minor`, `currency`, `reason` and `request_id` (D-007).
- [ ] Rejecting then copying forward produces a **new** draft with the same lines and a link to the
      rejected one; the rejected requisition is unchanged and still terminal.
- [ ] The board is green; `npm ci` still installs no runtime dependency.

## Test expectations
`node --test`, in-process: the router is invoked with constructed request objects (no listening port
in unit tests), one integration test binds `127.0.0.1:0` to prove the server wires up. Fixed `Clock`,
`:memory:` database per test. New suites: `domain/rules`, `domain/lifecycle`, `http/idempotency`,
`http/authority`, `http/tenancy`. The **lifecycle/authority suite** and the extended **cross-org leak
suite** are the two mandatory suites named in D-014 — a red result in either is a 🔴 of the review.
Include a fault-injection test for the transaction boundary and a table-driven refusal-code test that
asserts every code in D-016 is produced by at least one path.

## Out of scope
HTML, CSS and anything a browser renders (03); the outbox rows and the poll/ack endpoints and the
`ordered` state transition (04); the seed script (04); rule *editing* endpoints (admins edit rows via
the seed script in v1); notifications; the agent.

Depends on: #{{01}}

## Suggested routing
area:api · size:L · risk:high — triage makes the final call
