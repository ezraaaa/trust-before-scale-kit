# Rules and their enforcers

For each repeated mistake, record the strongest prevention available and the real past mistake that proved
its check red. Try architecture, types, lint with a fix in its error, tests, hooks or gates, then docs.
Exceptions must name their reason, expiry date and approving human.

| Rule | Enforcer | Proven red on | Exceptions |
|---|---|---|---|
| <mistake to prevent> | <architecture, type, lint, test, gate or doc; command/path> | <past failure and red evidence> | <none, or reason · expiry date · human approval> |

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
