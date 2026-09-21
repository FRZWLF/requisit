# 16 · Measurements

Numbers worth keeping: question, setup, result, what the result changes. Newest first.
Unmeasured reads "pending" — never a target dressed as a result. The pipeline's own cost per
issue is a measurement too (the 📋 trails feed it).

The rows below were opened by the Arc 1 rumble on 2026-09-21. All of them are still
**pending** except M-001, which took its first data point from issue #2. They are listed by
id because they all share one date.

### M-001 · Verify board wall-clock time

- **Question:** how long does `npm ci && npm run typecheck && npm test && npm run lint` plus the
  two docs checks take on a cold worktree, and on a warm one? A board an agent dreads is a
  board that gets skipped.
- **Setup:** MacBook, Node 24 LTS, a fresh `git worktree` of `main` with no `node_modules`
  (cold) and immediately again (warm). Three runs each, report median and the per-step split
  from `time` around each command.
- **Result:** first data point, from issue #2's own board runs — the implementer's machine
  (MacBook, Apple silicon), Node v25.2.1 (the repository targets Node 24 LTS, D-001), a
  `git worktree` of `feat/issue-2`, 86 tests. The npm *cache* was warm — only
  `node_modules/` was deleted before the cold run, which is what an agent's fresh worktree
  on this machine actually looks like. **One run per column, not the three-run median
  the setup above asks for; the median is still pending.**

  | Step | Cold (no `node_modules`) | Warm |
  |---|---|---|
  | `npm ci` | 0.5 s | 0.5 s |
  | `npm run typecheck` | 0.6 s | 0.6 s |
  | `npm test` | 0.4 s | 0.4 s |
  | `npm run lint` (builds `dist/` first, D-019) | 0.8 s | 0.8 s |
  | `check-anchors.mjs` | 0.05 s | 0.05 s |
  | `render.mjs --check` | 0.04 s | 0.04 s |
  | **total** | **2.4 s** | **2.5 s** |

- **What it changes:** above ~90 s cold, split the board (a fast pre-commit subset vs the full
  board) or cache `node_modules` across worktrees; it also feeds the disk/time budget for
  parallel builders. At 2.4 s the board is nowhere near that threshold, so nothing changes yet — but the interesting part of the number is *why*: three devDependencies and no transpile step (D-001, D-019) are what keep `npm ci` under a second. The figure to watch is what happens once the npm cache is cold or the suite grows past a few hundred tests.

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
- **Result:** **half measured (#5, 2026-09-21), half pending.** The *approval → row visible*
  interval is zero by construction and not a number: the outbox row is written in the
  approving transaction (D-011), so the row is visible the instant the approval is. What was
  measured is the other half of "how much of that is our side": the two server-side
  transactions, in-process through the real route table (`dispatch`, no listening port),
  against a temp-file database with the D-002 pragmas, on the implementer's machine
  (MacBook, Apple silicon), Node v25.2.1, one run, `n = 1 000` approve/poll/ack cycles on a
  freshly seeded organisation.

  | Transaction | p50 | p95 | max |
  |---|---|---|---|
  | approve — state change + audit line + outbox row, one commit | 0.297 ms | 0.380 ms | 14.0 ms |
  | acknowledge — state change + audit line + stamp, one commit | 0.232 ms | 0.291 ms | 6.7 ms |

  The maxima are single outliers (the first commits after the WAL is created). **Not
  measured:** the poll interval itself, a real HTTP round trip over a socket, and any
  concurrency — the loop is one merchant polling one organisation with nothing else writing.
  The 1 s / 5 s / 30 s poll-interval sweep the setup above asks for is still pending, and it
  is the half that dominates the end-to-end wait.

  One number came out of the build rather than out of the benchmark: an earlier version of
  the acknowledgement scanned every outbox row up to `through_id`, and its p95 was 1.85 ms at
  `n = 300` and rising with the history. Bounding the work window to `cursor < id ≤
  through_id` made it 0.29 ms at `n = 1 000` and flat. That is the D-011 addendum's reason
  for what `ordered` contains, measured rather than asserted.
- **What it changes:** the evidence for or against G-006 (a webhook). Our own side is
  ~0.5 ms for both halves together, which is three to four orders of magnitude under any
  plausible poll interval — so on this evidence the honest answer to "the handoff is too
  slow" is "poll faster", not "build a webhook". G-006's trigger stays the consumer that
  *cannot* poll; the pending half of this row is what would change that.

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
- **Result (2026-09-21, four issues, one arc, Claude Code Max subscription — tokens as the harness reported per agent, no money figure because the subscription has no per-token price):**

  | issue | size | tokens | of which implement | reviews (first) | fix rounds | re-reviews |
  |---|---|---|---|---|---|---|
  | #2 | L | 806 746 | 215 628 | 212 165 | 117 814 | 113 205 |
  | #3 | L | 1 248 237 | 315 524 | 264 988 | 276 882 | 150 823 |
  | #4 | M | 399 131 | 213 897 | 115 302 | 0 | 0 |
  | #5 | M | 936 870 | 310 852 | 216 383 | 185 210 | 151 023 |
  | **arc** | | **3 390 984** | 1 055 901 (31 %) | 808 838 (24 %) | 579 906 (17 %) | 415 051 (12 %) |

  By stage across the arc: triage (haiku, 8 runs) 249 143 · architect (fable, 2 runs) 282 145 · implement 1 055 901 · first reviews 808 838 · fix rounds 579 906 · re-reviews 415 051. Per issue: 847 746 average; per 1 000 merged lines (15 286 lines): 221 837. The two risk:high issues with a red finding cost 2.3–3.1× the one issue without.
- **What it changes:** the model policy in `framework.json` (which stages deserve the large
  model) and the size of future splits. It is also slide 9 of the talk, which is a reason to
  get it right rather than round it.

### M-008 · Cost of the rumble session itself

- **Question:** what did this rumble — research, decisions, gaps, roadmap, threat model, four
  issue drafts — cost, and how does that compare to one implementation issue (M-007)?
- **Setup:** the session's own token accounting for the Arc 1 rumble, recorded once the
  session ends; note the number of web searches and the number of rows produced.
- **Result (2026-09-21):** 111 974 tokens on opus for the whole rumble — 6 web searches + 2 fetches, 18 D-rows, 15 G-rows, 10 M-rows, the vision, the threat model, the roadmap and the four issue drafts. That is 13 % of an average Arc 1 issue (M-007) and 28 % of the cheapest one. The thinking *is* the cheap part; what it bought is visible in M-007's fix rounds, which were all about things the rumble had not decided (refusal-before-write, actor in the idempotency key, merchant scope) rather than about decided rows.
- **What it changes:** the claim that "thinking is the cheap part" — either it is evidence for
  the framework's first lever (the rumble ends at task-out) or it is a correction to it.

### M-009 · Arc 1 size per split

- **Question:** how close do the four Arc 1 splits come to the ~3 000-line ceiling
  (`limits.split_lines`), and did any split need a second PR?
- **Setup:** `git diff --shortstat` per merged PR, plus the number of review rounds each took.
- **Result (2026-09-21):** #2 4 164 lines (L, 1 fix round) · #3 5 502 (L, 1 fix round, the fixer ran as two agents) · #4 3 177 (M, no fix round) · #5 2 443 (M, 1 fix round). Both size:L splits overran the ~3 000-line ceiling; both times the orchestrator kept one PR because the design's cut point would have left a first half over the ceiling anyway and cost a second risk:high review round. No split needed a second fix round. Test volume, not feature volume, is what overran: #3 was 2 616 lines of `src/` and 2 820 of `test/`. The ceiling should count `src/` lines, or the next rumble should cut L issues into an API half and a tests-plus-hardening half.
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
