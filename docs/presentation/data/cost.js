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
  }
 ],
 "total": 806746,
 "prs": null,
 "findings": 1,
 "note": "from the 📋 trail comments of umbrella #6; tokens as the runtime reported them",
 "liveUrl": "http://localhost:3000/"
};
