# 08 · Security

Threat model, written by the rumble and refined by every `risk:high` PR: who may do what to a
requisition, where tokens live, what an organisation can never see, what the agent may touch.

The product's claim is honesty (`01-vision.md`). Every threat below is a way of making the
record lie, so security here is not a layer on top of the feature — it *is* the feature.

## Actors

| Actor | Trust | Reaches | Notes |
|---|---|---|---|
| **Buyer** | authenticated, low authority | their own organisation's catalogue, their own requisitions, the shared queue view | may create, edit a draft, submit, cancel their own |
| **Approver** (cost-centre owner) | authenticated, authority bounded by the matched rule | their organisation's requisitions awaiting their decision | the one actor who can move money |
| **Finance approver** | authenticated, the widest authority in an org | their organisation, unbounded thresholds | the terminal rule row (D-008) |
| **Org admin** | authenticated, configuration authority | rule rows, cost centres, people/roles of **one** organisation | can change *future* authority; never retroactively (D-007) |
| **Merchant integration** | authenticated service token | the outbox feed and its acknowledgement (D-011) | reads approved requisitions; writes nothing but acks |
| **Drafting agent** (Arc 2) | delegated, acts *as* a buyer | catalogue read, draft write, and only that | never submits unasked, never approves |
| **Operator** | full host access | the database file, the environment, the logs | out of scope to defend against; in scope to not tempt (D-018) |
| **Network attacker / other tenant** | unauthenticated or another org's valid token | the public HTTP surface only | the actor the rest of this document is about |

## Assets

1. **Approval authority** — the ability to make a requisition `approved`. The crown jewel.
2. **The audit trail** — the record of who approved what, when, under which rule (D-007).
3. **Cross-organisation confidentiality** — the existence, content, amounts, suppliers and
   people of another organisation (D-004).
4. **Amounts** — line prices, quantities, totals (D-003).
5. **Token secret** — `REQUISIT_TOKEN_SECRET`; whoever holds it is everyone (D-005, D-018).
6. **The order feed** — approved requisitions on their way to becoming real purchases (D-011).

## Top threats

| # | Threat | Scenario | Mitigation | Residual |
|---|---|---|---|---|
| T1 | **Cross-org read** | A valid token for org B requests org A's requisition id, or a report path forgets its `org_id` filter | `OrgScope`-constructed repositories — an unscoped query cannot be expressed; no SQL outside `src/db/`; every index `(org_id, …)` (D-004). Mandatory A/B leak suite on the board (D-014, D-015). Cross-org answers are `not_found`, never `403`, so ids cannot be probed (D-016); business ids are random, not sequential (D-017) | SQLite has no row-level security, so the enforcement is structural + tested rather than engine-level. G-004 is where the engine takes over. **risk:high** |
| T2 | **Authority escalation** | An approver approves above their threshold; a buyer approves their own requisition; an admin edits a rule row *after* submission to widen authority | The rule matched at submission is resolved server-side and **stored on the requisition** by `rule_id` and re-read from there (D-008), so a later **insert** of a new rule row is not retroactive — an `UPDATE` of the referenced row itself still is, which no v1 surface can do (rows are seeded, there is no route and no CLI) and **G-018** holds; the approve handler re-checks the stored rule against the actor; roles are read from the database per request, not from the token (D-005, D-006). Out-of-authority is a typed `not_authorised {rule}` — never a downgrade (D-009, D-016) | An org admin can still widen *future* authority; that is their job, and the change lands in the audit. **risk:high** |
| T3 | **Amount tampering** | A requisition is approved at 900 and ordered at 9 000 — by editing after approval, by a float rounding drift, or by a currency mix-up | Submitted requisitions are immutable; edits exist only on drafts (D-009). Totals are computed from lines, never stored as a second truth, in integer minor units with the currency attached (D-003). The audit line records `total_minor` + `currency` **as approved** (D-007), and the outbox payload is built from the same transaction (D-011) | Catalogue price changes between draft and submission change the total — by design; the buyer sees the total they submit and the approver sees the total they approve. **risk:high** |
| T4 | **Replay of approve** | A retried or duplicated `POST /approve` produces two approvals, two audit lines, two outbox rows — two orders | `Idempotency-Key` with `UNIQUE (org_id, endpoint, key)` + request fingerprint, stored response replayed verbatim (D-010); the key row is written in the *same* transaction as the state change (D-007), so a crash cannot leave a key without its effect or an effect without its key. The separate `version` guard turns two *different* concurrent approvals into one success and one `409 conflict` | The merchant must still dedup on outbox `id` — delivery is at-least-once by design (D-011). **risk:high** |
| T5 | **Token leakage / forgery** | A token is pasted into a chat, logged by a proxy, or forged because the secret is weak, default, or compared non-constant-time | Secret from the environment only, ≥ 32 bytes, **no default — the process refuses to start without it** (D-018); HMAC-SHA256 with `timingSafeEqual`; `kid` allows a second key without a format change (D-005). Tokens never in URLs, logs, error bodies or HTML; one redacting log function (D-013, D-018). Authority is re-read from the database, so stripping a role takes effect on the next request even while the token is still valid | A leaked token is valid until `exp` — there is no revocation in v1. That is the honest gap, and it is **G-013 with a high priority**, not a shrug. **risk:high** |
| T6 | **Agent misuse** (Arc 2) | The drafting agent is steered by a poisoned catalogue description or a crafted note into submitting, approving, or drafting for another buyer | The agent has no authority of its own: its tools run under the requesting buyer's `OrgScope`, and the tool set contains catalogue read and draft write **only** — submit and approve are not exposed to it at all, so a prompt injection has no tool to reach for. Every agent tool call is audited with `actor_kind='agent'` and the human on whose behalf it ran (D-007). Model output is data: it is validated into typed draft lines before it touches the database, and it is escaped, never rendered as markup (D-013, D-016) | The agent can still draft something wrong — which is why a human submits. The catalogue is first-party data in v1; a third-party catalogue feed would reopen this as a new threat. **risk:high** |
| T7 | **Stored XSS / HTML injection** | A rejection reason or an item note containing markup is rendered into the approver's page | One `esc()` helper; templates take data and never raw HTML; no `innerHTML` with server data in the ~50 lines of client JS (D-013) | Reviewed on every UI PR; a template that builds HTML from a string is a red finding. **risk:medium** |
| T8 | **Denial of service** | One token loops requests; a huge JSON body or a 10 000-line requisition stalls the single synchronous writer | Hard body size limit and line-count limit at the boundary (D-012); everything validated and typed before it reaches the domain. No rate limiting in v1 — **G-010**, with public exposure as its trigger | A single-container synchronous service is stallable by a determined authenticated client. Named, not hidden. **risk:medium** |
| T9 | **Merchant feed abuse** | A merchant token reads the outbox of an organisation it does not serve, or acks rows it never received | The outbox endpoint is scoped like everything else (D-004); `ack {through_id}` only ever moves the cursor forward and is itself idempotent (D-010, D-011) | A merchant token is a service credential and inherits T5 entirely. **risk:high** |
| T10 | **Audit forgery or loss** | An audit line is edited or deleted to change history, or is written outside the transaction and lost on rollback | Append-only by construction: no `UPDATE`/`DELETE` against `audit_log` anywhere in the repository layer, asserted by a test; written in the same transaction as the state change (D-007) | An operator with the database file can rewrite anything — out of scope (see Actors); integrity beyond that (hash chaining, external anchoring) is deliberately not v1 | 

## What is `risk:high`

Per `framework.json` and repeated here so a reviewer does not have to look it up — every PR
that touches any of these is `risk:high` and gets the security review:

- authentication, token issuing or validation (D-005, D-018)
- roles and approval authority: rule matching, the approve/reject path (D-006, D-008, D-009)
- **anything that crosses an organisation** — a query, an endpoint, a script, a migration (D-004)
- anything that approves, cancels or changes an amount (D-003, D-009)
- agent tools that write (Arc 2)
- secrets, configuration validation, CI/CD

A `risk:high` PR is merged in FRZWLF's name and assigned to FRZWLF for review after the fact
via the 📋 trail. The mandatory suites for these PRs are the cross-org leak suite and the
lifecycle/authority suite (D-014).
