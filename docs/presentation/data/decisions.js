window.DECISIONS = {
 "decisions": [
  {
   "id": "D-001",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Stack: TypeScript on Node 24 LTS, one package, ESM, zero runtime dependencies.** Source in `src/`, compiled by `tsc` to `dist/`; `devDependencies` only (typescript, eslint, `@types/node`).",
   "rationale": "Node 24 is the LTS that carries `node:sqlite`, `node --test`, `node:http` and `crypto.createHmac` — everything v1 needs is in the platform, so the dependency tree is a policy choice, not a constraint. One package because the service is one process and one artefact; a monorepo with workspaces buys nothing before the first user. *Rejected:* Rust/Go (the team and the talk are JS/TS; no CPU problem to solve); plain JS (the money and tenancy types are the point — see D-003, D-004); Deno/Bun (fine, but Node is what a B2B shop already runs).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-002",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Storage: `node:sqlite` (`DatabaseSync`), one file, one process, one write connection.** Opened with `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`; all tables `STRICT`; schema applied by numbered, forward-only migration scripts checked in under `src/db/migrations/`. Tests open `:memory:`.",
   "rationale": "Built in, so there is no native build step, no `node-gyp`, no postinstall script — the whole reason we can promise \"one container, one database\". It is a release candidate (stability 1.2), which is acceptable because we use only the settled core (`prepare`/`run`/`get`/`all`, `exec`, explicit `BEGIN`/`COMMIT`) and no backup, session or extension APIs. The API is synchronous, which removes a whole class of \"forgot to await\" transaction bugs and makes the single-writer pattern the natural one. *Rejected:* `better-sqlite3` (same API shape, but a native dependency — the thing we are avoiding); `libsql`/Postgres from day one (an extra service for a v1 that fits in a file — G-004 holds the migration trigger).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-003",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Money: integer minor units + an ISO 4217 code on every amount; no money library.** An amount is `{ amountMinor: number, currency: string }`; stored as two columns `*_minor INTEGER` and `currency TEXT`. Exponents come from a small checked-in table (EUR 2, USD 2, JPY 0, …) — never assumed to be 2. Line total = `unitPriceMinor * quantity` (integer, exact); requisition total = the sum of line totals, **computed on read, never stored**. Exactly one rounding function, `roundHalfUp(numerator, denominator)`, used nowhere in v1 except where a future percentage lands — and a test asserts v1 needs no rounding at all.",
   "rationale": "Minor units in a JS `number` are exact to 2^53-1 — about 90 trillion euro-cents — so `BigInt` and its serialisation pain buy nothing here; an explicit test pins that ceiling. Currency lives next to the amount because a bare integer is the classic way to add EUR to USD. *Rejected:* dinero.js / currency.js (good libraries, but they would be the only runtime dependency, for arithmetic that is two multiplications and a sum — D-001); floats (never); a single global \"cents\" assumption (breaks on JPY and on the first non-euro customer).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-004",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Tenancy: the organisation is the boundary, enforced by shape, not by discipline.** Every business table carries `org_id` NOT NULL with an FK to `orgs`; every index is `(org_id, …)`. Data access goes through repositories constructed from an `OrgScope` (org id + actor) — a repository function *cannot be called* without one, and no SQL string outside `src/db/` is allowed to mention a business table. A required test suite inserts as org A, reads as org B and asserts zero rows for every read path and a typed refusal for every write path.",
   "rationale": "The known failure mode of shared-schema tenancy is one forgotten `WHERE org_id = ?` in a join or delete; the defence that works is removing the possibility of writing the query by hand, plus a leak test that runs in CI forever. Per-tenant database files would make leakage structurally impossible and are faster, but they break cross-org operations we will want (an instance-wide outbox drain, admin reporting) and turn migrations into a fan-out — with 10s–100s of orgs on one instance the row-level model with a hard repository seam is the better trade. *Rejected:* file-per-tenant; trusting an ORM's default scope (we have no ORM); doing the check only in the HTTP layer (one internal caller bypasses it).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-005",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Auth v1: signed personal tokens (HMAC-SHA256), secret from the environment.** A token is `v1.<base64url(payload)>.<base64url(hmac)>` where the payload is `{ sub, org, iat, exp, kid }`; the key comes from `REQUISIT_TOKEN_SECRET` (the process refuses to start without it), compared with `crypto.timingSafeEqual`. Tokens are issued by a seed/admin script, carried in `Authorization: Bearer …`, and validated into an `OrgScope` (D-004) at the single HTTP boundary. Roles are **not** in the token — they are read from the database per request (D-006). `kid` exists so a second secret can be rolled in without a format change.",
   "rationale": "Self-contained tokens need no session table and no login UI, which keeps v1 to the actual product. Roles stay in the database so revoking someone's authority takes effect on the next request instead of at token expiry — the honesty rule beats the stateless purity. *Rejected:* JWT via a library (a dependency and an algorithm-confusion surface for a payload we fully control); sessions + cookies + a login form (a login page is not what this project is about — but see D-013, the UI carries the token for the demo); API keys per organisation (they cannot answer \"who approved this\").",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-006",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Roles: `buyer`, `approver`, `finance`, `admin`, granted per `(org_id, person_id)`; authority comes from the matched rule, not from the role name.** A person may hold several roles. Cost-centre ownership is a separate relation (`cost_centres.owner_person_id`), because \"approver\" is a capability and \"owns cost centre CC-12\" is the fact a rule matches on.",
   "rationale": "Keeps the rule table readable (`self` / `cost_centre_owner` / `finance`) and lets one person be a buyer in one organisation and an approver in another without a special case. *Rejected:* a single numeric \"approval limit\" per person (the spreadsheet we are replacing); roles in the token (D-005); a generic permission system (a v1 with four roles does not need one).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-007",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Audit: an append-only `audit_log` row written in the same transaction as every state change.** Columns: `id`, `org_id`, `requisition_id`, `actor_person_id`, `actor_kind` (`user` | `agent` | `system`), `action`, `from_state`, `to_state`, `rule_id`, `total_minor`, `currency`, `reason`, `at` (UTC ISO-8601), `request_id`. No `UPDATE` or `DELETE` is ever issued against it (asserted by a test that greps the repository layer). Reads of a requisition render its audit as a history.",
   "rationale": "\"If it says approved by Anna under rule R2 at 14:02, that is exactly what happened\" is only true if the line and the state move commit or fail together; a log file written after the commit can be lost, and one written before can describe a change that rolled back. Recording the total and the matched rule *at that moment* is what makes a later rule-table edit non-retroactive. *Rejected:* structured logging to stdout as the audit (not queryable, not transactional); event sourcing as the primary model (a bigger machine than one approval step deserves — the audit is a faithful side record, the state column stays the truth).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-008",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Approval rules: an ordered table of threshold rows per organisation; first match wins; exactly one approval step in v1.** A row is `(org_id, seq, max_total_minor NULL = unbounded, approver_kind ∈ {self, cost_centre_owner, finance}, rule_code)`. Matching: walk the organisation's rows by `seq` ascending, take the first whose `max_total_minor` is NULL or ≥ the requisition total; that row's `approver_kind` resolves to a concrete person (buyer / cost-centre owner / the org's finance approver). The matched `rule_code` is shown on the requisition **before** submission and stored on it at submission (D-007). A row whose `approver_kind = self` auto-approves at submission, with an audit line, and goes straight to the outbox.",
   "rationale": "This is the shape every B2B suite converges on — Ariba's top-down approver lookup tables with a general fallback last, Intershop's `SingleOrderThresholdApprovalRule` / `CostCenterApprovalRule` — reduced to the part the brief asks for. First-match-wins on an ordered list is explainable to a buyer in one sentence, which multi-node approval graphs are not. Each org must have a terminal unbounded row; a seed check and a runtime refusal (`no_rule_matched`) enforce it. *Rejected:* serial multi-step chains (G-005); per-commodity / per-cost-centre rule conditions beyond ownership (G-011); a rules DSL or expression language (unreviewable, and the first step toward the workflow engine the vision forbids); budgets and periodic spend limits (G-008).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-009",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Lifecycle: `draft → submitted → approved | rejected | cancelled`, and `approved → ordered`.** Transitions are a single table-driven state machine in one module; every transition names its allowed actor and returns either the new state or a typed refusal (`not_authorised {rule}`, `wrong_state {from,action}`, `no_rule_matched`, `not_found`). `rejected` and `cancelled` are terminal; a rejected requisition is **copied** to a new draft rather than reopened, so its audit stays true. `ordered` is set by the outbox acknowledgement (D-011), not by the approver. A rejection requires a non-empty reason (≤ 500 chars), shown verbatim to the buyer.",
   "rationale": "A terminal rejection with a copy-forward is the honest version of \"reopen\": the rejected document keeps its amount, its rule and its reason forever. Separating `approved` from `ordered` is what makes the handoff observable — \"approved but not yet ordered\" is exactly the state the future merchant agent answers about. *Rejected:* an editable submitted state (the approver would be approving a moving amount); `approved` implying the order was placed (loses the handoff failure mode).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-010",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Idempotency: an `Idempotency-Key` header on every mutating endpoint, plus an optimistic version guard on approve/reject.** An `idempotency_keys` table with `UNIQUE (org_id, endpoint, key)` stores the first response's status and body; a repeat of the same key **and the same request fingerprint** replays it byte-for-byte, a repeat with a different fingerprint is `409 idempotency_key_reuse`. Rows are kept 24 h and swept on startup and daily. Independently, approve/reject take the requisition's `version`; a stale version is `409 conflict`, so two approvers racing on a phone produce one approval and one honest error. Key insertion happens inside the same transaction as the state change (D-007), so a crash leaves no key claiming a change that did not commit.",
   "rationale": "Replaying an approve is the one retry that can grant authority twice; a client-generated key plus a unique constraint is the pattern that survives every retry story, and scoping the constraint to `(org_id, …)` keeps one tenant from colliding with — or probing — another (D-004). The version guard covers the different bug: two *different* requests for the same state move. *Rejected:* keys alone without the fingerprint (a client reusing a key for a different body would silently get the wrong answer); a global key namespace; natural-key deduplication (there is no natural key for \"approve\"); server-side \"did this already happen\" heuristics.",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-011",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Order handoff: an outbox table plus a polling endpoint; no webhook in v1.** Approval writes an `order_outbox` row (`id`, `org_id`, `requisition_id`, `payload_json`, `created_at`, `delivered_at`, `ack_by`) in the approving transaction. The merchant polls `GET /api/v1/outbox?after=<id>&limit=n` with a merchant-scoped token and acknowledges with `POST /api/v1/outbox/ack {through_id}`; the acknowledgement moves the requisition to `ordered` and stamps `delivered_at`. The feed is ordered by a monotonic integer id and is therefore replayable from any cursor: at-least-once delivery, dedup by `id` on the merchant side.",
   "rationale": "An outbox written in the state-change transaction is the only handoff that cannot lose an order or emit one for a rollback. Polling needs no inbound URL, no retry/backoff machinery, no signature scheme and no secret held by us — four pieces of work that a v1 with one known consumer does not need. *Rejected:* a webhook (G-006 holds the trigger: the first consumer that cannot poll); a message broker (a service to run for one queue); marking `ordered` at approval (D-009).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-012",
   "struck": false,
   "date": "2026-09-21",
   "title": "**HTTP: `node:http` with a ~100-line table router; no framework.** One table of `{ method, pattern, handler }`, path parameters from a small matcher, JSON bodies with a hard size limit, one error middleware that maps typed refusals to responses (D-016), one auth step that produces the `OrgScope` (D-004, D-005). Listens on `PORT`, binds `127.0.0.1` by default.",
   "rationale": "The surface is roughly a dozen routes; Fastify's schema validation and plugin system are real value at ten times that size, and they cost the zero-dependency promise that makes \"one container\" true (D-001). Revisit when the route table passes ~30 routes or we need per-route schema validation — that is the trigger in G-012. *Rejected:* Fastify / Express / Hono (see above); Node's undocumented internals; a REST framework generated from an OpenAPI spec (the spec is the next project, not this one).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-013",
   "struck": false,
   "date": "2026-09-21",
   "title": "**UI: server-rendered HTML from small template functions + a little vanilla JS; no framework, no build step, no bundler.** Pages: buyer list, requisition detail + draft editor, approver queue, approval detail. Forms `POST` to the same API the merchant uses; a ~50-line `fetch` helper adds the bearer token and the idempotency key and replaces a fragment. All output is escaped by one `esc()` helper — templates take data, never raw HTML. CSS is one hand-written stylesheet served static. The demo token is entered once and kept in `sessionStorage`, never in a URL or a log (D-018).",
   "rationale": "Four screens whose whole job is to show a state and post a transition; a framework would add a build step, a bundle and a second rendering model for no behaviour we need, and would put the project's honesty in client state. Server-rendered HTML also means the approver's phone works without JavaScript for the read path. *Rejected:* React/Vue/Svelte (build step, dependencies); htmx (a dependency for the one interaction we hand-write); a separate SPA repo (the approver PWA is G-003, not a v1 detour).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-014",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Tests: `node --test` only, in-process, offline; `tsc --noEmit` for typecheck; eslint for lint.** Every test builds its own `:memory:` database from the migrations and seeds what it needs; no fixture server, no HTTP port in unit tests (the router is called with a constructed request). Two suites are mandatory for any PR touching data access or the lifecycle: the **cross-org leak suite** (D-004) and the **lifecycle/authority suite** (D-008, D-009, D-010).",
   "rationale": "The platform runner is the last thing that would need to be a dependency, and it gives a watch mode, a TAP reporter and coverage. Building the schema from migrations in every test means the migrations are tested by every test. *Rejected:* vitest/jest (dependency, transform pipeline, a second module resolution to reason about); an end-to-end browser test (Playwright for four server-rendered pages is more infrastructure than product).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-015",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Verify board: `npm ci && npm run typecheck && npm test && npm run lint && node ../rumble-framework/scripts/check-anchors.mjs . && node ../rumble-framework/render.mjs . --check`.** Typecheck before tests (a type error is the cheaper failure); the two docs checks last and always. `npm ci` installs devDependencies only — the service has no runtime dependencies (D-001).",
   "rationale": "One command, green or red, runnable offline on a laptop and by every agent in its worktree. The docs checks are part of the board, not a nicety: a `D-`/`G-`/`M-` reference without a row fails the build, which is what keeps the memory honest. *Rejected:* a separate docs job (skippable); coverage thresholds (a number nobody tuned is a tax — M-005 measures first).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-016",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Errors: one typed refusal type in the domain, mapped once to an RFC 9457-shaped JSON body.** `{ type, title, status, code, detail, requisition_id?, rule?, request_id }` with a stable `code` string (`not_authorised`, `wrong_state`, `no_rule_matched`, `idempotency_key_reuse`, `conflict`, `not_found`, `validation_failed`). Handlers `return` refusals; only bugs `throw`, and a bug is a `500` with the `request_id` and nothing else. A refusal never reveals whether an id exists in another organisation — cross-org is always `not_found` (D-004).",
   "rationale": "Stable codes are what the UI, the merchant and the tests assert on; a shared shape means one place to make sure an internal message never leaks. The cross-org `not_found` rule closes the id-probing oracle that a `403` would open. *Rejected:* HTTP status codes alone (too coarse for `wrong_state` vs `not_authorised`); exceptions as flow control (the typed return is what makes the refusals exhaustive in TypeScript).",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-017",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Ids and time: `crypto.randomUUID()` for business ids, a per-org monotonic `INTEGER` for the outbox cursor, UTC ISO-8601 strings for timestamps, one `Clock` interface injected everywhere.** No `Date.now()` outside the clock; tests use a fixed clock. Human-facing numbers (`REQ-2026-000123`) are a separate per-org counter, display only, never a key.",
   "rationale": "Random ids remove a cross-org enumeration oracle (D-004, D-016) while the outbox needs an ordered cursor, so it gets its own integer key (D-011). A single injected clock is what makes \"approved at 14:02\" testable rather than flaky. *Rejected:* auto-increment primary keys for business rows (enumerable, and they leak volume between tenants); Unix epoch integers (unreadable in the audit, which people will read); a time library.",
   "status": "decided (rumble, 2026-09-21)"
  },
  {
   "id": "D-018",
   "struck": false,
   "date": "2026-09-21",
   "title": "**Configuration and secrets: environment variables only, validated once at startup into a frozen typed config; the process refuses to start on a missing or malformed value.** `REQUISIT_TOKEN_SECRET` (≥ 32 bytes), `REQUISIT_DB_PATH`, `PORT`, `NODE_ENV`, `REQUISIT_LOG_LEVEL`. `.env` is gitignored and read only by the dev seed script, never by the service. Tokens, secrets and `Authorization` headers are redacted by the one log function; no secret ever appears in an error body, an audit line or the HTML.",
   "rationale": "Failing loudly at startup beats a service that runs with a default signing key — the single worst outcome in the threat model (`docs/08-security.md`). *Rejected:* a config file (one more thing to ship a secret in); defaults for the secret (never); a secrets manager (an external dependency for a single-container v1).",
   "status": "decided (rumble, 2026-09-21)"
  }
 ],
 "gaps": [
  {
   "id": "G-001",
   "struck": false,
   "date": "**SSO / external identity.** How do people authenticate once Requisit is not the issuer of their identity?",
   "title": "**SSO / external identity.** How do people authenticate once Requisit is not the issuer of their identity?",
   "rationale": "v1 issues signed personal tokens (D-005). A real customer authenticates against their own IdP; getting the seam wrong means rewriting every handler's notion of \"who\".",
   "status": "The first evaluation that requires a customer directory, or any request to disable local tokens."
  },
  {
   "id": "G-002",
   "struck": false,
   "date": "**Multi-currency.** One currency per organisation, or per requisition, and what happens to a rule threshold when the currency differs?",
   "title": "**Multi-currency.** One currency per organisation, or per requisition, and what happens to a rule threshold when the currency differs?",
   "rationale": "Thresholds are amounts (D-008); comparing 5 000 JPY to a 1 000 EUR threshold requires a rate, and a rate requires a date, a source and a rounding rule — the moment money stops being exact (D-003).",
   "status": "The first organisation with a second currency, or a catalogue item priced outside the org currency."
  },
  {
   "id": "G-003",
   "struck": false,
   "date": "**A PWA for approvers on the phone.** Does the approver queue need an installable, offline-capable app?",
   "title": "**A PWA for approvers on the phone.** Does the approver queue need an installable, offline-capable app?",
   "rationale": "Approvals happen on phones between meetings. Server-rendered HTML (D-013) is fine to read but has no push, no offline queue, and posting from a flaky train is exactly the retry case D-010 covers.",
   "status": "An approval-wait measurement (M-006) that shows the wait is the approver's device rather than their attention, or the first request for notifications (G-014)."
  },
  {
   "id": "G-004",
   "struck": false,
   "date": "**Postgres migration.** When does the SQLite file stop being enough, and what does the port cost?",
   "title": "**Postgres migration.** When does the SQLite file stop being enough, and what does the port cost?",
   "rationale": "D-002 is one file, one writer. Concurrency, a second instance, or a managed backup story all end at Postgres. The repository seam (D-004) is what makes the port bounded — if it erodes, the port stops being bounded.",
   "status": "Sustained write contention (SQLITE_BUSY in production logs), a need for a second instance, or a customer requirement for managed Postgres."
  },
  {
   "id": "G-005",
   "struck": false,
   "date": "**Multi-step approval chains.** Is one approval step enough, or do organisations need serial approvers (cost-centre owner *and* finance)?",
   "title": "**Multi-step approval chains.** Is one approval step enough, or do organisations need serial approvers (cost-centre owner *and* finance)?",
   "rationale": "D-008 deliberately ships one step. Real suites (Ariba, Intershop) model serial nodes. Adding a chain later changes the requisition state machine, the queue query and the audit shape.",
   "status": "The first organisation whose written policy requires two signatures on one requisition."
  },
  {
   "id": "G-006",
   "struck": false,
   "date": "**Webhook delivery for the order handoff.** Does the merchant side ever need to be pushed to instead of polling?",
   "title": "**Webhook delivery for the order handoff.** Does the merchant side ever need to be pushed to instead of polling?",
   "rationale": "D-011 ships an outbox + poll. A webhook adds retries with backoff, a dead-letter path, a signing secret and an egress allow-list — a security surface the v1 does not have.",
   "status": "A consumer that cannot poll, or a measured order-handoff latency (M-004) that the business calls too slow."
  },
  {
   "id": "G-007",
   "struck": false,
   "date": "**Delegation and out-of-office.** What happens when the only person who may approve is on holiday?",
   "title": "**Delegation and out-of-office.** What happens when the only person who may approve is on holiday?",
   "rationale": "Every B2B suite has it, and its absence is the failure people actually feel: a requisition stuck for two weeks. It touches authority, so it is the most dangerous convenience feature in the product.",
   "status": "The first requisition that misses a delivery date because its approver was away, or any customer policy that names a deputy."
  },
  {
   "id": "G-008",
   "struck": false,
   "date": "**Budgets and periodic spend limits.** Should authority depend on what has already been spent this period, not only on this requisition's total?",
   "title": "**Budgets and periodic spend limits.** Should authority depend on what has already been spent this period, not only on this requisition's total?",
   "rationale": "Intershop's budget rules and every real procurement policy are period-based (\"50k per quarter per cost centre\"). It changes rule matching from a pure function of the requisition to a function of history — and raises the question of what \"spent\" means (approved? ordered? invoiced?).",
   "status": "The first customer policy stated as an amount per period rather than per order."
  },
  {
   "id": "G-009",
   "struck": false,
   "date": "**The merchant-side agent.** Should the merchant get an agent that answers \"why is this stuck?\" and suggests reorders?",
   "title": "**The merchant-side agent.** Should the merchant get an agent that answers \"why is this stuck?\" and suggests reorders?",
   "rationale": "It is the second half of the brief's agent story and the part with the most commercial pull. It reads across requisitions, which makes its tenancy scope the whole question (D-004).",
   "status": "Arc 2 (the buyer drafting agent) shipped and measured, plus a merchant who asks."
  },
  {
   "id": "G-010",
   "struck": false,
   "date": "**Rate limits and abuse protection.** What stops a token from hammering the API, or from probing ids?",
   "title": "**Rate limits and abuse protection.** What stops a token from hammering the API, or from probing ids?",
   "rationale": "A single-container service with a synchronous database (D-002) is trivially stalled by a loop. D-016's uniform `not_found` closes the probing oracle, but not the load.",
   "status": "Public exposure of the instance, the first untrusted integrator, or a measured p95 (M-002) that moves under a single client's load."
  },
  {
   "id": "G-011",
   "struck": false,
   "date": "**Rule conditions beyond the amount.** Do rules need to match on commodity, supplier, cost centre or line attributes?",
   "title": "**Rule conditions beyond the amount.** Do rules need to match on commodity, supplier, cost centre or line attributes?",
   "rationale": "Ariba routes IT hardware to the IT manager; that is a condition on content, not on total. Adding it turns the ordered threshold list into a predicate list, which is the first step toward a rules language the vision forbids.",
   "status": "The first organisation whose policy names a product category or a supplier rather than an amount."
  },
  {
   "id": "G-012",
   "struck": false,
   "date": "**An HTTP framework.** Does the hand-written router (D-012) hold as the surface grows?",
   "title": "**An HTTP framework.** Does the hand-written router (D-012) hold as the surface grows?",
   "rationale": "The trade in D-012 is dependencies versus schema validation, hooks and lifecycle. It flips at some size; guessing that size now would be inventing a number.",
   "status": "The route table passes ~30 routes, or a second hand-rolled validation bug reaches a review."
  },
  {
   "id": "G-013",
   "struck": false,
   "date": "**Token revocation and rotation.** How is a leaked personal token killed before it expires?",
   "title": "**Token revocation and rotation.** How is a leaked personal token killed before it expires?",
   "rationale": "D-005 tokens are self-contained; today the only answers are \"wait for `exp`\" or \"rotate the org secret and reissue everyone\". Roles are read live, so authority can be stripped — but the token still authenticates.",
   "status": "Any real deployment, any token pasted into a chat, or the first customer security questionnaire."
  },
  {
   "id": "G-014",
   "struck": false,
   "date": "**Notifications.** Does an approver find out about a waiting requisition without looking?",
   "title": "**Notifications.** Does an approver find out about a waiting requisition without looking?",
   "rationale": "The vision says no notifications in v1, which is honest only while the approver checks the queue. E-mail means an outbound dependency and a template surface; it also becomes the first place a requisition's amount leaves the system.",
   "status": "The first measured approval wait (M-006) dominated by \"nobody looked\", or a customer requirement."
  },
  {
   "id": "G-015",
   "struck": false,
   "date": "**Retention, export and deletion.** How long do requisitions and audit lines live, and what happens when an organisation leaves?",
   "title": "**Retention, export and deletion.** How long do requisitions and audit lines live, and what happens when an organisation leaves?",
   "rationale": "The audit is append-only by design (D-007), which collides with \"delete my data\". A B2B customer will ask for both an export and a deletion path.",
   "status": "The first offboarding, a legal review, or a database that outgrows its disk."
  }
 ],
 "measurements": [
  {
   "id": "M-001",
   "title": "M-001 · Verify board wall-clock time"
  },
  {
   "id": "M-002",
   "title": "M-002 · Read path p95 (requisition list and detail)"
  },
  {
   "id": "M-003",
   "title": "M-003 · Approve transaction p95 at 10 000 requisitions"
  },
  {
   "id": "M-004",
   "title": "M-004 · Order handoff latency (approval → merchant acknowledgement)"
  },
  {
   "id": "M-005",
   "title": "M-005 · Test coverage of the domain layer"
  },
  {
   "id": "M-006",
   "title": "M-006 · Human approval wait (submitted → decided)"
  },
  {
   "id": "M-007",
   "title": "M-007 · Pipeline cost per issue (Arc 1)"
  },
  {
   "id": "M-008",
   "title": "M-008 · Cost of the rumble session itself"
  },
  {
   "id": "M-009",
   "title": "M-009 · Arc 1 size per split"
  },
  {
   "id": "M-010",
   "title": "M-010 · Database size per 10 000 requisitions"
  }
 ],
 "measured": 0,
 "addenda": 1,
 "research": 6,
 "anchors": "anchors: 18 D · 15 G · 10 M rows, every reference resolves",
 "waves": [
  [
   "#2"
  ],
  [
   "#3"
  ],
  [
   "#4",
   "#5"
  ]
 ],
 "brief": "# Requisit — the brief (the rumble's input)\n\n*What a person types or pastes at the start of the rumble session: everything they know\nabout the wish. The rumble turns it into a vision, decisions, gaps, a roadmap and issues.*\n\nOur customers' buyers order on account, and above a certain amount someone has to approve\nbefore the order goes out. Today that lives in e-mail threads and a spreadsheet of \"who may\napprove how much\". I want a small, honest service for that — a purchase-requisition and\napproval flow that a B2B shop can sit in front of.\n\n- A **buyer** in an organisation creates a requisition: line items from a catalogue\n  (SKU, quantity, unit price), a cost centre, a note. They can save a draft and submit it.\n- **Approval rules** per organisation: up to X the buyer's own authority; up to Y the cost\n  centre owner; above that a named finance approver. The rule that matched is visible on the\n  requisition. An approver approves or rejects **with a reason the buyer sees**.\n- On approval the requisition becomes an **order** for the merchant side — for v1 that is a\n  webhook or an outbox the shop polls; the real commerce backend comes later.\n- An **agent for the buyer**: \"order 20 more of the blue ones like last month\" → a draft\n  requisition the buyer reviews and submits. The agent never submits or approves on its own.\n- Later: a merchant-side agent that answers \"why is this stuck?\", reorder suggestions,\n  SSO, multi-currency, a PWA for approvers on the phone.\n\nConstraints and taste:\n\n- One container, one database (SQLite is fine for v1, the design must allow Postgres).\n- Roles for v1 via signed personal tokens; SSO later — the design must not paint us in.\n- Many organisations on one instance from day one; an organisation must never see\n  another's data — that is the one thing that would end the project.\n- Money must be right: no floats, one rounding rule, a currency on every amount.\n- Honest: if it says \"approved by Anna under rule R2 at 14:02\", that is exactly what happened.\n- Team: three developers and a product person; decisions written down where the next person\n  finds them; every PR reviewed; the docs are the memory, not the chat.\n",
 "built": "2026-09-21T14:31:59.543Z"
};
