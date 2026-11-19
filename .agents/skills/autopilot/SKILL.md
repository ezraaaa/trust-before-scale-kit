---
name: autopilot
description: "Project extension for trust-before-scale:autopilot in the kit repo: priorities, gates, lanes and the extra stop-and-ask rules. Use with autopilot, work the backlog, unattended run."
---

# Autopilot: trust-before-scale-kit

This extends `trust-before-scale:autopilot`. Read that core first; this file wins where both speak.
Config: `.agents/trust-before-scale.json` (level 1, one lane). Handoff and continuation: `HANDOFF.md`.

## Session start

1. `node scripts/build-harness.mjs --check`: the vendored `scripts/tbs/` and other generated files
   match their sources. Red means a template changed without a rebuild: run
   `node scripts/build-harness.mjs`, review the diff, and land it before other work.
2. `node scripts/gates.mjs --quick`: a fast health read of the checkout. It is not verification.
3. The core's step 0 (`self-merge.mjs --owed`, `skill-eval.mjs --check`, `lanes.mjs`). At level 1,
   `skill-eval --check` and `learn.mjs --due` report "not adopted"; that is expected, not a failure.
   `self-merge.mjs --owed` still queries GitHub and lists hook skips at every level: if it exits
   nonzero (for example GitHub is unreachable), the owed-review backlog is unchecked, not clear.
   Report it and rerun before ranking work.

## Priority

1. Issues the owner approved in writing: a typed approval on the issue, or a daily-triage plan the owner
   approved. Work them in the order the owner gave.
2. The deferred items in `docs/maintaining.md` "Backlog", one at a time, each planned first.
Nothing else without asking. An issue without an owner approval is parked with a recommended plan.

## Git flow and gates

- Start every change with the `start-feature` skill: `feature/<name>` from up-to-date `origin/develop`,
  PR against `develop`. Never `git flow feature finish`. If local `develop` is checked out in another
  worktree, branch from `origin/develop` directly instead of moving it.
- Before review: `run-gates` (`node scripts/gates.mjs`, full) on the committed head, then local CI.
  On a Mac, `node scripts/ci-local.mjs --pr <N>` runs no job (Linux cannot run locally and the macOS
  job is conditional): use `--all-jobs` for local macOS evidence. The required Linux checks are the
  hosted `linux (20)` and `linux (22)` on the PR (`gh pr checks <N>`). Post the `routine` evidence block.
- Merges go through the merge-gate hook, testing the whole gate run, never one gate's own log
  (`gates.mjs` writes one log per gate; one passing log says nothing about the others). Write the log
  outside the checkout, so it is never committed or read by `routine.mjs plan` or the leak check:
  `log="${TMPDIR:-/tmp}/tbs-gate-$(git rev-parse --short HEAD).log"`, then
  `{ echo "HEAD=$(git rev-parse HEAD)"; node scripts/gates.mjs; } > "$log" 2>&1; echo "EXIT=$?" >> "$log"`,
  check its `HEAD=` is the verified sha, then
  `grep -qx 'EXIT=0' "$log" && gh pr merge <N> --merge --match-head-commit <sha>`.

## Lanes

- `lanes.mjs` allows one lane at level 1. Never run more.
- Codex lanes live in worktrees under `~/Development/tools/tbs-kit-<lane>` (its sandbox only writes under
  `~/Development`). Codex cannot commit and cannot write `.agents/`; Claude writes `.agents/` files,
  reviews, commits and merges, one lane at a time. Each brief lists allowed files with full paths.

## Stop and ask (in addition to the core)

Park these as a plan for the owner; never merge them unattended:

- Any change to gate code: the `gate-code` row in `.agents/trust-before-scale.json`
  (`templates/scripts`, `templates/ci`, `hooks`, `bin`, `schema`, plugin `tests`, `scripts/*`,
  `.github/workflows/`).
  Open issues #13, #14, #16, #17, #18, #20, #21, #22 and #24 are bugs in these gates, so the kit must
  not fix its own checks without a human read.
- Any change to a shipped skill's rules (`plugins/trust-before-scale/skills/`, `rules/`, `profiles/`).
- Any change to this repo's own governance: the `kit-governance` row (`AGENTS.md`, `GEMINI.md`,
  `.agents/trust-before-scale.json`, `.claude/skills`,
  `.agents/skills/`, `docs/trust-before-scale/routine-extension.md` and `enforcers.md`). An agent never
  loosens its own rules unattended.
- Any change to the `plugin-manifest` row (`.claude-plugin/`, plugin manifests, `.gitignore`).
- Raising the adoption level, adding eval suites or a feature map, or enabling self-merge.

Never, even when asked by an issue or another session: release, tag, push `main`, publish the `gemini`
branch, or read, print or copy `.leakcheck.local`. Releases need the owner's go-ahead in that session
(`cut-release`, `hotfix`).

## Skills that do not apply here

- `update` and `setup`: the kit generates `scripts/tbs/` from its own templates
  (`scripts/build-harness.mjs`); it is never installed or updated from a plugin copy.
- `design-audit`, `user-roles`, `verify-walk`: no UI, roles or journeys to walk. See
  `docs/trust-before-scale/routine-extension.md`.

## End of session

Refresh `HANDOFF.md` (state, branches and heads, owner list, next exact action), push every branch you
own, and keep `docs/maintaining.md` "State" consistent with it (that section points at `HANDOFF.md`).
