# 01 · Vision

Requisit is a small, honest purchase-requisition and approval service that a B2B shop can sit
in front of. A buyer builds a requisition from a catalogue, the service decides — by written
rules, not by a spreadsheet — who has to approve it, an approver approves or rejects with a
reason the buyer sees, and the approved requisition becomes an order the merchant side picks
up. Nothing else.

The thing it replaces is an e-mail thread plus a spreadsheet of "who may approve how much".
The thing it must never become is a workflow engine: Requisit models one approval step, one
rule table per organisation, one order handoff. Everything larger is a gap row, not a feature.

## The users

| User | What they do | What they need from us |
|---|---|---|
| **Buyer** | Drafts a requisition (SKU, quantity, unit price, cost centre, note), submits it, watches it | To see, before submitting, who will have to approve and why; to see a rejection reason in words |
| **Approver** (cost-centre owner) | Sees what is waiting for them, approves or rejects with a reason | To know their authority exactly, and to be refused loudly rather than quietly let through |
| **Finance approver** | The step above the cost-centre owner for large amounts | The same, plus the audit: who approved what, under which rule, at which amount |
| **Merchant** (the shop backend) | Polls for approved requisitions and turns them into orders | An ordered, acknowledged, replay-safe feed — never a duplicate order, never a lost one |

An **admin** exists only to maintain the rule table, cost centres and people of one
organisation. There is no cross-organisation role at all (D-004).

## What "honest" means

The word is the product, so it is defined here and every decision is measured against it:

1. **The record is the truth.** If the requisition says "approved by Anna under rule R2 at
   14:02 for 1 240,00 EUR", then Anna, that rule, that minute and that amount are what the
   audit table holds — written in the same transaction as the state change (D-007). What is
   not in the audit did not happen.
2. **A refusal is typed, never silent.** An approval outside someone's authority is
   `not_authorised {rule}`, not a downgrade, not a shrug (D-009, D-016).
3. **Money is exact.** Integer minor units and a currency on every amount; totals are
   computed from lines, never stored as a second truth; one rounding function (D-003).
4. **An organisation cannot see another one.** Not "should not" — the repository layer
   cannot express a query without an organisation, and a test proves it (D-004).
5. **A retry is not a second event.** Submitting or approving twice, because a phone lost
   the network, produces one state change and one audit line (D-010).
6. **The agent (Arc 2) is a drafting hand, not an authority.** It reads the catalogue and
   writes drafts as the buyer who asked; it never submits unasked and never approves.

## Non-goals

- Not a BPMN / workflow engine: no parallel branches, no ad-hoc approver graphs, no
  escalation timers. One ordered rule table, first match wins (D-008).
- Not a commerce backend: no catalogue master data, no pricing engine, no invoices, no
  receipting. The catalogue is a read-only seeded table; the order handoff is an outbox the
  shop polls (D-011).
- Not an identity provider: v1 issues signed personal tokens from a seeded people table.
  SSO is G-001, not a v1 compromise.
- Not multi-currency arithmetic: one currency per organisation in v1 (G-002).
- Not a notification system: no e-mail, no push. The approver sees a queue when they look.
- Not a scale target: one instance, one SQLite file, one writer (D-002). Postgres is G-004.
