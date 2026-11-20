# Handoff

The kit's handoff and continuation brief (`autopilot.handoff` and `autopilot.continuation`). A cold start
by Claude or Codex needs only this file, `AGENTS.md` and `docs/maintaining.md`. Durable facts (release,
branch protection, harness status, adoption in the owner's projects) live in `docs/maintaining.md`
"State"; this file holds what is in flight, the owner list and the next action. Read every line here as
a claim to check against git and GitHub.

## State (20 Nov 2026)

- Released: 1.7.2 (`v1.7.2` on `main`, `gemini` published). `develop` is at or after `9da0cc5`, with all of
  1.7.3's code merged and unreleased.
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
- 1.7.3 slices merged into `develop` on 20 Nov 2026, owner-approved plan and each merge owner-approved:
  PR 39 (#22, #17), PR 40 (#20), PR 42 (#13), PR 43 (#21), PR 44 (#14), PR 45 (#16, evidence rule 4),
  PR 46 (#18), PR 47 (the two `update.mjs --branch` Backlog items). All those issues are closed.
  Owner decisions 20 Nov 2026: plain `skill-eval --check` (CI) does not compare gate fingerprints, only
  `--fresh` does (PR 44); the Codex hook pins the vendored gate's SHA-256 (PR 46).
  Documented limits, not fixed: gate eval runs share repository refs, config and `linkDirs` (PR 43); import
  scanning for fingerprints is pattern-based, `gateInputs` covers the rest (PR 44); `/terms`-style
  mustName terms keep no boundary on a punctuation edge, by design (PR 45); a base `VERSION` stored as a
  symlink reads as its target name, fail-safe (PR 47).
- Known leak-check limits (#37, low priority, not in 1.7.3), both fail safe as NOT RUN, not fixed: linked worktrees of a main checkout made with
  `--separate-git-dir`, and `--history` run from a subdirectory holding its own `.leakcheck.local`.
- Issue #29 (supervision ladder) is done: merged in PR 30 and PR 31 (unreleased), closed 20 Nov 2026. #24 and #33 are closed too.
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

1. Release 1.7.3 (`cut-release`, needs the owner's go-ahead in that session). Recommended: yes, before
   25 Nov 2026, so the projects' eval reruns (evidence rule 4) happen once, on 1.7.3.
2. Raise the kit's adoption level? Level 2 needs a feature map (the kit has no screens): `doctor` now accepts a
   project that keeps its own map (owner decision 19 Nov 2026), so the kit could map its skills or keep none. Recommended: wait until
   #41 (flaky tests) is fixed.
3. #15 is a design question for the owner.

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
| seeded-vs-unseeded-fingerprint | `templates/scripts/skill-eval.mjs` | review-finding | PR 42/44: the record hashed the seeded gate, the check the unseeded one; fixed in PR 44 |
| hook-runs-unverified-code | `bin/tbs-init` | review-finding | PR 46: a trusted Codex hook ran whatever gate the branch held; now SHA-256 pinned |
| flaky-gate-under-load | `templates/scripts/first-hour.test.mjs`, `tests/update-notice.test.mjs` | gate-red-no-change | #41: gates failed at load average ~72, green on rerun |
| symlinked-generated-output | `scripts/build-harness.mjs` | review-finding | PR 23 routine: `--check` read through a symlinked `scripts/tbs`; now rejected |

## Next work, in order

1. Release 1.7.3 once the owner says go (owner list 1): `cut-release`, then publish `gemini`. Open gate bugs
   (the autopilot extension points here): #41 flaky tests under load, #37 leak-check limits (low). Neither
   blocks the release; each gate-code fix is a plan for the owner first.
2. Before updating the owner's projects to 1.7.3, check each config has an explicit `level`:
   a missing `level` now means level 1 (one lane, no self-merge, evals and learn off). Four of the five were
   installed before levels existed; set the level the owner wants on each project's branch. After updating:
   rerun each project's eval suites (evidence rule 4), and re-trust the Codex hook in `/hooks` where used.
3. Rerun each project's eval suite before 25 Nov 2026 (on 1.7.3 if it is released first).
4. A public demo project at level 2.
5. A long-form explainer.

## Next exact action

Ask the owner for the 1.7.3 release go-ahead (owner list 1). On a yes, run `cut-release` for 1.7.3 from
`develop`; otherwise plan #41 for the owner.
