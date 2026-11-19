# Handoff

The kit's handoff and continuation brief (`autopilot.handoff` and `autopilot.continuation`). A cold start
by Claude or Codex needs only this file, `AGENTS.md` and `docs/maintaining.md`. Durable facts (release,
branch protection, harness status, adoption in the owner's projects) live in `docs/maintaining.md`
"State"; this file holds what is in flight, the owner list and the next action. Read every line here as
a claim to check against git and GitHub.

## State (19 Nov 2026)

- Released: 1.7.2 (`v1.7.2` on `main`, `gemini` published). `develop` is at or after `8ee7ebf`.
- The kit now uses itself at adoption level 1: `.agents/trust-before-scale.json`, the autopilot extension
  `.agents/skills/autopilot/SKILL.md`, generated `scripts/tbs/`, `docs/trust-before-scale/`.
  `lanes.mjs` allows one lane.
- In flight: `feature/self-adoption` (this change), PR against `develop`.
- A read-only daily triage task drafts plans for one or two open issues each morning for the owner to
  approve. Autopilot here runs supervised only until the owner says otherwise.

## Owner list (parked questions)

1. Raise the kit's adoption level? Level 2 needs a feature map (the kit has no screens): either map the
   skills as features or change the shipped `doctor` to accept a thin install. Recommended: wait until
   the gate bugs below are fixed.
2. #15 is a design question for the owner.

## Lessons to record at level 3

`learn` is off at level 1 (`learn.mjs add` prints "not adopted"). Log each of these with
`node scripts/tbs/learn.mjs add` once the kit reaches level 3, then delete this section. Each happened once.

| Class | Where | Source | Evidence |
|---|---|---|---|
| routine-row-misclassified | `.agents/trust-before-scale.json` | review-finding | PR 23: `templates/ci` sat in `shipped-skills`, not `gate-code`; fixed d6ed0eb |
| generated-output-orphans | `scripts/build-harness.mjs` | review-finding | PR 23: a rebuild left removed scripts in `scripts/tbs/`; fixed 7204e80 |
| doc-claims-unverified-behaviour | `.agents/skills/autopilot/SKILL.md` | review-finding | PR 23: said `self-merge --owed` reports "not adopted" at level 1; it queries GitHub; fixed d6ed0eb |
| pipe-hides-exit | agent shell use | review-finding (Claude's own check of its output) | PR 23: `ci-local.mjs` piped through `tail` showed exit 0 for a run with no jobs; rerun unpiped |
| silent-skipped-check | `scripts/leak-check.mjs`, `scripts/ci-local.mjs` | review-finding | #24: private-name check skipped in worktrees, reported PASS |
| single-gate-log-merge | `.agents/skills/autopilot/SKILL.md` | review-finding | PR 23 routine: merge recipe tested one gate's log; now one log of the whole run |
| agent-can-loosen-own-rules | `.agents/trust-before-scale.json` | review-finding | PR 23 routine: config and extensions had no review passes or stop rule; added `kit-governance` row |
| symlinked-generated-output | `scripts/build-harness.mjs` | review-finding | PR 23 routine: `--check` read through a symlinked `scripts/tbs`; now rejected |

## Next work, in order

1. Land `feature/self-adoption` (review, gates, merge to `develop`).
2. The next patch (1.7.3): open issues #13, #14, #16, #17, #18, #20, #21, #22 and #24, plus the deferred items in
   `docs/maintaining.md` "Backlog". Plan it first, then release as usual. Gate-code changes need the
   owner's read (autopilot extension, "Stop and ask").
3. Rerun each project's eval suite before 25 Nov 2026, or after the 1.7.3 update if it lands first.
4. A public demo project at level 2.
5. A long-form explainer.

## Next exact action

Review the `feature/self-adoption` PR and merge it with the merge-gate pattern once the full gates and
`ci-local.mjs --pr <N>` are green on its head.
