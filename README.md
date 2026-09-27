# Requisit

A B2B purchase-requisition and approval service — and the example project of the
[rumble-framework](https://github.com/FRZWLF/rumble-framework). Everything here, from the
first decision to the last PR, was produced by that process: a rumble (`docs/00-brief.md` is
its input), `/task-out`, and `/pipeline` runs with the project agents.

- `docs/` — vision, decisions (D-rows), gaps (G-rows), measurements (M-rows), research log,
  roadmap, the dev pipeline. The docs are the memory; a check keeps them honest.
- `framework.json` — what is Requisit-specific about the process; the agents, skills and the
  framework block of `CLAUDE.md`/`AGENTS.md` are generated from it.
- `docs/presentation/` — the storyline of the talk and where each artefact comes from.

## Development

Requires Node 24 LTS or newer and nothing else — the service has **zero runtime
dependencies** (D-001) and storage is the built-in `node:sqlite` (D-002), so `npm ci`
installs only typescript, eslint and `@types/node` and there is no native build step.

```
npm ci
npm run typecheck    # tsc --noEmit
npm test             # node --test over test/**/*.test.ts, offline, in :memory:
npm run lint         # builds dist/ + dist-lint/, then eslint over the emitted JS of src/ and scripts/ (D-019)
```

The full verify board (D-015) adds the two docs checks:

```
node ../rumble-framework/scripts/check-anchors.mjs .
node ../rumble-framework/render.mjs . --check
```

`npm start` compiles `src/` to `dist/` and runs it; `npm run serve` runs an already built
`dist/` without compiling. Both refuse to start without a `REQUISIT_TOKEN_SECRET` of at
least 32 bytes (D-018); configuration is environment-only:

| Variable | Default | Rule |
|---|---|---|
| `REQUISIT_TOKEN_SECRET` | — | required, at least 32 bytes |
| `REQUISIT_DB_PATH` | `./data/requisit.db` | any writable path |
| `PORT` | `3000` | integer 1–65535 |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `REQUISIT_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

In development put them in `.env`, which is gitignored. The service code never reads a
file for configuration — it reads `process.env` and nothing else; it is the npm scripts
that hand `.env` to Node through its own `--env-file-if-exists`, so `npm start`,
`npm run serve`, `npm run seed` and `npm run mint-token` all see the same variables while
the process still knows only environment. Export them yourself and no `.env` is needed.
The CLI is the only issuer of personal tokens (D-005):

```
npm run mint-token -- --org <org-uuid> --person <person-uuid> [--ttl 86400]
```

It exits `2` when that person is not a member of that organisation, and `1` on a bad
configuration or bad usage.

## Quickstart

From a clean clone, offline apart from `npm ci` — install, seed, start:

```
npm ci
printf 'REQUISIT_TOKEN_SECRET=%s\n' "$(node -e 'console.log(crypto.randomBytes(32).toString("hex"))')" > .env
npm run seed
npm start
```

`npm run seed` (D-018) builds two demo organisations — **Acme GmbH** in EUR and **Kabuki KK**
in JPY, so the exponent-0 case is in the demo and not only in a test (D-003) — each with a
cost centre and its owner, a buyer, a finance approver, a merchant integration, a short
catalogue and the three-row rule table D-008 requires. It prints every token **once** and
writes none of them to a file; a second run finds what the first one made and adds nothing.
`npm start` then serves on <http://127.0.0.1:3000>.

Export the three Acme tokens the seed printed, and the cost centre's id:

```
BUYER=v1....        # Bea Buyer
APPROVER=v1....     # Otto Owner, who owns CC-OPS
MERCHANT=v1....     # Acme Order Feed
CC=...               # the cost centre id the seed printed next to CC-OPS
API=http://127.0.0.1:3000/api/v1
```

The walkthrough — draft, submit, reject, copy forward, approve, poll, acknowledge:

```
# 1 · a draft: 2 × 1 299,00 EUR, as integer minor units (D-003)
curl -s -X POST $API/requisitions -H "Authorization: Bearer $BUYER" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: q-1' \
  -d '{"costCentreId":"'"$CC"'","lines":[{"description":"Laptop 13\"","quantity":2,"unitPriceMinor":129900}]}'
# → 201, with "id", "total": { "amountMinor": 259800, "currency": "EUR" } and "actions"

# 2 · submit it; 2 598,00 EUR is over the self threshold, so CC-OPS's owner decides (D-008)
curl -s -X POST $API/requisitions/$REQ/submit -H "Authorization: Bearer $BUYER" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: q-2' -d '{}'
# → 200, "state": "submitted", "rule": { "ruleCode": "R2-owner-to-5000" }

# 3 · the approver rejects, with a reason the buyer sees verbatim (D-009)
curl -s -X POST $API/requisitions/$REQ/reject -H "Authorization: Bearer $APPROVER" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: q-3' \
  -d '{"version":2,"reason":"Use the standard 14\" model"}'

# 4 · the buyer copies it forward — a new draft; the rejected row keeps its history
curl -s -X POST $API/requisitions/$REQ/copy -H "Authorization: Bearer $BUYER" \
  -H 'Idempotency-Key: q-4'

# 5 · submit the copy, 6 · and this time the approver approves
curl -s -X POST $API/requisitions/$COPY/submit -H "Authorization: Bearer $BUYER" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: q-5' -d '{}'
curl -s -X POST $API/requisitions/$COPY/approve -H "Authorization: Bearer $APPROVER" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: q-6' -d '{"version":2}'
# → 200, "state": "approved" — and one order_outbox row, in that same transaction (D-011)

# 7 · the merchant polls the feed from its cursor
curl -s "$API/outbox?after=0" -H "Authorization: Bearer $MERCHANT"
# → { "items": [ { "id": 1, "requisitionId": "...", "payload": { "totalMinor": 259800, … } } ],
#     "nextAfter": 1, "cursor": 0 }

# 8 · and acknowledges through that id, which is what orders the requisition (D-009)
curl -s -X POST $API/outbox/ack -H "Authorization: Bearer $MERCHANT" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: q-7' -d '{"through_id":1}'
# → { "throughId": 1, "cursor": 1, "ordered": ["<the requisition this call ordered>"] }
#   a repeat with the same Idempotency-Key replays these bytes; a fresh one at or below the
#   cursor is a no-op that answers "ordered": [] with the cursor unchanged (D-010)

# 9 · the buyer sees the end of the story, and the whole audit behind it
curl -s $API/requisitions/$COPY -H "Authorization: Bearer $BUYER"
# → "state": "ordered", with history draft.copied · submit · approve · order
```

`$REQ` and `$COPY` are the `id` fields the answers to steps 1 and 4 carry.

Two suites stand behind this section, and they cover different halves of it.
`test/flow/end-to-end.test.ts` drives the same nine calls **in process**, against a seeded
temporary database, so the request and response shapes above are checked but the commands
around them are not. `test/flow/quickstart.test.ts` covers the commands: it runs
`npm run seed` and `npm start` as real child processes with a temporary
`REQUISIT_DB_PATH`, a freshly generated secret and a free `PORT`, parses the tokens the
seed printed, walks draft → submit → approve → poll → ack over a socket and then stops the
service with `SIGTERM`. Between them, a wrong command block and a wrong payload shape are
both a red board.

## The HTTP API

`npm start` binds `127.0.0.1:$PORT` (D-012). Every route is under `/api/v1`, takes
`Authorization: Bearer <personal token>`, and every mutating route additionally requires an
`Idempotency-Key` (D-010). Refusals are RFC 9457 problem documents with a stable `code`
(D-016, D-023); a cross-organisation id is `404 not_found`, never `403`.

| Route | Purpose |
|---|---|
| `POST /requisitions` | a new draft for the calling buyer |
| `PATCH /requisitions/:id` | replace a draft's cost centre and line set |
| `GET /requisitions?state=&mine=&awaiting_me=` | the organisation's requisitions |
| `GET /requisitions/:id` | detail: lines, total, the matched-or-stored rule, `actions`, audit history |
| `POST /requisitions/:id/submit` | match a rule, store it, move to `submitted` — or straight to `approved` under a `self` rule |
| `POST /requisitions/:id/approve` | decide, under the **stored** rule; `version` required |
| `POST /requisitions/:id/reject` | decide, with a reason of 1–500 characters; `version` required |
| `POST /requisitions/:id/cancel` | the buyer withdraws a draft or a submitted requisition |
| `POST /requisitions/:id/copy` | a rejected requisition forward into a new draft |
| `GET /rules` | the organisation's approval rule table, read-only in v1 |
| `GET /outbox?after=&limit=` | the order feed from a cursor — a **merchant** token only (D-011) |
| `POST /outbox/ack` | acknowledge through a cursor: the only path into `ordered` (D-009) |

Who may do what comes from the matched rule, not from a role name (D-006, D-024): the
detail's `actions` is computed by the same functions the write routes use, so a UI renders
buttons instead of re-implementing authority.

The order handoff is an outbox plus a poll, and deliberately **no webhook** (D-011; G-006
holds the trigger for the first consumer that cannot poll). Approving writes one
`order_outbox` row in the approving transaction, so an order can neither be lost nor emitted
for a change that rolled back. The merchant reads the feed from an integer cursor and
acknowledges through it; delivery is at-least-once and the merchant deduplicates on `id`.
Acknowledged rows are stamped, never deleted, so an older cursor replays the same rows with
the same payloads. The two routes need the `merchant` role — a buyer or approver token is
`not_authorised`, and a merchant token of one organisation sees nothing of another (D-004).

### The pages

The same process serves a small server-rendered UI on the same origin (D-012, D-013): plain
HTML from template functions, one hand-written stylesheet, no framework, no bundler, no build
step, and ~50 lines of vanilla JavaScript. **Every read path works with JavaScript switched
off**; the script only asks the server for a draft's running total and matching rule, and keeps
a double-click from becoming a second POST.

| Page | Purpose |
|---|---|
| `GET /sign-in` | the personal token, typed once into a `POST` field |
| `GET /` | redirects by role: a buyer to their requisitions, anybody else to the queue |
| `GET /requisitions?state=` | the buyer's own requisitions, filterable by state |
| `GET /requisitions/new`, `GET /requisitions/:id/edit` | the draft editor: catalogue picker, quantity, cost centre, note, and the server's total and matching rule |
| `GET /requisitions/:id` | detail, the audit history verbatim, and the actions this caller may actually take |
| `GET /approvals` | the approver queue, oldest wait first, with amount and matched rule per row |

Forms `POST` to page routes that call the very same use cases as the JSON API — authority, the
state machine, rule matching and the audit line are decided in one place, never twice. Each form
carries the `Idempotency-Key` the server rendered into it, so a double-click is one state change
(D-010). The session is the token in an `HttpOnly`, `SameSite=Strict` cookie (D-025); it reaches
no URL, no log and no page source.

## License

MIT — see [LICENSE](LICENSE).
