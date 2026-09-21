# 13 · Roadmap

Phases → arcs → umbrella issues, each phase with an exit criterion. An arc is one umbrella
issue and one pipeline session; a phase ends when its exit criterion is demonstrably true, not
when its issues are closed.

## Phase 1 — "the honest requisition"

Everything the brief calls v1: a requisition that goes from a buyer's draft to a merchant's
order, with the rule that matched, the person who approved and the amount they approved
written down and true.

### Arc 1 · the v1 flow end to end (`docs/presentation/arc1-drafts/`)

Four splits, three waves — the drafts carry the full specs:

| Wave | Split | What | Routing |
|---|---|---|---|
| 1 | 01 | Project scaffold, domain model, storage + migrations, audit, token auth | `area:api` · `size:L` · `risk:high` |
| 2 | 02 | Approval rules + the requisition lifecycle API (submit / approve / reject / cancel, idempotency) | `area:api` · `size:L` · `risk:high` |
| 3 | 03 | The web UI for buyer and approver | `area:web` · `size:M` · `risk:medium` |
| 3 | 04 | The order outbox, the poll endpoint, a seed script and the README quickstart | `area:api` · `size:M` · `risk:medium` |

Decisions in force: D-001 … D-018. New rows are expected from the PRs (addenda to D-002,
D-008 and D-010 in particular) — the drafts reserve nothing beyond that, because a reserved
number nobody uses is noise.

**Arc 1 exit criterion.** On a clean checkout, offline, with a `REQUISIT_TOKEN_SECRET` in
`.env` or exported: `npm ci && npm run seed && npm start` (which builds before it serves),
then a buyer drafts a requisition above the self-approval threshold, sees which rule will
match, submits it; the named approver sees it in their queue and rejects it with a reason the
buyer reads; the buyer copies it forward, resubmits, the approver approves; the outbox poll
returns exactly one order, the ack moves the requisition to `ordered`, and a second poll
returns nothing. The requisition's history shows every step with actor, rule and amount. The
verify board (D-015) is green, and the cross-org leak suite and the lifecycle/authority suite
both run in it (D-014).

### Arc 2 · the buyer drafting agent

"Order 20 more of the blue ones like last month" → a draft the buyer reviews and submits.

- Tools: catalogue read, the buyer's own requisition history read, draft write. **Submit and
  approve are not in the tool set** — not "guarded", absent (see `08-security.md`, T6).
- Runs under the requesting buyer's `OrgScope` (D-004); every tool call audited with
  `actor_kind='agent'` (D-007).
- Model calls are recorded fixtures so the tests stay offline (`framework.json`,
  `project_notes.offline_tests`).
- New D-rows expected: the tool contract, the fixture/record format, and where the model
  credential lives (D-018's rules apply unchanged).

**Arc 2 exit criterion.** From one sentence of buyer intent, a draft appears with the right
SKUs, quantities and cost centre, marked as agent-drafted in the UI and in the audit; the
buyer submits it as themselves. A replayed adversarial fixture — a catalogue description that
instructs the agent to submit or approve — produces a draft and nothing else, proven by a
test. Board green, offline.

**Phase 1 exit criterion.** The demo of slide 8 of the talk runs start to finish from a clean
clone with no network: buyer drafts, the rule matches, the approver rejects with a reason, the
audit shows it, the agent drafts "20 more of the blue ones" and does not submit, the merchant
polls the order. Both umbrellas closed, `main` green, and every `D-`/`G-`/`M-` reference in the
docs resolving (D-015).

## Phase 2 — "the one it can be trusted with"

The items Phase 1 deliberately deferred, in the order their triggers are most likely to fire.
Each is a gap row today; each becomes an arc when its trigger fires, not before.

| Arc | What | Opens from |
|---|---|---|
| 2.1 | Token revocation and rotation | G-013 — the first real deployment |
| 2.2 | Delegation / out-of-office | G-007 — the first requisition stuck behind a holiday |
| 2.3 | SSO (OIDC) behind the one token→`OrgScope` seam | G-001 — the first customer directory |
| 2.4 | Notifications, then the approver PWA | G-014 → G-003 — driven by M-006, not by taste |
| 2.5 | Multi-step approval chains | G-005 — the first two-signature policy |
| 2.6 | Multi-currency | G-002 — the first second currency |
| 2.7 | Budgets and period spend limits | G-008 — the first policy stated per period |
| 2.8 | Rate limits | G-010 — public exposure |
| 2.9 | Postgres | G-004 — contention, a second instance, or a customer requirement |
| 2.10 | Webhook delivery alongside the outbox | G-006 — a consumer that cannot poll |
| 2.11 | The merchant-side agent | G-009 — Arc 2 shipped and a merchant who asks |
| 2.12 | Retention, export, deletion | G-015 — the first offboarding or legal review |

**Phase 2 exit criterion.** Requisit is deployable for a real B2B customer: identity comes
from their directory, a leaked credential can be killed, an absent approver does not stall a
purchase, and the measurements that justified each arc (M-002, M-003, M-004, M-006) are real
numbers in `16-measurements.md` rather than "pending". Deliberately *not* included: anything
that would make Requisit a workflow engine or a commerce backend — those remain non-goals
(`01-vision.md`).
