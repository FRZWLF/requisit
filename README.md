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
