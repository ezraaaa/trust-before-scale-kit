# Rules and their enforcers

For each repeated mistake, record the strongest prevention available and the real past mistake that proved
its check red. Try architecture, types, lint with a fix in its error, tests, hooks or gates, then docs.
Exceptions must name their reason, expiry date and approving human.

The kit's existing enforcers are listed below. Where the original failure was not recorded in this public
history (it starts at 1.5.0), the red proof is the check's own red test cases.

| Rule | Enforcer | Proven red on | Exceptions |
|---|---|---|---|
| Merge only the head that was verified | gate: `plugins/trust-before-scale/hooks/merge-gate.py` rule 1 (`--match-head-commit`) | A push between a green run and the merge (hook docstring); red cases in `plugins/trust-before-scale/tests/merge-gate-smoke.sh` | `HOOK_SKIP=1 HOOK_SKIP_REASON=...`, logged to `tbs-skips.log` |
| Test the gate's exit before merging, never just print it | gate: `merge-gate.py` rule 2 (`grep -qx 'EXIT=0' <log> && gh pr merge`) | A printed `EXIT=1` followed by a merge (hook docstring); smoke red cases | as above |
| Never pipe a gate in a command that merges or commits | gate: `merge-gate.py` rule 3 | Pipe exit hid a red gate (hook docstring); smoke red cases | as above |
| Generated files match their sources | gate: `node scripts/build-harness.mjs --check` (`harness-check` in `scripts/gates.mjs`, first CI step) | not recorded | none |
| No real project names in tracked files | gate: `node scripts/leak-check.mjs --require` (`leak-check`; `--history` for every commit) | not recorded | none |
| The kit installs and its vendored tests pass in a fresh repository | gate: `install-generic`, `install-acme-mobile`, `install-profile-dir` in `scripts/gates.mjs` | not recorded | `--quick` is diagnostic only, never verification |
| Manifests and marketplaces are valid | gate: `claude plugin validate . --strict` and `--profile directory` | not recorded | none |

## Shipped learn enforcers

Keep this separate machine-readable table. Class is exact kebab-case, enforcer is its stable id,
and Shipped is an ISO 8601 UTC timestamp. Only status `shipped` suppresses a due class.
Update the row only when the owner has accepted and shipped the check; retain its red proof above.

| Class | Enforcer id | Shipped | Status |
|---|---|---|---|

Lessons default to `docs/trust-before-scale/lessons.jsonl`. In git repositories new entries live at
`<git-common-dir>/tbs-learn/<learn.file>` so all worktrees share one journal; the repository file is also
read for historical entries. Outside git the repository file receives appends. Each entry is one bounded
O_APPEND write. Never truncate either file. The shared journal is local evidence: preserve it when moving
checkouts; it is not automatically committed or synchronized to another machine.
