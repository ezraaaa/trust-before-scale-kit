---
name: simplify
description: "Simplify a planned change without changing behaviour; run before correctness review."
---

# Simplify

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

Settle the shape before anyone reviews correctness. Use the explicit planned range; never rely
on an upstream-derived default. Reuse existing helpers, reduce duplication and unnecessary work,
and preserve observable behaviour, error handling, authorization, ordering and public interfaces.
Keep one writer in the checkout and wait for it to finish. Read the resulting diff for behaviour
change only, reverting accidental semantic changes. A simplification is fresh unreviewed code:
run whichever correctness read is selected after it settles. Report what changed and why.
