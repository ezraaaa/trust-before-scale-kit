---
name: user-roles
description: "Review what each configured role can see and do across a changed journey."
---

# User Roles

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

Use roles, pressures and real tasks in `routine.personas`; check applicable policy in
`routine.ruleSources`. Review each role independently, including restricted and revoked roles:
what they see, what they can invoke directly, whether the flow finishes, and whether messages and
sample data are truthful. Check role-specific actions, cross-role handoffs, navigation and denial
states. UI hiding does not prove authorization; coordinate with the security pass.
For a new surface do this before building and again after. If roles are absent, report the gap
and ask for them; do not assume a business hierarchy. Every finding names role, task, consequence
and fix. Missing capability goes to an issue, not an expansion of the current slice.
