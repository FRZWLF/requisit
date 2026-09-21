# 15 · Research log

Research that changed a decision: date, question, sources, evidence, conclusion, the D-/G-/M-
rows it produced. Newest last.

---

## 2026-09-21 · Is `node:sqlite` stable enough to be the only database in a small service?

**Question.** We want zero native dependencies (no `node-gyp`, no postinstall). Node 24 ships
`node:sqlite` — is it settled enough to build on, and what does its API force on the design?

**Sources.**
- https://nodejs.org/api/sqlite.html (official API documentation, read 2026-09-21)
- https://www.hirenodejs.com/blog/nodejs-builtin-sqlite-node-sqlite-2026
- https://kloubot.com/blog/nodejs-24-sqlite-esm-production-ready

**Evidence.**
- Stability **1.2 — release candidate**: "the API is settled barring significant issues".
  Added in v22.5.0, no longer behind `--experimental-sqlite`.
- The surface we need is the settled core: `new DatabaseSync(path, options)` with
  `enableForeignKeyConstraints` (default on), `timeout` (busy timeout), `readOnly`,
  `readBigInts`; `db.exec()`, `db.prepare()` → `StatementSync.get/all/iterate/run`.
  The newer corners (`backup()`, `function()`/`aggregate()`, `returnArrays`, `limits`,
  sessions) are the parts most likely to move — and we need none of them.
- **All APIs are strictly synchronous**; there are no async variants, and a long query blocks
  the event loop.
- Integer handling: JS `number` is exact to 2^53-1; reading an INTEGER outside that range
  without `readBigInts: true` throws `ERR_OUT_OF_RANGE` — a loud failure, not a silent
  precision loss. Booleans are stored as 1/0.
- `STRICT` tables are supported (the documentation's own first example uses one).

**Conclusion.** Yes — with a self-imposed boundary: use only the core API, and keep all SQL
behind a repository layer so the RC surface is touched in one directory. The synchronous API
is a feature here: it makes the single-writer pattern automatic and removes "forgot to await
inside a transaction" as a failure mode. The `ERR_OUT_OF_RANGE` behaviour is what lets us
store money as a plain `number` of minor units with a test pinning the ceiling instead of
paying for `BigInt` everywhere.

**Rows produced.** D-001 (stack), D-002 (storage), D-003 (money as `number` minor units),
D-014 (tests build the schema in `:memory:`), G-004 (Postgres trigger).

---

## 2026-09-21 · How do real B2B suites model requisition approval?

**Question.** What is the smallest model that a procurement person would recognise as
correct — thresholds, who approves, what is recorded?

**Sources.**
- https://help.sap.com/docs/buying-invoicing/approval-process-management-guide/approval-processes-common-to-all-sap-ariba-procurement-solutions-6b6e65fdc1da101487d9f30984e7faeb
- https://medium.com/@adam_29103/building-sap-ariba-documents-approval-flows-part-i-approval-rules-4c455e199e24
- https://knowledge.intershop.com/kb/index.php/Display/296Y35 (Concept — B2B Order Approval Service)
- https://support.intershop.com/kb/index.php/Display/N29331 (Guide — B2B Storefront Functionality)
- https://commercetools.com/blog/b2b-product-spotlight-a-beginners-guide-to-buyer-approval-flows

**Evidence.**
- Ariba builds approval **rules** into a flow: conditions on amount, commodity and accounting
  attributes add approvers. Approver lookup tables use **top-down logic**, and the documented
  best practice is "most specific rule high, one general fallback rule on the last row".
- Ariba shows an **approval graph** on the requisition, derived from items, amount and
  accounting — i.e. the buyer sees who will approve *before* submitting.
- Ariba supports **serial approver nodes** (left to right, each notified after the previous
  approves) and **delegation** of approval authority for out-of-office.
- Intershop's B2B Order Approval Service names exactly the rules we need:
  `SingleOrderThresholdApprovalRule` (total above the buyer's own limit),
  `BudgetThresholdApprovalRule` (total above the buyer's budget for a period) and
  `CostCenterApprovalRule` (requisition assigned to a cost centre, whose **cost centre
  manager** approves or rejects all orders for it). Approvers see a queue; an approved order
  is placed automatically; **a rejection can carry a reason**.

**Conclusion.** The universal core is: an ordered rule list matched top-down with a mandatory
unbounded fallback, resolving to a *person* via a role or a cost-centre ownership, with the
matched rule visible before submission and recorded after it, and a rejection reason shown to
the buyer. Three things that every suite has are deliberately *not* v1: serial chains,
period budgets, and content conditions (commodity/supplier) — each is a separate gap with the
trigger that reopens it, so deferring them is a decision rather than an omission.

**Rows produced.** D-006 (roles vs cost-centre ownership as separate facts), D-008 (ordered
threshold rows, first match wins, mandatory fallback, rule shown before and stored at
submission), D-009 (lifecycle incl. mandatory rejection reason), G-005 (serial chains),
G-007 (delegation / out-of-office), G-008 (budgets and period limits), G-011 (rule conditions
beyond amount), M-006 (human approval wait).

---

## 2026-09-21 · Money in JavaScript: store integers, or use a money library?

**Question.** Integer minor units by hand, or dinero.js / currency.js — and what does ISO 4217
actually require of us?

**Sources.**
- https://www.dinerojs.com/core-concepts/currency and https://v2.dinerojs.com/docs/core-concepts/currency
- https://github.com/sarahdayan/dinero.js/issues/9 (minor units, cents vs fils)
- https://currency.js.org/
- https://www.honeybadger.io/blog/currency-money-calculations-in-javascript/

**Evidence.**
- The agreed representation everywhere is **integer minor units**; floats are out of the
  question for money.
- ISO 4217 currencies have **different exponents**: USD/EUR 2, JPY 0, Iraqi dinar 3 (1000
  fils). "Assume cents" is a real bug, not a theoretical one. Dinero ships 166 currencies with
  their exponents; a Dinero object's *scale* defaults to the currency exponent.
- Dinero's own guidance: make the **rounding mode a parameter, not a default**; compute at
  high precision and round **once**, at the point money actually moves.
- `Intl.NumberFormat` with `style: 'currency'` handles display formatting without any library.

**Conclusion.** Store integers ourselves. Our v1 arithmetic is `unitPriceMinor × quantity`
(exact in integers) and a sum — there is no division, no allocation and no percentage, so
there is nothing for a money library to do except supply the exponent table, which is a
twenty-line file. Taking a runtime dependency for that would cost D-001's zero-dependency
promise. What we *adopt* from Dinero is its discipline: the currency code travels with the
amount, exponents come from a table rather than an assumption, totals are computed rather than
stored, and the single rounding function exists with its mode named — so that the first
feature that needs rounding (a discount, a tax line, a currency conversion) has one place to
land instead of five.

**Rows produced.** D-003 (money), plus the "totals are computed, never stored" clause that
D-007's audit relies on; G-002 (multi-currency, and why conversion is the hard part).

---

## 2026-09-21 · Multi-tenancy on one SQLite database: what actually goes wrong?

**Question.** The brief says an organisation must never see another's data, and that this is
the one thing that would end the project. Row-level `org_id`, or a file per organisation?

**Sources.**
- https://dev.to/helperx/multi-tenant-data-isolation-in-sqlite-per-user-database-files-vs-row-level-5glm
- https://dev.to/young_gao/multi-tenant-architecture-database-per-tenant-vs-shared-schema-1n2e
- https://dev.to/ntty/why-your-saas-multi-tenancy-logic-will-eventually-break-4nde
- https://postgresql.codeguides.io/multi-tenant-patterns/best-practices/

**Evidence.**
- The dominant failure is a **missing `WHERE tenant_id = ?`** — "one forgotten clause in a
  complex JOIN or a single misplaced variable in a delete".
- Per-tenant SQLite **files** make cross-tenant leakage structurally impossible and are
  typically 5–10× faster for tenant-scoped queries, but break on cross-tenant transactions,
  high per-tenant write concurrency and very high tenant counts.
- For shared-schema, the repeated advice is: inject the filter in **one** wrapper/middleware
  rather than writing it per query; enforce in the database where possible; and write an
  **integration test that inserts as tenant A, queries as tenant B and asserts zero rows** —
  running continuously in CI.
- Postgres solves this with row-level security policies; SQLite has no equivalent, so the
  enforcement has to be structural in the application.

**Conclusion.** Row-level with a hard seam. Per-tenant files were genuinely tempting — the
brief's "must never" argues for structural impossibility — but they break the instance-wide
outbox drain (D-011), turn every migration into a fan-out, and make the admin/reporting path a
special case. The compromise that keeps the guarantee: no SQL outside `src/db/`, every
repository constructed from an `OrgScope` so an unscoped query cannot be *expressed*, every
index `(org_id, …)`, and the A/B leak test as a mandatory suite on the board. Because SQLite
cannot enforce it in the engine, the test is not optional — it is the enforcement.

**Rows produced.** D-004 (tenancy), D-014 (the cross-org leak suite as a mandatory suite),
D-016 (cross-org reads answer `not_found`, never `403`, so ids cannot be probed), D-017
(random ids, no enumerable auto-increment on business rows), G-004 (Postgres + RLS as the
later engine-level enforcement).

---

## 2026-09-21 · Idempotency for submit and approve

**Question.** An approver on a train taps "approve" twice. What must the API guarantee, and
what is the smallest correct mechanism?

**Sources.**
- https://stripe.com/blog/idempotency (Designing robust and predictable APIs with idempotency)
- https://docs.stripe.com/api/idempotent_requests
- https://www.makonea.com/en-US/memo/idempotency-key-api-boundaries
- https://www.alekseialeinikov.com/en/blog/topics/architecture/idempotency-in-practice-api-retries-2026

**Evidence.**
- Stripe's pattern: a client-generated unique value in an `Idempotency-Key` header on mutating
  requests; the server saves the **status code and body** of the first request for that key —
  success or failure — and returns the same result for subsequent requests. Keys are retained
  at least 24 h, "long enough to cover realistic retry windows without unbounded storage".
- For costly duplicate execution (payments, orders, reservations) the requirement is a durable
  store with a **unique constraint** and an atomic conflict path — not an in-memory cache.
- Tenancy: "a key alone is a global namespace, which means one tenant can collide with
  another's key. The unique constraint should be on `(tenant_id, key)`, never `key` on its
  own."
- Several sources distinguish the retry case from the **concurrent different-request** case;
  the latter needs a version/ETag guard, which idempotency keys do not provide.

**Evidence turned into a change.** The tenant-scoped unique constraint is not a detail here:
a global key namespace would be a cross-organisation channel in a system whose one hard rule
is that organisations cannot touch each other (D-004) — a client could probe another org's
keyspace by collision. That moved the constraint to `(org_id, endpoint, key)` and added the
request-fingerprint check, so a reused key with a different body is a loud `409` rather than a
wrong replayed answer.

**Conclusion.** Idempotency keys stored in the same transaction as the state change, scoped to
the organisation, with a fingerprint; plus a separate optimistic `version` guard on approve and
reject for the two-approvers-race case. The two mechanisms answer different questions and both
are needed.

**Rows produced.** D-010 (idempotency + version guard), D-016 (`idempotency_key_reuse` and
`conflict` as stable codes), D-007 (the key row joins the state change's transaction).

---

## 2026-09-21 · Operating SQLite under one Node process

**Question.** Which pragmas and which connection topology does a single-container service
need so that "one file" is not a liability?

**Sources.**
- https://coddy.tech/docs/sqlite/wal-mode-and-concurrency
- https://micrologics.org/blog/sqlite-in-production-optimizing-wal-mode-concurrency-and-vfs-layers-for-low-latency-app-servers
- https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/

**Evidence.**
- The recommended production baseline is `journal_mode=WAL`, `synchronous=NORMAL`,
  `busy_timeout=5000`, `foreign_keys=ON`. The default `busy_timeout` of zero "makes every
  concurrent operation a coin flip", and it must be set before anything else.
- In WAL mode readers do not block the writer and the writer does not block readers, but there
  is still exactly **one writer at a time**; multiple connections writing to the same file
  serialise anyway and only add lock contention.
- The single-writer pattern is natural with a synchronous API — the same property `node:sqlite`
  has.
- WAL needs shared memory (the `-shm` file) and therefore **local storage**; network
  filesystems risk `SQLITE_IOERR`, phantom locks or corruption.

**Conclusion.** One process, one write connection, WAL with the four pragmas set at open time,
and a documented requirement that the database file lives on a local volume. This is what makes
"one container, one database" an operational statement rather than a hope — and `SQLITE_BUSY`
appearing in logs becomes a real signal rather than noise, which is exactly the trigger written
into G-004.

**Rows produced.** D-002 (pragmas, single write connection, local volume), M-002 and M-003
(the p95 numbers that would show the single writer becoming the constraint), G-004 (trigger).
