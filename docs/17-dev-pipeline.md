# 17 · Dev pipeline

Requisit is built with the [rumble-framework](https://github.com/FRZWLF/rumble-framework):

```
Rumble (a person + Claude/Codex, its own session)
   │ /task-out  → issues on GitHub, decisions in docs/02, the run order on the umbrella; the session ends
   ▼
GitHub issue  type:task  (the contract: Goal, Context, Acceptance, Tests, Out of scope)
   │ /pipeline <issue> · /pipeline <umbrella> · /pipeline    — in a NEW session, free issues in waves
   ▼
triage → [architect] → implement → review (+ security on risk:high) → fix loop (≤ 2) → gate → 📋 trail
```

The agents, skills and the framework block of `CLAUDE.md` / `AGENTS.md` are generated from
`framework.json`; the docs checks (`check-anchors.mjs`, `render.mjs --check`) are part of the
verify board. Labels: `infra/github/labels.txt`, applied by `infra/github/setup.sh`.
