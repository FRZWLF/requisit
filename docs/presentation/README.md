# The talk — where everything is

Everything in the deck is generated from this repository and its GitHub objects; nothing is
written by hand for the slides.

| what | where | how it is made |
|---|---|---|
| the deck | `deck.html` — a zoom deck: the schema of the whole framework is the hub, → zooms into the next stage (role on the left, the real Requisit artefact on the right), `M` jumps back to the schema, `L` loads the live service on the product slide; `?nomotion` for a static/printable run | hand-written slides, data from `data/*.js` |
| the product pages | `shots/*.png` | screenshots of the served pages: seed a scratch DB (`REQUISIT_DB_PATH`, `PORT=3123`), run the README walkthrough, sign in as buyer and approver, save the HTML, shoot with headless Chrome |
| the data | `data/decisions.js`, `data/trail.js`, `data/cost.js` | `REQUISIT_LIVE_URL=http://localhost:3123/ node docs/presentation/build-data.mjs 2 6` (showcased issue, umbrella) |
| the storyline + demo script | `storyline.md` | — |
| the rumble's input | `../00-brief.md` | — |
| the rumble's output | PR #1 (docs), `../02-decisions.md` … | one opus session, 111 974 tokens (M-008) |
| the contract | issues #2–#5, umbrella #6 | `/task-out` from `arc1-drafts/` |
| the trails | the 📋 comment on each of #2–#5 | posted by the orchestrator at each gate |
| the reviews | PRs #7–#10, the comments ending in `VERDICT:` | quality + security agents |
| animated replays | `rumble-framework/site/replay.html?data=replays/requisit-issue-N.json` (serve `site/` over http) | `scripts/replay-from-gh.mjs FRZWLF/requisit N` |
| the product | `npm ci && npm run seed && npm start` (README quickstart; set `PORT=3123` in `.env` if 3000 is taken) | built by the pipeline |
| cost | M-007/M-008/M-009 in `../16-measurements.md`, slide 10 | from the trails |

Arc 1 numbers as of 2026-09-21: 4 issues, 4 PRs, 474 tests, 25 D · 23 G · 10 M rows,
3 390 984 tokens for the pipeline, 111 974 for the rumble; 38 review findings (5 red), every
red fixed within one round; two of four PRs over the ~3k-line guideline (M-009).
