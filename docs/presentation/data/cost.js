window.COST = {
 "rows": [
  {
   "issue": "#2",
   "stage": "triage",
   "model": "haiku",
   "outcome": "area:api · size:L · risk:high · pipeline:build",
   "tokens": 36617
  },
  {
   "issue": "#2",
   "stage": "architect",
   "model": "fable",
   "outcome": "🏛 Design: one PR, contracts, D-019…D-022, test plan with mutations",
   "tokens": 111317
  },
  {
   "issue": "#2",
   "stage": "implement",
   "model": "opus",
   "outcome": "draft PR #7 — 4 164 lines, 86 tests, 18 mutations red",
   "tokens": 215628
  },
  {
   "issue": "#2",
   "stage": "quality review",
   "model": "opus",
   "outcome": "findings (1 red, 5 nits) — `roundHalfUp` could leave the safe-integer range",
   "tokens": 119264
  },
  {
   "issue": "#2",
   "stage": "security review",
   "model": "opus",
   "outcome": "findings (0 red, 4 nits) — malleable signature encoding, unscoped audit references",
   "tokens": 92901
  },
  {
   "issue": "#2",
   "stage": "fix round 1",
   "model": "opus",
   "outcome": "1 red + 9 nits fixed, 99 tests, 7 mutations red",
   "tokens": 117814
  },
  {
   "issue": "#2",
   "stage": "re-review quality",
   "model": "opus",
   "outcome": "clean (fix verified against exact arithmetic)",
   "tokens": 51594
  },
  {
   "issue": "#2",
   "stage": "re-review security",
   "model": "opus",
   "outcome": "findings (0 red, 2 nits) — one fixed at the gate, one noted for G-016",
   "tokens": 61611
  },
  {
   "issue": "#3",
   "stage": "triage",
   "model": "haiku",
   "outcome": "blocked on #2 (first pass) · area:api · size:L · risk:high · pipeline:build (second pass)",
   "tokens": 69192
  },
  {
   "issue": "#3",
   "stage": "architect",
   "model": "fable",
   "outcome": "🏛 Design: rules, lifecycle table, HTTP pipeline, endpoint contracts, D-023/D-024",
   "tokens": 170828
  },
  {
   "issue": "#3",
   "stage": "implement",
   "model": "opus",
   "outcome": "draft PR #8 — 5 502 lines, 389 tests, 13 mutations (11 red, 2 explained)",
   "tokens": 315524
  },
  {
   "issue": "#3",
   "stage": "quality review",
   "model": "opus",
   "outcome": "findings (1 red, 4 nits) — a draft with an unsummable total was persisted without audit and poisoned the org's list",
   "tokens": 138061
  },
  {
   "issue": "#3",
   "stage": "security review",
   "model": "opus",
   "outcome": "findings (0 red, 6 nits) — actor-less idempotency ledger (replay + pre-claim), body cap after read, shutdown, nosniff",
   "tokens": 126927
  },
  {
   "issue": "#3",
   "stage": "fix round 1",
   "model": "opus",
   "outcome": "10 of 11 fixed, 1 declined with reason (G-018), migration 0002, 402 tests; ran as two agents — the first was cut off by the harness before commit, the second completed",
   "tokens": 276882
  },
  {
   "issue": "#3",
   "stage": "re-review quality",
   "model": "opus",
   "outcome": "clean",
   "tokens": 86444
  },
  {
   "issue": "#3",
   "stage": "re-review security",
   "model": "opus",
   "outcome": "findings (0 red, 2 nits) — one fixed at the gate",
   "tokens": 64379
  },
  {
   "issue": "#4",
   "stage": "triage",
   "model": "haiku",
   "outcome": "blocked on #3 (first pass) · area:web · size:M · risk:medium · pipeline:build (second pass)",
   "tokens": 69932
  },
  {
   "issue": "#4",
   "stage": "implement",
   "model": "opus",
   "outcome": "draft PR #9 — 3 177 lines, 434 tests, 7 mutations red; D-025 (cookie session) written because D-013's sessionStorage clause cannot serve no-JS pages",
   "tokens": 213897
  },
  {
   "issue": "#4",
   "stage": "quality review (with the security brief)",
   "model": "opus",
   "outcome": "findings (0 red, 5 nits) — cookie flags, CSRF, CSP, esc() all verified",
   "tokens": 115302
  },
  {
   "issue": "#5",
   "stage": "triage",
   "model": "haiku",
   "outcome": "blocked on #3 (first pass) · area:api · size:M · risk:high — raised from medium: merchant token + sole path to `ordered` (second pass)",
   "tokens": 73402
  },
  {
   "issue": "#5",
   "stage": "implement",
   "model": "opus",
   "outcome": "draft PR #10 — 2 443 lines, 434 tests, 8 mutations (6 red, 2 survivors closed with new cases), M-004 measured for our side only",
   "tokens": 310852
  },
  {
   "issue": "#5",
   "stage": "quality review",
   "model": "opus",
   "outcome": "findings (2 red, 5 nits) — README quickstart did not run verbatim; a false claim about what the end-to-end test proves",
   "tokens": 115765
  },
  {
   "issue": "#5",
   "stage": "security review",
   "model": "opus",
   "outcome": "findings (1 red, 4 nits) — a merchant-only token could read the whole organisation",
   "tokens": 100618
  },
  {
   "issue": "#5",
   "stage": "fix round 1",
   "model": "opus",
   "outcome": "3 reds + 5 nits fixed, 2 deferred to G-022/G-023 with reasons; route `audience` field; `start` builds and loads `.env`; a real quickstart test spawning seed + start; the README quickstart run verbatim from a fresh clone",
   "tokens": 185210
  },
  {
   "issue": "#5",
   "stage": "re-review security",
   "model": "opus",
   "outcome": "clean",
   "tokens": 83206
  },
  {
   "issue": "#5",
   "stage": "re-review quality",
   "model": "opus",
   "outcome": "clean",
   "tokens": 67817
  }
 ],
 "total": 3390984,
 "prs": 4,
 "findings": 38,
 "note": "from the 📋 trail comments of umbrella #6; tokens as the runtime reported them",
 "liveUrl": "http://localhost:3123/"
};
