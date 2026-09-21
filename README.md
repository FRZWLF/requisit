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

`npm start` runs the compiled service from `dist/`. It refuses to start without a
`REQUISIT_TOKEN_SECRET` of at least 32 bytes (D-018); configuration is environment-only:

| Variable | Default | Rule |
|---|---|---|
| `REQUISIT_TOKEN_SECRET` | — | required, at least 32 bytes |
| `REQUISIT_DB_PATH` | `./data/requisit.db` | any writable path |
| `PORT` | `3000` | integer 1–65535 |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `REQUISIT_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

In development put them in `.env`, which is gitignored and never read by the service
itself. The CLI is the only issuer of personal tokens (D-005) and reads `.env` through
Node's own `--env-file-if-exists`:

```
npm run mint-token -- --org <org-uuid> --person <person-uuid> [--ttl 86400]
```

It exits `2` when that person is not a member of that organisation, and `1` on a bad
configuration or bad usage.

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

Who may do what comes from the matched rule, not from a role name (D-006, D-024): the
detail's `actions` is computed by the same functions the write routes use, so a UI renders
buttons instead of re-implementing authority.

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
