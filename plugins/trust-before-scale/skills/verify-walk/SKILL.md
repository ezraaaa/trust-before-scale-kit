---
name: verify-walk
description: "Walk changed journeys in a browser or simulator and report observable results on the exact head."
---

# Verify Walk

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

Read `routine.coreFlows`, `routine.personas`, `routine.designSystem` and any walk requirements
in the extension. Use a browser or simulator appropriate to the configured surface; host setup is
in `docs/harnesses.md`. Walk changed journeys, role variants, empty/error states and recovery.
Check what is on screen and what actions actually do, not just internal state or test output.
For shared code, walk one consumer per application. Record device/browser, appearance, role,
steps, expected versus observed result and full head SHA. Use free ports where needed.
Mark each journey WALKED or INFERRED. INFERRED requires why it cannot be reached locally and a
walk-owed issue describing how to reproduce it. “No time” and “tests passed” are missing walks,
not exceptions. Do not claim an unavailable browser or simulator was used. A later edit invalidates
affected walk evidence; rerun before readiness. Never edit during gates or contend with another walk.
