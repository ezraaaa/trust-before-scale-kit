---
name: deep-review
description: "Review a change against configured project rules, enforcers and recorded decisions."
---

# Deep Review

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

Read every `routine.ruleSources` entry: instruction files, ADRs, enforcer tables and recorded
“do not change back” decisions. Inspect changed code and its callers against each applicable rule.
Catch a cleanup that silently undoes a recorded decision. Quote the rule and cite its source and
the changed line. Check whether an existing decision already settles a reported defect; do not
re-raise settled policy as a new defect. A misimplemented decision still counts. With no sources,
report a coverage gap and request the project's rules, rather than inventing them.
