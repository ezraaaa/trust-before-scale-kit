---
name: security-review
description: "Review who can reach the changed surface and its data, including surrounding access paths."
---

# Security Review

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

Scope to the surface, not only the changed lines: enumerate entry points, identities, tenants,
roles, collections, storage, queries, server handlers and visible clients that can reach the data.
Check authentication versus authorization, ownership, widened reads/writes, input validation,
secrets, logging, enumeration and revocation during a session. Follow indirect access paths and
negative cases. A client-side visibility check is not server authorization. Use role context from
`routine.personas` and policy in `routine.ruleSources`; missing policy is an owner question.
Introduced or widened unauthorized access blocks readiness until fixed or the slice is parked.
File pre-existing exposure before merge, with severity; never quote credentials in evidence.
