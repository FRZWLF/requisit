# Arc 1 — the honest requisition, end to end

## Goal
Ship Requisit v1: a buyer's draft becomes a submitted requisition, an ordered rule table names the
approver, the approver approves or rejects with a reason, and the approved requisition leaves as
exactly one order — with the rule, the person and the amount written down and true.

## Context
The whole arc runs inside the rumble's decisions D-001 … D-018 (`docs/02-decisions.md`) and the
vision's non-goals (`docs/01-vision.md`). The load-bearing ones, because they constrain every split:
D-001 zero runtime dependencies · D-002 `node:sqlite`, one file, one writer · D-003 integer minor
units + currency, totals computed · D-004 the organisation is the boundary, enforced by the
repository seam and the leak suite · D-005/D-006 signed personal tokens, roles read live ·
D-007 the audit line in the same transaction · D-008 ordered threshold rules, first match wins ·
D-009 one state machine, terminal rejection · D-010 idempotency keys + a version guard ·
D-011 outbox + poll, no webhook · D-012/D-013 `node:http` and server-rendered HTML, no frameworks ·
D-014/D-015 `node --test` and the board.

**Not in this arc**, and not to be smuggled in: the drafting agent (Arc 2), SSO (G-001),
multi-currency arithmetic (G-002), a PWA (G-003), Postgres (G-004), approval chains (G-005),
webhooks (G-006), delegation (G-007), budgets (G-008), rate limits (G-010), token revocation
(G-013), notifications (G-014). Each has a trigger in `docs/14-gap-analysis.md`; none of them
fires during Arc 1.

The threat model for this arc is `docs/08-security.md`: T1 cross-org read, T2 authority escalation,
T3 amount tampering, T4 replay of approve and T5 token leakage are the reasons splits 01, 02 and 04
carry the risk labels they carry.

Measurements this arc opens: M-001 (board time), M-002/M-003 (read p95, approve p95 at 10k),
M-004 (handoff latency), M-005 (domain coverage), M-007/M-009 (pipeline cost and split size). They
stay "pending" until something is built — do not fill them with estimates.

## Acceptance criteria
- [ ] #{{01}} — project scaffold, domain model, storage + audit, token auth (`area:api` · L · high)
- [ ] #{{02}} — approval rules + the requisition lifecycle API (`area:api` · L · high)
- [ ] #{{03}} — the web UI for buyer and approver (`area:web` · M · medium)
- [ ] #{{04}} — the order outbox, the poll endpoint, the seed script and the README quickstart (`area:api` · M · medium)
- [ ] Run order: **wave 1 = {{01}}** · **wave 2 = {{02}}** · **wave 3 = {{03}} + {{04}}** (parallel).
      Nothing in wave 2 starts before wave 1 is merged; wave 3's two splits touch disjoint files.
- [ ] Every merged PR left `main` green on the full board, and the two mandatory suites — the
      cross-org leak suite and the lifecycle/authority suite (D-014) — are in it and growing.
- [ ] The docs are still honest at the end: every `D-`/`G-`/`M-` reference resolves
      (`check-anchors.mjs`), and any decision a PR made that the rumble did not is a new row or an
      addendum, not a silent divergence.

## Test expectations
Per split, as specified in each draft; `node --test`, offline, no live service, no browser. The arc's
own test is `flow/end-to-end` in {{04}}: the README walkthrough executed as code.

## Out of scope
Everything listed as "not in this arc" above; deployment, Docker and CI workflows; visual design;
performance work — Arc 1 opens the measurement rows, it does not chase them.

## Exit criterion
On a clean checkout, **offline**: `npm ci && npm run seed && npm start`, then a buyer drafts a
requisition above the self-approval threshold and sees which rule will match; submits it; the named
approver finds it in their queue and rejects it with a reason the buyer reads; the buyer copies it
forward, resubmits, the approver approves; the outbox poll returns exactly one order, the ack moves
the requisition to `ordered`, and a second poll returns nothing. The requisition's history shows
every step with actor, rule and amount. The verify board (D-015) is green.

## Suggested routing
area:api · size:L · risk:high — triage makes the final call
