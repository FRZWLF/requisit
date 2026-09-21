# 16 · Measurements

Numbers worth keeping: question, setup, result, what the result changes. Newest first.
Unmeasured reads "pending" — never a target dressed as a result. The pipeline's own cost per
issue is a measurement too (the 📋 trails feed it).

All rows below were opened by the Arc 1 rumble on 2026-09-21 and are **pending**: nothing has
been built yet, so there is nothing to measure. They are listed by id because they all share
one date.

### M-001 · Verify board wall-clock time

- **Question:** how long does `npm ci && npm run typecheck && npm test && npm run lint` plus the
  two docs checks take on a cold worktree, and on a warm one? A board an agent dreads is a
  board that gets skipped.
- **Setup:** MacBook, Node 24 LTS, a fresh `git worktree` of `main` with no `node_modules`
  (cold) and immediately again (warm). Three runs each, report median and the per-step split
  from `time` around each command.
- **Result:** pending.
- **What it changes:** above ~90 s cold, split the board (a fast pre-commit subset vs the full
  board) or cache `node_modules` across worktrees; it also feeds the disk/time budget for
  parallel builders.

### M-002 · Read path p95 (requisition list and detail)

- **Question:** what is the p95 server time for the buyer list and the requisition detail on a
  realistic database, and does a single busy client move it (D-002 is one synchronous writer)?
- **Setup:** seeded database with 20 organisations × 500 requisitions (10 000 total), 5 lines
  each; an in-process driver issuing 2 000 requests over the router, then the same with one
  concurrent writer looping submit/approve. Report p50/p95/p99 per endpoint.
- **Result:** pending.
- **What it changes:** a p95 that degrades under one writer is the first evidence for G-004
  (Postgres) or for a read connection separate from the write connection; a stable p95 closes
  the question for v1. Also the load half of G-010.

### M-003 · Approve transaction p95 at 10 000 requisitions

- **Question:** how long does the approve path take end to end in the service — rule match,
  authority check, state change, audit line, outbox row, idempotency key — all in one
  transaction (D-007, D-010, D-011)?
- **Setup:** the same 10 000-requisition seed as M-002; 1 000 approvals through the domain
  layer with a fixed clock, WAL on, `synchronous=NORMAL`. Measure the transaction only, then
  the full HTTP round trip, and report both p50 and p95.
- **Result:** pending.
- **What it changes:** the number that says whether "everything in one transaction" is
  affordable. If p95 exceeds ~25 ms the first thing to examine is the indexes `(org_id, …)`
  from D-004, not the transaction boundary — the boundary is not negotiable.

### M-004 · Order handoff latency (approval → merchant acknowledgement)

- **Question:** with a merchant polling every *n* seconds, how long from `approved` to
  `ordered`, and how much of that is our side?
- **Setup:** the seed script plus a loop that polls `GET /api/v1/outbox` at 1 s, 5 s and 30 s
  intervals while approvals are generated; measure the two intervals separately (approval →
  row visible, row visible → ack committed).
- **Result:** pending.
- **What it changes:** the evidence for or against G-006 (a webhook). If our own side is
  sub-millisecond and the wait is the poll interval, the honest answer is "poll faster", not
  "build a webhook".

### M-005 · Test coverage of the domain layer

- **Question:** what fraction of `src/domain/` (rules, lifecycle, money) is covered by
  `node --test --experimental-test-coverage`, and which branches are not?
- **Setup:** the full suite on `main` after Arc 1 merges; record line and branch coverage for
  `src/domain/` and `src/db/` separately from the rest.
- **Result:** pending.
- **What it changes:** whether a coverage threshold enters the board (D-015 deliberately set
  none). A threshold is only worth adding once there is a measured baseline to set it below.

### M-006 · Human approval wait (submitted → decided)

- **Question:** how long does a requisition actually wait for a person, split by rule
  (`self` / `cost_centre_owner` / `finance`)?
- **Setup:** computed from the audit table (D-007) once real or demo usage exists:
  `to_state='submitted'` to the next decision line, p50/p95 per `rule_id`. No instrumentation
  needed — the audit already holds it, which is the point.
- **Result:** pending — needs usage, not a benchmark.
- **What it changes:** the trigger for G-003 (a PWA), G-007 (delegation) and G-014
  (notifications). Which of the three to build is a question this number answers and guessing
  does not.

### M-007 · Pipeline cost per issue (Arc 1)

- **Question:** what does one issue cost from triage to merge — tokens and money per stage
  (triage, architect, implement, review, fix, gate) — and how does it split by size label?
- **Setup:** the 📋 trail comment of each of the four Arc 1 issues; sum per stage, normalise
  per issue and per 1 000 changed lines. Record the model used per stage alongside, so a later
  model-policy change is comparable.
- **Result:** pending.
- **What it changes:** the model policy in `framework.json` (which stages deserve the large
  model) and the size of future splits. It is also slide 9 of the talk, which is a reason to
  get it right rather than round it.

### M-008 · Cost of the rumble session itself

- **Question:** what did this rumble — research, decisions, gaps, roadmap, threat model, four
  issue drafts — cost, and how does that compare to one implementation issue (M-007)?
- **Setup:** the session's own token accounting for the Arc 1 rumble, recorded once the
  session ends; note the number of web searches and the number of rows produced.
- **Result:** pending.
- **What it changes:** the claim that "thinking is the cheap part" — either it is evidence for
  the framework's first lever (the rumble ends at task-out) or it is a correction to it.

### M-009 · Arc 1 size per split

- **Question:** how close do the four Arc 1 splits come to the ~3 000-line ceiling
  (`limits.split_lines`), and did any split need a second PR?
- **Setup:** `git diff --shortstat` per merged PR, plus the number of review rounds each took.
- **Result:** pending.
- **What it changes:** how the next rumble cuts an arc. A split that lands far under the
  ceiling with two fix rounds says the ceiling is not the binding constraint — review surface
  is.

### M-010 · Database size per 10 000 requisitions

- **Question:** how large is the SQLite file (and its WAL) for 10 000 requisitions with lines,
  audit lines and outbox rows — and how much of it is the audit?
- **Setup:** the M-002 seed; `PRAGMA page_count`, per-table size via `dbstat`, before and
  after a `VACUUM`.
- **Result:** pending.
- **What it changes:** the retention question (G-015) and the backup story; it is also the
  honest input to G-004 rather than a feeling that "SQLite gets big".
