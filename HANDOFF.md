# Handoff

The kit's handoff and continuation brief (`autopilot.handoff` and `autopilot.continuation`). A cold start
by Claude or Codex needs only this file, `AGENTS.md` and `docs/maintaining.md`. Durable facts (release,
branch protection, harness status, adoption in the owner's projects) live in `docs/maintaining.md`
"State"; this file holds what is in flight, the owner list and the next action. Read every line here as
a claim to check against git and GitHub.

## State (20 Nov 2026)

- Released: 1.7.2 (`v1.7.2` on `main`, `gemini` published). `develop` is at or after `e5c72ed`.
- The kit now uses itself at adoption level 1: `.agents/trust-before-scale.json`, the autopilot extension
  `.agents/skills/autopilot/SKILL.md`, generated `scripts/tbs/`, `docs/trust-before-scale/`.
  `lanes.mjs` allows one lane.
- In flight: nothing. No open feature branch or lane worktree.
- Merged into `develop` on 19 Nov 2026: PR 23 self-adoption (`84f0289`), PR 26 learn/method parking,
  PR 27 token efficiency, PR 30 autopilot supervision ladder (`eb4417c`), PR 31 a missing `level` is level 1
  in every script and the merge-gate hook, and `doctor` accepts a project-kept feature map (`704d4e3`).
- Merged into `develop` on 20 Nov 2026: PR 35 fixes #24, the private-name check now finds `.leakcheck.local`
  from a worktree (worktree first, then the main checkout) and reports NOT RUN, never PASS, when it is
  missing (`6f520a2`); PR 34 records the owner's level-4 plan-approval ruling, issue #33 (`e5c72ed`).
  Issues #24 and #33 are done and still open on GitHub for the owner to close.
- Known leak-check limits, both fail safe as NOT RUN, not fixed: linked worktrees of a main checkout made with
  `--separate-git-dir`, and `--history` run from a subdirectory holding its own `.leakcheck.local`.
- Issue #29 (supervision ladder) is done: merged in PR 30 and PR 31 (unreleased). It is still open on GitHub for the owner to close.
- Issue #28 (Modern Web Guidance as an optional add-on for web projects, never bundled): owner decision
  19 Nov 2026, `design-audit` owns it and measures first. Not in 1.7.3.
- Scheduled task `daily-issue-triage-tbs-kit`: a local, read-only Claude app task, about 08:30 daily, that
  runs only while the Claude app is open. It drafts plans for one or two open issues for the owner to
  approve. Autopilot here is fully supervised at level 1 (owner decision 19 Nov 2026): the owner starts
  every run by hand on an approved triage plan and approves each plan and merge. Supervision lifts one step
  per adoption level up to level 4 (shipped autopilot core); gate code and governance stay the owner's at every
  level, and a config without `level` counts as level 1 (autopilot and scripts). Scheduling is revisited after a few clean runs.
  Owner decision 19 Nov 2026: at level 4 in this repo the agent may approve its own implementation plans for work
  already in its priority list when no protected file is touched; the full rule and protected-file list are in the
  autopilot extension, "Priority". Choosing the work and every other plan stay the owner's.

## Owner list (parked questions)

1. Raise the kit's adoption level? Level 2 needs a feature map (the kit has no screens): `doctor` now accepts a
   project that keeps its own map (owner decision 19 Nov 2026), so the kit could map its skills or keep none. Recommended: wait until
   the gate bugs below are fixed.
2. #15 is a design question for the owner.
3. Close #24, #29 and #33 on GitHub (all merged), or say if any should stay open.

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

1. The next patch (1.7.3): open issues #13, #14, #16, #17, #18, #20, #21 and #22 (#24 fixed in PR 35), plus the deferred items in
   `docs/maintaining.md` "Backlog". Plan it first, then release as usual. Gate-code changes need the
   owner's read (autopilot extension, "Stop and ask").
2. Before updating the owner's projects to the next release, check each config has an explicit `level`:
   a missing `level` now means level 1 (one lane, no self-merge, evals and learn off). Four of the five were
   installed before levels existed; set the level the owner wants on each project's branch.
3. Rerun each project's eval suite before 25 Nov 2026, or after the 1.7.3 update if it lands first.
4. A public demo project at level 2.
5. A long-form explainer.

## Next exact action

Plan the 1.7.3 patch (Next work 1), starting with the owner's pick from the daily triage
(`daily-issue-triage-tbs-kit`). Write `PLAN.md`, get the owner's approval, then implement on a feature branch
from `develop`.
Each gate-code change is a plan for the owner first (autopilot extension, "Stop and ask").
