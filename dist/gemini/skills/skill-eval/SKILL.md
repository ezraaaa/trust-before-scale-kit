---
name: skill-eval
description: "Run, read or extend the evals proving review skills still catch real faults. Use when a review skill changed, before a release, when the eval check is red, or after a review miss."
---

# Skill evals

- **Run a suite:** `node scripts/tbs/skill-eval.mjs <suite>` (suites are in `.agents/trust-before-scale.json` (falling back to `.claude/trust-before-scale.json`)).
  It writes `evals/<suite>/result.json`; commit it. Each review case runs the review headless (the configured suite `reviewer`, default `claude`) and a
  configured judge (default `codex`) on a different model, so a full run costs real tokens: run it when the skill changes and weekly.
- **One case:** `--case <id>` prints the result and never writes the record.
- **Check:** `--check` fails when a skill changed, a case failed, the record is missing, its `evidenceRule` differs from 3, or its `settingsHash`
  is missing or differs from the effective review prompt/model, judge (including `TBS_JUDGE_MODEL`), repeats,
  base or link directories; `--check --fresh` also fails a record older than `maxAgeDays`.
- **Add a case** after any miss: `evals/<suite>/cases/<id>/case.json` and `seed.patch`, a real diff against the
  current base that a person could plausibly ship. Neither the added lines, the branch name nor the message may say
  any whole word (case-insensitive) from: eval, seed, test, judge, rubric, score, candidate, benchmark,
  planted, fixture. Unchanged context is excluded; identifiers such as `testCount` are allowed. `expect` is
  `gate` when a command already catches it (name the command), else `review` with `rule`, `file` and `mustName` tokens. The evidence must quote the review
  and contain the file basename and at least one `mustName` token. Tokens match as literal, case-insensitive substrings.
- **A seed that no longer applies** is rewritten against the current code. Never delete a case to make a suite green.
- A failing case is a finding about the skill: fix the skill, rerun, and commit the new record with the skill change.
- **Dry run:** `<suite> --dry-run` prints the effective judge and checks each patch with `git apply --check`
  against the suite base. `STALE <id>` fails the command. Dry runs, real runs and `--check` all fail for an
  empty suite, with a hint to add 3–8 cases from real failures.
- **Judge:** suite `judgeModel` is optional. `TBS_JUDGE_MODEL` takes precedence; with neither set, Codex uses
  its default (no `--model` argument).
- **Repeats:** optional suite `repeats` is a positive integer and defaults to 2. Every repeat must pass.
  Each case in `result.json` records `passes` and `repeats`; `--check` reads an old record without `repeats` as one run and requires
  a new run when the configured repeat count changes.

Blind review cases use a hermetic repository containing only a sanitized base snapshot and the seeded commit; hidden answer keys are absent from both files and git history. Optional suite `hidePaths` adds repo-relative paths to the defaults (`evals`, `.agents/trust-before-scale.json` (falling back to `.claude/trust-before-scale.json`), `docs/trust-before-scale`, `scripts/tbs`); these must not overlap skills or linked directories.

Blindness covers everything reachable from the review clone and its git data. Review `linkDirs` point to isolated copies shared across the run, and kept reviews default to `<project git common dir>/tbs-reviews` (override with `TBS_REVIEW_DIR`). Gate cases retain links to the real checkout. The reviewer still runs with the user's normal filesystem access: a reviewer that already knows the project's absolute path can open it.
