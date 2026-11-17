# A pre-merge routine on one PR

**Situation.** A PR is ready. You want the agent to run exactly the reviews this diff needs, in an order
that doesn't waste work, and leave one evidence block a script can check.

**Level 3.** The profile's `routine.rows` maps paths to passes; adjust them to your tree.

```bash
node scripts/tbs/routine.mjs plan --base origin/develop
```

prints the matched rows and the passes, for example a UI change touching a backend rule:
correctness, deep review, security, user roles, edge cases, design audit, cross-review, verify walk.
Then ask the agent: "Run the routine on this branch."

The routine prefers your host's own skills (on Claude Code `/simplify` with an explicit range and
`/code-review high`; on Codex `codex review`) and falls back to the kit's pass skills. A review that
produces nothing is replaced by a stronger one before merge. Every finding is fixed, filed as an
issue, or put to you with a recommended answer.

**Working looks like.** One PR comment headed `## Routine evidence` with the full head SHA, every
matched row, each pass's command and result, findings and their routes, and gate logs from after
the last edit. If `selfMerge.requiredComments` names that heading, the merge gate checks it. The
routine never merges.
