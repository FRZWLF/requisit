# Requisit — the brief (the rumble's input)

*What a person types or pastes at the start of the rumble session: everything they know
about the wish. The rumble turns it into a vision, decisions, gaps, a roadmap and issues.*

Our customers' buyers order on account, and above a certain amount someone has to approve
before the order goes out. Today that lives in e-mail threads and a spreadsheet of "who may
approve how much". I want a small, honest service for that — a purchase-requisition and
approval flow that a B2B shop can sit in front of.

- A **buyer** in an organisation creates a requisition: line items from a catalogue
  (SKU, quantity, unit price), a cost centre, a note. They can save a draft and submit it.
- **Approval rules** per organisation: up to X the buyer's own authority; up to Y the cost
  centre owner; above that a named finance approver. The rule that matched is visible on the
  requisition. An approver approves or rejects **with a reason the buyer sees**.
- On approval the requisition becomes an **order** for the merchant side — for v1 that is a
  webhook or an outbox the shop polls; the real commerce backend comes later.
- An **agent for the buyer**: "order 20 more of the blue ones like last month" → a draft
  requisition the buyer reviews and submits. The agent never submits or approves on its own.
- Later: a merchant-side agent that answers "why is this stuck?", reorder suggestions,
  SSO, multi-currency, a PWA for approvers on the phone.

Constraints and taste:

- One container, one database (SQLite is fine for v1, the design must allow Postgres).
- Roles for v1 via signed personal tokens; SSO later — the design must not paint us in.
- Many organisations on one instance from day one; an organisation must never see
  another's data — that is the one thing that would end the project.
- Money must be right: no floats, one rounding rule, a currency on every amount.
- Honest: if it says "approved by Anna under rule R2 at 14:02", that is exactly what happened.
- Team: three developers and a product person; decisions written down where the next person
  finds them; every PR reviewed; the docs are the memory, not the chat.
