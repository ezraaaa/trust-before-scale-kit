# Solo, one agent

**Situation.** You work with one coding agent. You want one guarantee: it cannot merge a PR unless the
tests passed on the exact commit being merged.

**Level 1.**

```bash
node "$TBS_PLUGIN/bin/tbs-init" generic
node scripts/tbs/doctor.mjs
```

Edit `.agents/trust-before-scale.json`: set `baseBranch`, and if your test command is unusual, set
`mergeGate.gateCommandPattern`. Commit the result.

Ask the agent to produce gate logs that prove themselves:

```bash
{ echo "HEAD=$(git rev-parse HEAD)"; npm test; } > gate.log 2>&1; echo "EXIT=$?" >> gate.log
```

and to merge only like this:

```bash
grep -qx 'EXIT=0' gate.log && gh pr merge 123 --merge --match-head-commit "$(git rev-parse HEAD)"
```

**Working looks like.** `doctor.mjs` prints `PASS` for every required line. A merge without
`--match-head-commit`, or with the test output piped through `| tail`, is blocked by the hook with a
reason and a fix. A deliberate exception needs `HOOK_SKIP=1 HOOK_SKIP_REASON="..."` and is logged for review.
