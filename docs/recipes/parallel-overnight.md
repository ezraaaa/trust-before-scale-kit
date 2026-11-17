# Parallel agents overnight

**Situation.** You want several agents working through a backlog while you're away, and to wake up to
work you can trust.

**Level 4.** Prerequisites: review evals green and fresh, the feature map green, no owed reviews,
no unreviewed hook skips, no repeated mistakes without a check.

```bash
node scripts/tbs/doctor.mjs
node scripts/tbs/lanes.mjs
```

`lanes.mjs` prints how many lanes are allowed and every reason the number is lower than
`autopilot.maxLanes`. Then start the `autopilot` skill; it runs `lanes.mjs --require <n>` before each
launch and works one lane per worktree. Set `autopilot.checkIns` to batch questions for set times.

**In the morning.**

```bash
node scripts/tbs/self-merge.mjs --owed
node scripts/tbs/skill-eval.mjs --check
```

Review each self-merged PR listed as owed and add the reviewed label. Review hook skips, then
`node scripts/tbs/self-merge.mjs --ack-skips` (it lists what it acknowledges and records who did).

**Working looks like.** Lanes only ever go up when the evidence is fresh, and fall back to one, with a
reason, the moment it isn't.
