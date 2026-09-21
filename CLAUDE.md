# Requisit — agent guide

Requisit is a B2B purchase-requisition and approval service — the example project of the
[rumble-framework](https://github.com/FRZWLF/rumble-framework): a design conversation (the
rumble) becomes decisions and issues, a pipeline of agents builds them, the docs keep the
memory. The framework section below is generated from `framework.json`
(`node ../rumble-framework/render.mjs . --check`); edit the config or the framework, not the block.

<!-- rumble-framework:begin -->
## Dev framework (rumble → task-out → pipeline)

Requisit is built through the rumble framework: a design conversation ends in
`/task-out` (issues on GitHub, decisions in the docs), and a **new
session** runs `/pipeline` (triage → [architect] → implement → review
→ fix loop → gate → trail) with the project agents in `.claude/agents/`. GitHub
objects (issues, labels, branches `feat/issue-N`, draft PRs, comments) are the single source
of truth; nothing relies on chat history. Any CI copies of the pipeline stay switched off.

**Three sessions.** The rumble session thinks, decides and writes rows; it stops at task-out
and never triages, designs, builds or reviews. The pipeline session orchestrates — it never
reads code — in waves of at most 3 builders, and retires when the
umbrella is done. Agent sessions do one job each in an isolated git worktree and end with a
PR or a `VERDICT:` line.

**Model policy (Claude Code).** triage `haiku` ·
architect `fable` (size:L or delegated `D-`rows) · implement
`S` → `sonnet`, `M` → `opus`, `L` →
`opus` · reviews `opus` (quality always,
security only on `risk:high`) · fix rounds `opus` on a
🔴, `sonnet` on nits · the frontier
model the architect's `needs: frontier` line — a protocol or algorithm built from a spec, a third-party API without a working example. At most 2 fix rounds, one
re-reviewer; reviewers reuse the PR's evidence; the full board runs once on `main` after
every merge. FRZWLF authorised merging in their name; `risk:medium|high` PRs are assigned
to FRZWLF for review after the fact via the 📋 trail.

**Verify board.** `npm ci && npm run typecheck && npm test && npm run lint && node ../rumble-framework/scripts/check-anchors.mjs . && node ../rumble-framework/render.mjs . --check` · the stack is decided in the rumble (the first D-row); until then the board is the two docs checks alone

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

- Stack: decided in the rumble (the first D-row) — until then this repo holds docs, the framework and
  the GitHub setup only. Language: English throughout.
- Repo `FRZWLF/requisit` (private). Branches `feat/issue-N`; `main` is always green.
- Docs: `docs/` — vision, decisions (D-), gaps (G-), measurements (M-), research log, roadmap,
  the dev pipeline; `docs/00-brief.md` is the input the rumble started from.
