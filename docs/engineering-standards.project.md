## Approval safety (Requisit-specific, non-negotiable)

- A requisition is a buyer's claim on a budget; the service never changes its amount or its
  approver behind the buyer's back. An out-of-authority approval is a typed refusal
  (`not_authorised {rule}`), never a silent downgrade.
- Every state change (submit, approve, reject, cancel, order) leaves an audit line: who, when,
  what, from which organisation, which rule matched. What is not in the audit did not happen.
- Organisations are the tenancy boundary: a query or action that spans organisations carries
  that in its name and is `risk:high`.
- Amounts are integer minor units + currency; totals are computed; rounding is one function.
- The drafting agent may read the catalogue and draft; it submits only as the buyer who asked,
  and it never approves. Its tool calls are audited like a user's actions.
- Tokens and API keys are never in source, logs or the web bundle; they come from the environment.
