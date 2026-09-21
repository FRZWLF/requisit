# Project scaffold, domain model, storage with audit, and token authentication

## Goal
Stand up the Requisit package — types, SQLite schema with migrations, the organisation-scoped
repository layer, the append-only audit, and HMAC personal tokens — so that every later split
writes business logic and never infrastructure.

## Context
Honor D-001 (TypeScript on Node 24 LTS, one package, ESM, **zero runtime dependencies** — the
only `dependencies` entry allowed is none; devDependencies are typescript, eslint, `@types/node`),
D-002 (`node:sqlite` `DatabaseSync`, one file, one write connection, `journal_mode=WAL`,
`synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`, all tables `STRICT`, forward-only
numbered migrations in `src/db/migrations/`), D-003 (money is `{ amountMinor: number, currency }`,
exponent table checked in, totals computed never stored, one `roundHalfUp`), D-004 (tenancy: every
business table has `org_id NOT NULL` with an FK, every index is `(org_id, …)`, repositories are
constructed from an `OrgScope`, **no SQL string outside `src/db/`**), D-005 (tokens
`v1.<base64url(payload)>.<base64url(hmac)>`, HMAC-SHA256, `timingSafeEqual`, payload
`{ sub, org, iat, exp, kid }`, **roles are not in the token**), D-006 (roles `buyer` / `approver` /
`finance` / `admin` per `(org_id, person_id)`; cost-centre ownership is a separate relation),
D-007 (append-only `audit_log`, written in the same transaction as the state change), D-014
(`node --test`, `tsc --noEmit`, eslint; tests build the schema from the migrations in `:memory:`),
D-015 (the board), D-016 (one typed refusal type + RFC 9457-shaped body, stable `code` strings),
D-017 (`crypto.randomUUID()` business ids, a `Clock` interface injected everywhere, UTC ISO-8601
timestamps as TEXT), D-018 (environment-only config validated once at startup into a frozen object;
the process refuses to start without a ≥ 32-byte `REQUISIT_TOKEN_SECRET`).

**Do NOT** in this split: implement the lifecycle transitions, rule matching, HTTP routes, the UI,
the outbox, or the agent. Do NOT add any runtime dependency (no `better-sqlite3`, no JWT library, no
money library, no test framework, no web framework) — if one seems necessary, stop and say so in the
PR instead of adding it. Do NOT write `UPDATE` or `DELETE` against `audit_log`. Do NOT invent a
tenancy escape hatch "for the seed script" — the seed uses the same repositories.

Tables to create (names are the contract for the later splits): `orgs`, `people`, `person_roles`,
`cost_centres`, `catalogue_items`, `requisitions`, `requisition_lines`, `approval_rules`,
`audit_log`, `idempotency_keys`, `order_outbox`. Splits 02 and 04 fill the last three with
behaviour; create them here so there is one migration story.

New rows: none reserved. If the migration runner or the token format needs a shape this issue did
not name, add a `D-` row in this branch, continuing from D-018.

## Acceptance criteria
- [ ] `npm ci && npm run typecheck && npm test && npm run lint` is green on a clean clone, offline,
      and `package.json` has an empty (or absent) `dependencies` field.
- [ ] `openDatabase()` applies the four pragmas at open time and a test asserts each one by reading
      it back (`PRAGMA journal_mode`, `synchronous`, `busy_timeout`, `foreign_keys`).
- [ ] The migration runner applies numbered migrations in order, is idempotent on a second run,
      records applied migrations in a `schema_migrations` table, and refuses to run a migration file
      whose checksum changed.
- [ ] Every business table has `org_id NOT NULL` with an FK to `orgs` and at least one index whose
      first column is `org_id`; a test reads `sqlite_master`/`PRAGMA index_list` and asserts this for
      every table it finds rather than for a hard-coded list.
- [ ] A repository cannot be constructed without an `OrgScope`; a test asserts that no file outside
      `src/db/` contains a SQL keyword against a business table (a source scan is an acceptable
      implementation of this check, and it must fail if a query is moved out).
- [ ] `Money` helpers: `lineTotal(unitPriceMinor, quantity)`, `sumMoney(...)` refusing a currency
      mismatch with a typed refusal, `formatMoney` via `Intl.NumberFormat`, and an exponent lookup
      that knows EUR=2, USD=2, JPY=0 and throws on an unknown code.
- [ ] `writeAudit()` is the only way to insert into `audit_log`, takes the open transaction, and a
      test proves that a rolled-back state change leaves no audit line and a committed one leaves
      exactly one.
- [ ] Token mint/verify round-trips; a tampered payload, a tampered signature, an expired token, a
      token signed with another secret and a malformed token each produce a typed refusal and never
      a thrown stack trace. Verification uses `timingSafeEqual`.
- [ ] Verifying a token yields an `OrgScope` whose roles were read from `person_roles` at that
      moment — a test changes a role in the database and shows the *same* token's authority change.
- [ ] Startup config validation: missing or short `REQUISIT_TOKEN_SECRET` exits non-zero with a
      message that does not print the value; a test covers the refusal.

## Test expectations
`node --test` only, everything in `:memory:` built from the migrations, a fixed `Clock`. Suites:
`db/migrations`, `db/pragmas`, `db/tenancy-shape`, `domain/money`, `audit/transactional`,
`auth/token`, `config/startup`. The **cross-org leak suite** starts here as a harness with at least
one real case per repository that exists (insert as org A, read as org B, assert zero rows) — split
02 extends it, it is never weakened. Money tests include the 2^53-1 ceiling assertion from D-003 and
a JPY (exponent 0) case. No network, no ports, no temp files outside the OS temp dir.

## Out of scope
Lifecycle transitions and rule matching (02), any HTTP route or server (02), the UI (03), the outbox
behaviour and the seed data (04), the agent (Arc 2), a token-issuing endpoint (a `scripts/mint-token`
CLI is in scope; an HTTP login is not), Docker, CI workflows.

## Suggested routing
area:api · size:L · risk:high — triage makes the final call
