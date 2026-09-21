# Requisit — agent guide (Codex)

Requisit is a B2B purchase-requisition and approval service — the example project of the
[rumble-framework](https://github.com/FRZWLF/rumble-framework): a design conversation (the
rumble) becomes decisions and issues, a pipeline of agents builds them, the docs keep the
memory. The framework section below is generated from `framework.json`
(`node ../rumble-framework/render.mjs . --check`); edit the config or the framework, not the block.

<!-- rumble-framework:begin -->
## Dev framework (rumble → task-out → pipeline)

Requisit is built through the rumble framework: a design conversation ends in
`$task-out` (issues on GitHub, decisions in the docs), and a **new
session** runs `$pipeline` (triage → [architect] → implement → review
→ fix loop → gate → trail) with the project agents in `.codex/agents/`. GitHub
objects (issues, labels, branches `feat/issue-N`, draft PRs, comments) are the single source
of truth; nothing relies on chat history. Any CI copies of the pipeline stay switched off.

**Three sessions.** The rumble session thinks, decides and writes rows; it stops at task-out
and never triages, designs, builds or reviews. The pipeline session orchestrates — it never
reads code — in waves of at most 3 builders, and retires when the
umbrella is done. Agent sessions do one job each in an isolated git worktree and end with a
PR or a `VERDICT:` line.

**Model policy (OpenAI Codex).** triage `gpt-5.6-luna` ·
architect `gpt-5.6-sol` (size:L or delegated `D-`rows) · implement
`S` → `gpt-5.6-luna`, `M` → `gpt-5.6-terra`, `L` →
`gpt-5.6-sol` · reviews `gpt-5.6-sol` (quality always,
security only on `risk:high`) · fix rounds `gpt-5.6-sol` on a
RED, `gpt-5.6-terra` on nits · the frontier
model never in a delegated stage — Astra is reserved for the rumble session and chosen by Rico there; no delegated stage runs above `high`. At most 2 fix rounds, one
re-reviewer; reviewers reuse the PR's evidence; the full board runs once on `main` after
every merge. FRZWLF authorised merging in their name; `risk:medium|high` PRs are assigned
to FRZWLF for review after the fact via the 📋 trail.

**Verify board.** `npm ci && npm run typecheck && npm test && npm run lint && node ../rumble-framework/scripts/check-anchors.mjs . && node ../rumble-framework/render.mjs . --check` · TypeScript on Node 24 LTS, one package, zero runtime dependencies (D-001) — `npm ci` installs devDependencies only; storage is the built-in `node:sqlite` (D-002), so there is no native build step. Tests are `node --test` and run offline against an in-memory database (D-014). Mandatory when the diff touches `src/db/`, `src/domain/rules` or the approve/reject path: the cross-org leak suite and the lifecycle/authority suite must be green (D-004, D-014) — a red result is a 🔴 of the review.

## Documentation discipline (part of "done")

- Architecture-shaping choices → new `D-xxx` row in `docs/02-decisions.md`; append-only,
  later PRs add addenda; issues reserve numbers so parallel work never collides.
- Open questions → `G-xxx` in `docs/14-gap-analysis.md` with the trigger that reopens them; closed
  rows are struck through with the closing `D-`reference.
- Any number worth keeping → `M-xxx` in `docs/16-measurements.md`; unmeasured reads "steht
  aus", never a target dressed as a result. The pipeline's own cost is a measurement too.
- Research that changed a decision → `docs/15-research-log.md` with sources.
- A task that changes what a doc describes updates that doc in the same branch. A reference
  without an anchor (a row, a test, a lever that does not exist) is a red finding.
- Standards: `docs/engineering-standards.md` — binding for every agent; on conflicts of safety it wins.

## Conventions

- Conventional commits; no AI co-author trailers. Branches `feat/issue-N`; `main` is always
  green. Secrets only via environment or ignored config — never in source, issues, PRs,
  logs or docs. Tests run offline.
<!-- rumble-framework:end -->

## Repo facts

- **Stack** (D-001): TypeScript on Node 24 LTS, one package, ESM, **zero runtime dependencies** —
  devDependencies are typescript, eslint and `@types/node` only. Source in `src/`, `tsc` to `dist/`.
- **Storage** (D-002): the built-in `node:sqlite` (`DatabaseSync`), one file, one write connection,
  WAL + `busy_timeout=5000` + `foreign_keys=ON`, `STRICT` tables, forward-only migrations in
  `src/db/migrations/`. No native dependency, no build step. Tests use `:memory:`.
- **HTTP** (D-012) `node:http` with a small table router; **UI** (D-013) server-rendered HTML plus a
  little vanilla JS — no framework, no bundler. **Tests** (D-014) `node --test`, `tsc --noEmit`, eslint.
- **Money** (D-003): integer minor units + an ISO 4217 code on every amount; totals computed, never stored.
- **Tenancy** (D-004): the organisation is the boundary — every business table carries `org_id`, no SQL
  outside `src/db/`, repositories are constructed from an `OrgScope`, and the cross-org leak suite is
  part of the board. **Auth v1** (D-005): signed personal tokens (HMAC-SHA256), secret from the
  environment; roles read from the database per request (D-006).
- **Audit** (D-007): an append-only line written in the same transaction as every state change.
- Verify board: see the generated block above (D-015). Language: English throughout.
- Repo `FRZWLF/requisit` (private). Branches `feat/issue-N`; `main` is always green.
- Docs: `docs/` — vision (`01`), decisions (D-), gaps (G-), measurements (M-), research log, roadmap,
  the threat model (`08-security.md`), the dev pipeline; `docs/00-brief.md` is the input the rumble
  started from.
