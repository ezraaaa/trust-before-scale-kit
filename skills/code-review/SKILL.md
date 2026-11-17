---
name: code-review
description: "Review correctness on the settled change and identify concrete regressions with evidence."
---

# Code Review

Read `.agents/trust-before-scale.json`, falling back to `.claude/trust-before-scale.json` only
when the preferred file is absent. Read `routine.extension` if configured, the host instructions,
and the planned base, range and changed surfaces. Missing configured inputs are gaps, never passes.
Use `routine.passes` for the host's preferred capability, with this skill as the fallback;
see `docs/harnesses.md` for host commands. Do not invent project rules or roles. In a blind eval where config is deliberately hidden, use
the explicit routine inputs supplied by the review prompt and report any missing source files.

Report the command or task brief, reviewed full head SHA, scope, findings with checked file:line
citations and severity, explicit clean verdict or missing-review reason, and limitations.
Distinguish introduced/worsened findings from pre-existing ones. Route through the routine;
a report that contains no review is not a clean result. Do not merge.

Read the settled diff and the surrounding callers, tests and contracts. Check intended behaviour,
authorization boundaries, errors, data migration, compatibility and test assertions that actually
prove outcomes. Trace reachability before alleging an unconditional effect. Name concrete input,
wrong outcome and file:line, rather than speculative style preferences.
Use the planned level: medium for tests/tooling, high for behaviour, xhigh for security. Never
request max or ultra unless the owner asks. If a different-model cross-review is the correctness
read, record the conditional deferral; if it produces no review, perform correctness one level
higher before merge (ceiling xhigh; at the ceiling use a fresh independent reviewer and name it).
