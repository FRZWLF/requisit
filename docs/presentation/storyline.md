# The talk: "From a conversation to main" — the rumble framework on Requisit

Audience: Intershop engineering and product (B2B commerce; agents on the merchant and buyer
side, the PWA, the new commerce core). Length: 30–40 min + demo + Q&A. Everything shown is
real: this repo was built, live or recorded, by the process the talk describes.

## Storyline (one slide = one idea)

1. **The problem is not writing code.** Agents write code fast; what breaks is memory
   (decisions lost in chat), scope (the agent builds what it guessed), and trust (who
   reviewed that?). The framework answers each with a place: docs, an issue, a PR trail.
2. **Three sessions, one repo.** Rumble (think) → task-out (contract) → pipeline (build).
   The rumble never builds; the pipeline never reads code; GitHub is the only shared state.
   *Deck: `site/rumble-to-main.html` slides 1–3 (framework repo).*
3. **Live: a fresh project.** Open the empty `requisit` repo: a `framework.json`, generated
   agents, an empty decisions table, `docs/00-brief.md`. Paste the brief into a rumble
   session. Show the rumble asking back, searching the web (approval-workflow patterns,
   money handling, multi-tenancy pitfalls), writing rows: D-001 stack, D-002 money as minor
   units, G-rows for SSO and currency, the roadmap with phases and the first umbrella.
   *Recording R1 (the rumble is long — show 3 cuts: the first question back, a web search
   turning into a D-row, the roadmap appearing).*
4. **`/task-out`.** The contract. Show one issue: Goal, Context with the D-rows, acceptance
   criteria, tests, out of scope, `Depends on`, the suggested routing. And the umbrella with
   the run order in waves. The session ends here — on purpose.
   *Live: `gh issue view N` in the browser.*
5. **`/pipeline <umbrella>`.** A new session. Triage (cheap model) stamps area/size/risk.
   The architect (only on size:L) posts a 🏛 Design. Implementers in isolated worktrees,
   three at a time, background. Reviewers, verdict lines, a fix round, the gate, the 📋 trail
   with the cost per stage.
   *Replay: `site/replay.html?data=replays/issue-N.json` — the animated trail of one real
   issue exported by `scripts/replay-from-gh.mjs`.*
6. **What a review finds.** One PR with a 🔴 and a 🟡: the finding text, the fix commit,
   the re-review. The reviewer reused the PR's evidence instead of re-running everything.
   *Live: the PR conversation tab.*
7. **The docs after the arc.** The decisions table with rows from the rumble *and* from PRs
   (addenda), a struck-through gap, a measurement with a real number, the research log with
   sources. The checker: `check-anchors.mjs` — a reference without a row fails the board.
8. **The product.** Requisit running: a buyer drafts, the rule matches, an approver rejects
   with a reason, the audit shows it, the agent drafts "20 more of the blue ones" and does
   not submit. Then the umbrella closed on GitHub.
   *Recording R2 (90 s screen capture) — or live if the demo is stable.*
9. **Cost.** M-rows from the trails: tokens per stage, per issue, what the four levers saved
   (rumble ends at task-out, fresh session per arc, ≤ 3 builders, evidence reuse).
   *Deck slide "M-080" with Requisit's numbers instead of Lumos'.*
10. **Bring it to an existing project.** `framework.json`, markers in the guide file,
    `docs.decisions` may point at `docs/adr/`; render; the first rumble reads the ADRs.
    *Doc: `rumble-framework/docs/onboarding-existing-project.md`.*
11. **Several people.** Everyone rumbles; one person per arc orchestrates; the issue is the
    contract, so the author of the rumble and the person running the pipeline can differ;
    CODEOWNERS and `human` decide who the inbox is; `risk:high` PRs get a named reviewer.
12. **Intershop.** Where this fits: agent features on the buyer/merchant side are exactly
    "a decision + a contract + a reviewed PR"; ADRs already exist; the PWA and commerce
    core teams each get their own `framework.json` and implementers, one framework repo.

## Demo script (what to run, in which session, what to record)

| Step | Session | Command / action | Artefact for the talk |
|---|---|---|---|
| 0 | terminal | `git clone FRZWLF/requisit`, `npm i -g`? none — Node ≥ 18 only | the empty repo (screenshot S0) |
| 1 | rumble (new) | paste `docs/00-brief.md`, rumble until decisions D-001…, gaps, roadmap, umbrella | recording R1; docs diff |
| 2 | same | `/task-out` | issues, the umbrella (screenshots S1–S2) |
| 3 | pipeline (new) | `/pipeline <umbrella>` | trails, PRs, findings; `replay-from-gh.mjs` JSON per issue |
| 4 | terminal | `node ../rumble-framework/scripts/replay-from-gh.mjs FRZWLF/requisit <issue> > site/replays/issue-N.json` | the animated replay |
| 5 | terminal | run Requisit, walk the flow | recording R2 |
| 6 | rumble (new) | rumble Arc 2 (agent drafting) → task-out → pipeline | second umbrella, optional |

Recordings: QuickTime screen capture, 1440×900, no audio; cut with the built-in trim.
Screenshots at 2× for the deck.

## Q&A we expect

- *Does the agent decide the architecture?* No — the rumble does, with the person; the
  architect stage only designs inside decided rows and proposes new ones for a human to see.
- *What if the reviewer is wrong?* Two fix rounds, then `needs-human`. The verdict line and
  the evidence are on the PR; a person reads them like any review.
- *Cost?* Slide 9 — real numbers from the trails.
- *Existing ADRs?* Slide 10 — the decisions doc is wherever your ADRs are.
- *Codex or Claude?* Both — one framework, two bindings; Requisit renders both.
