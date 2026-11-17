# Learn from mistakes

**Situation.** The same kind of mistake keeps coming back. You want each one written down, repeats
counted, a check drafted once a mistake repeats, and a warning when a check stops working.

**Level 3.** Nothing to install beyond the level. Mistakes are recorded by:

- the **routine**, for every finding it routes;
- the **merge hook**, for every command it blocks;
- the agent, through the `learn` skill, after a revert, after a gate fails on merged code, or when
  you correct it.

By hand:

```bash
node scripts/tbs/learn.mjs add --class unpinned-merge --where scripts/release.sh \
  --source owner-correction --evidence "PR 123 merged without --match-head-commit"
```

Entries go to a journal every worktree shares, then `sync` copies new ones into the committed
`docs/trust-before-scale/lessons.jsonl` so they reach every clone and CI:

```bash
node scripts/tbs/learn.mjs sync
```

**At session start** (the `method` skill runs this):

```bash
node scripts/tbs/learn.mjs --due
```

It lists each kind of mistake seen twice or more with no check yet. For each one, the `learn` skill
drafts the strongest check that fits (a type, a lint rule, a test, a hook, or a seeded eval case
for a review miss) on a branch for you to accept, then links it in
`docs/trust-before-scale/enforcers.md`.

```bash
node scripts/tbs/learn.mjs --recurred
```

lists mistakes that came back after their check shipped, marked "check did not hold".

**Working looks like.** `doctor.mjs` reports zero due and zero recurred. A recurrence in the last
`learn.window` days (default 14), or more than `learn.maxDue` (default 3) due classes, holds
`lanes.mjs` at one lane until it's dealt with.
