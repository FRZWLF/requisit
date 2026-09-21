# The order outbox, the poll endpoint, the seed script and the README quickstart

## Goal
Turn an approval into exactly one order for the merchant side — an outbox row written in the
approving transaction, a cursor-based poll, an acknowledgement that moves the requisition to
`ordered` — and make the whole v1 flow runnable from a clean clone in three commands.

## Context
Builds on split {{02}}: the approve path, the transaction helper, `writeAudit`, the idempotency
machinery and the typed refusals already exist. This split adds the row at the end of that
transaction and the two endpoints that drain it.

Honor D-011 (`order_outbox` with `id` (monotonic INTEGER cursor), `org_id`, `requisition_id`,
`payload_json`, `created_at`, `delivered_at`, `ack_by`; the row is written **in the approving
transaction**; `GET /api/v1/outbox?after=<id>&limit=n` with a merchant-scoped token;
`POST /api/v1/outbox/ack {through_id}` moves the requisition to `ordered` and stamps `delivered_at`;
delivery is **at-least-once** and the merchant dedups on `id`; **no webhook** — G-006 holds the
trigger), D-009 (`ordered` is set here and only here; `approved → ordered` is the only edge into it),
D-007 (the ack writes an audit line per requisition it orders), D-010 (the ack is idempotent: the
cursor only moves forward, and a replayed ack is a no-op returning the same response), D-004 (the
outbox is scoped like everything else — a merchant token for org B never sees org A's rows), D-003
(the payload carries integer minor units and the currency, and the total is recomputed from the
lines at payload build time, not copied from a cache), D-017 (the cursor is an integer *because* it
must be ordered; business ids stay random), D-018 (the seed script reads `.env`, the service never
does; the script prints tokens to stdout once and never writes them to a file in the repo).

**Do NOT**: emit a webhook, add a retry/backoff engine, or introduce a queue; mark `ordered` at
approval time; delete outbox rows on ack (stamp them — the feed stays replayable); let the ack move
the cursor backwards; build the payload from anything other than the requisition's own lines; commit
a `.env`, a token, or a database file; make the seed script bypass the `OrgScope` repositories.

The seed script (`npm run seed`) creates: two organisations (one EUR, one JPY — the exponent-0 case
must exist in the demo), a handful of catalogue items each, cost centres with owners, a buyer, an
approver, a finance approver and a merchant integration per org, and a three-row rule table per org
(`self` up to a small amount, `cost_centre_owner` up to a larger one, `finance` unbounded — the
terminal row D-008 requires). It prints the minted tokens and the URLs to open.

New rows: none reserved. An addendum to D-011 is expected if the payload shape needs fields this
issue did not name.

## Acceptance criteria
- [ ] Approving writes exactly one `order_outbox` row in the same transaction; a fault injected
      after the state change and before commit leaves **no** row, no audit line and no state change
      (one test proves all three together).
- [ ] `GET /api/v1/outbox?after=0` returns rows in `id` order; `after=<last id>` returns the
      remainder; `limit` is honoured and capped; an empty feed returns an empty list, not an error.
- [ ] A requisition never appears twice in one drain, and re-polling from an older cursor returns
      the same rows with the same payloads (replayable).
- [ ] `POST /api/v1/outbox/ack {through_id}` moves every acknowledged requisition to `ordered`,
      stamps `delivered_at` and `ack_by`, and writes one audit line each; a second identical ack is a
      no-op with the same response; a `through_id` lower than the current cursor is a no-op, not an
      error; a `through_id` the caller never received is `validation_failed`.
- [ ] A merchant token for org B polling or acking against org A's rows sees nothing and changes
      nothing — asserted in the cross-org leak suite.
- [ ] A buyer or approver token cannot call either outbox endpoint (`not_authorised`).
- [ ] The payload's total equals the sum of the line totals recomputed at build time, carries the
      currency, and a JPY requisition renders exponent 0 correctly end to end.
- [ ] `npm run seed` is idempotent (a second run does not duplicate organisations) and works
      offline against a fresh database file.
- [ ] The README quickstart works verbatim on a clean clone with no network beyond `npm ci`:
      install, seed, start, then the full walkthrough — draft → submit → reject with a reason → copy
      forward → approve → poll → ack → `ordered` — with the exact commands and the URLs to open.
      A test executes the API half of that walkthrough end to end.
- [ ] The board is green; still no runtime dependency.

## Test expectations
`node --test`, in-process, `:memory:` for unit tests and a temp-file database for the seed and
quickstart tests (cleaned up afterwards). Suites: `outbox/transactional` (including the fault
injection), `outbox/cursor` (ordering, limits, replay, backwards ack), `outbox/tenancy` (extends the
mandatory cross-org leak suite), `seed/idempotent`, `flow/end-to-end` (the README walkthrough as
code — the Arc 1 exit criterion expressed as a test). No network, no listening port except the one
integration test that binds `127.0.0.1:0`.

## Out of scope
Webhooks and any push delivery (G-006); retries, backoff, dead-lettering; a real commerce backend or
any external call; the merchant-side agent (G-009); a merchant UI; Docker images and deployment;
rate limiting (G-010); the buyer drafting agent (Arc 2).

Depends on: #{{02}}

## Suggested routing
area:api · size:M · risk:medium — triage makes the final call
