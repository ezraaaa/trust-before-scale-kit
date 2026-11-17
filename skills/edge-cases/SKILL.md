---
name: edge-cases
description: "Explore states, timings and actors beyond the happy path using the configured core flows."
---

# Edge Cases

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

Read `routine.coreFlows` when set. For each changed flow test empty, loading, error, offline,
retry, double submit, concurrent writers, stale state, revoked access, expiry and cancellation.
Ask what else can happen, rather than only whether the intended input works. Trace each plausible
state to an observable outcome. Flag silent data loss, stuck journeys, incorrect results and
missing guards on core flows. Reproduce introduced blockers with a failing test before fixing;
report test command, red proof and green result. With no core-flow registry, name that limitation
and review the reachable changed flow anyway; do not invent a product-wide registry.
