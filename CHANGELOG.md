# Changelog

## Unreleased

- The private-name check falls back to the main checkout's pattern file in linked worktrees. A missing file now reports NOT RUN, fails the local gates, and appears in the local CI summary. Hosted CI still exits 0 when the file is missing.
- Autopilot supervision lifts with the adoption level (owner decision 19 Nov 2026): level 1 is fully supervised, level 2 may merge docs and prose, level 3 may run on a schedule and merge code except gate code and governance, level 4 is the full loop. Gate code and governance stay the owner's at every level, level 4 included.
- **Behaviour change for existing adopters:** a config with no `level`, or an invalid one, now counts as level 1 everywhere: `/autopilot` is fully supervised, `lanes.mjs` allows one lane, the self-merge lane is off, `skill-eval --check` and `learn` report "not adopted", and the merge-gate hook records no lessons. Installs from before levels existed that relied on level-4 behaviour must set `"level": 4`; `doctor.mjs` prints a note when `level` is missing. An invalid `level` still fails config validation.
- `doctor.mjs` accepts a project that keeps its own feature map at any level (owner decision 19 Nov 2026), printing a note as `lanes.mjs` does; a configured `featureMap` is still checked. This replaces 1.7.x's rule that an explicit level of 2 or more requires `featureMap`.
- Fewer tokens: shorter skill descriptions (loaded in every session), a shorter shared intro in the eight review-pass skills, `routine.mjs plan --json --host <host>` (only that host's commands, each row's reason once; output without `--host` is unchanged), and `skill-eval` stops a case's remaining repeats after its first failed repeat.
- At adoption level 4, `learn` and `method` no longer wait on an absent owner: park what needs their answer or acceptance, with a recommendation, and work on what does not. Absence is never acceptance.

### Fixed

- Skill eval exits with status 2 and prints usage when `--case` has no ID or is followed by an option (#22).
- Skill eval matches evidence against file basenames case-insensitively (#17).
- The feature-map check fails with the fix hint when discovery finds no screens, instead of reporting that the map covers all 0 screens (#20).
- Self-merge checks evals with `--check --fresh`, as `lanes.mjs` does: a record older than `maxAgeDays`, or one whose gate inputs changed, now blocks self-merge until the suite is rerun (#13).
- Skill eval gate cases must pass on the clean base before the seeded failure counts, and record both exit codes (#21).
- Skill eval fingerprints clean-base gate scripts, their relative dependencies and declared extra inputs, and `--check --fresh` fails on a changed or missing fingerprint; plain `--check` (CI) does not compare them (#14).
- Skill eval judge excerpts must state the fault and match `mustName` terms as whole tokens (#16). Every project must rerun its eval suites after updating.
- Codex project hooks use the vendored merge gate relative to the checkout root, pinned to its SHA-256, and allow commands with a note if the script is missing or changed (#18). Trust the hook again in Codex `/hooks` after updating.

## 1.7.2

Fixes the lane gate's owed-review check and aligns the eval judge with how evidence is matched.

- Trim the repository name in the owed self-merge search. `lanes.mjs` passed raw `gh` output, so the trailing newline made GitHub reject the query (HTTP 422) and every level-4 project capped at one lane.
- The eval judge prompt now asks for the file basename and at least one `mustName` token, matching how results are scored. `mustName` tokens are literal, case-insensitive substrings.
- New eval records use evidence rule 3. `--check` reports older records as stale: rerun each suite after updating.
- A failed eval case stores the kept review path relative to the repository, not as an absolute path.

## 1.7.1

- Refuse to overwrite untracked update targets, including ignored files.
- Create update branches from the fetched integration branch with Git Flow naming and a `--branch-name` override.
- Accept both routine evidence headings in self-merge. A comment must name the PR head (`HEAD=<full sha>`, the full sha, or the 1.7.0 `head <short sha>` form); a stale head does not count.
- Check configured skill eval records before self-merge.
- Fingerprint gate scripts in new eval records and check them with `--check --fresh`. Older records remain valid under the existing checks.
- Document and test the single URL ID for Next.js parallel route pages.
- Move repository GitHub Actions to Node 24 action releases and verify local CI support.
- Document updater options and deferred work in the maintainer guide.

## 1.7.0

A short update command: `/trust-before-scale:update`, or `node scripts/tbs/update.mjs --branch`.

1. Added the `update` skill and `node scripts/tbs/update.mjs` to update the project kit from an installed plugin, guard protected branches and tracked changes, and run doctor. Session-start notices suggest the short commands when available.

## 1.6.0

Update notice: users are told when a project's kit is behind, with the command to update.

1. Claude Code, Codex, and Gemini CLI can show a session-start update notice with the project update command and an optional daily release check. Doctor reports the project kit version.

## 1.5.2

Kit git calls are safe inside git hooks, plus fixes from reviewing the 1.5.1 upgrades.

1. `doctor.mjs` no longer fails a config without a `level` that keeps its own feature map, matching `lanes.mjs`; it prints a NOTE instead. An explicit level of 2 or more still requires `featureMap`.
2. Vendored scripts, tests, and the installer clear inherited Git repository settings so hook runs use the intended checkout and leave its Git metadata intact.
3. The owed-review audit lists local hook skips when GitHub is unavailable and reports skip-log migration failures.
4. Skill evals require the quoted evidence to name the target file and a required term; the judge may quote several consecutive lines.
5. The Next.js App Router feature-map preset recognizes more page extensions and removes route groups and parallel-route `@slot` folders from route IDs.
6. README: what each adoption level does, and how to change your level.

## 1.5.1

First Linux CI run fix.

1. `self-merge.mjs --ack-skips` no longer crashes where git has no user identity (CI runners); it records `$USER (no git identity)` instead.

## 1.5.0

A stricter merge gate, the Codex project hook from the installer, sample prompts, and maintainer tooling for git flow releases.

1. The merge gate refuses a tested gate log whose `HEAD=` line is not the pinned `--match-head-commit`, and at level 3+ records `git revert` as a lesson.
2. `tbs-init --codex-hook` writes the Codex project merge hook (Codex runs only trusted project hooks); `doctor` warns when a Codex project lacks it or it points at a moved plugin.
3. README: a Usage section with sample prompts for each skill; Codex hook behaviour checked on CLI 0.166.
4. Maintainers: repo-local `cut-release`, `hotfix`, `start-feature` and `run-gates` skills; `scripts/gates.mjs` runs every gate and three fresh installs; CI runs Linux on PRs and `develop`, and Linux plus macOS on `main`.

## 1.4.0

Works in Claude Code, Codex CLI, Cursor and Gemini CLI; adoption by level; a pre-merge routine; a learn loop.

1. One merge-gate hook for all four hosts: it reads each host's payload, denies with exit 2 and the host's own JSON, and answers Cursor's allow paths explicitly. Generated Codex and Cursor manifests and marketplaces, a Gemini extension in `dist/gemini`, and a CI check that generated files are current. Skills are host-neutral; `AGENTS.md`, `GEMINI.md`, a Cursor rule and `docs/harnesses.md` cover each host.
2. New installs write `.agents/trust-before-scale.json`; `.claude/trust-before-scale.json` is still read. One config loader with a JSON Schema: unknown keys and missing required fields are errors, keys starting with `_` and `$schema` are accepted.
3. Eval `reviewer` and `judge` take presets (`claude`, `codex`, `cursor-agent`, `gemini`) or command templates; a judge equal to the reviewer needs `allowSameJudge`.
4. Adoption levels 1–4 (`level`); profiles start at 1, configs without a level keep level-4 behaviour. `doctor.mjs` lists what each level still needs, with a next step. Feature-map presets for Swift, Kotlin, React Router, Next.js and go_router. The Firebase emulator helper is opt-in. A release workflow publishes a tag's changelog section.
5. Hook skips are logged under the git common dir, so every worktree and the lane gate see them; `--ack-skips` lists what it acknowledges and records who.
6. No eval suite, or a level below 4, caps lanes at one; `..` is rejected only as a path segment; check-in times cannot be empty.
7. Fixes #6: `--owed` searches only merged, unreviewed self-merged PRs and fails closed past GitHub's search cap.
8. Judge evidence must name the seeded file and a required term; new suites run each review twice. Older records are reported by `--check` until re-run.
9. `tbs-init --ci` adds a GitHub Actions workflow that runs the vendored tests, `doctor --ci` and the adopted checks, with no agent CLI or secrets.
10. The `routine` skill and `routine.mjs plan`: run only the reviews a diff needs, in a fixed order, prefer each host's own skills, replace a review that produced nothing, route every finding, and write one exact-head evidence block. New pass skills: simplify, code-review, deep-review, security-review, user-roles, edge-cases, design-audit (with 31 UX and motion laws) and verify-walk, each with seeded eval cases in the Acme profiles.
11. The learn loop: `learn.mjs add | sync | --due | --recurred` and the `learn` skill record mistakes, count repeats, draft a check for the owner, and flag checks that did not hold. At level 3+, a recent recurrence or too many due classes caps lanes at one.
12. Docs: the README explains why, the six decisions and the levels, with install steps per host; `docs/recipes/` has seven worked scenarios.
13. Maintainers: `scripts/ci-local.mjs` runs the CI workflow on a PR locally and can post a `ci-local` status when Actions cannot run; releases follow git flow (`docs/maintaining.md`).

## 1.3.0

1. Publish invented profiles and neutral generic seeds, private profile installation, public documentation, licensing, manifests and CI.
2. Add an optional private-pattern tree and history leak check.
3. Add `tbs-init --profile-dir <path>` (or `TBS_PROFILE_DIR`) to install a profile kept outside the kit.
4. Behaviour change: when `selfMerge.excludeHeads` / `excludeLabels` are not set, `self-merge.mjs` now falls back to `^external/` and `external-agent`. Projects that relied on the old fallback should set both keys explicitly.

## 1.2.2

1. Remove an unused destructured variable from a lane-gate test; a project that lints `scripts/` with warnings as errors failed lint on the vendored tests.

## 1.2.1

1. The lane gate checks the kit's feature map only when the project configures `featureMap`. A thin install that keeps its own feature map (Acme Web) was held at one lane permanently; the gate now prints a note instead. An adopted map that is red still caps.

## 1.2.0

1. Add the fail-closed `lanes.mjs` trust gate and optional `autopilot` config, with profile ceilings and owner check-ins.
2. Add `trust-before-scale:autopilot`: a shared loop that defers to project extensions, plus gate guidance in the method and ADR.
3. Add `self-merge.mjs --ack-skips` so reviewed hook skips stop capping lanes; later skips still require review.

## 1.1.6

Hardening from Acme Mobile's review, with Codex cross-review.

1. Bypass project hooks when pushing review snapshots so stale records can be re-earned.
2. Give seed commits an explicit ordinary identity, including clones without global Git identity.
3. Compare both sides of renames in the leak self-check.
4. Ignore header-like content inside patch hunks when reading file targets.
5. Normalize trailing slashes when checking hidden paths and suite overlaps.
6. Remove gate branches even when worktree creation fails.
7. Blind-check the effective default commit message.
8. Copy review link directories once per run into isolated scratch storage and remove it afterwards.
9. Keep full reviews under the project git common directory by default, preserving `TBS_REVIEW_DIR`.
10. Move installer coverage into kit-only tests so vendored tests have no skipped installer test.
11. Read every file in plain multi-file patches by counting hunk lines, including header-like content.

## 1.1.5

1. Judge the whole review: every top-level assistant message from `claude -p --output-format stream-json --verbose`, not only the final `result`. A review that ended with a short addendum hid all its findings from the judge; this caused Acme Web's `empty-balance` and `open-paper-stream` false misses.

## 1.1.4

1. Keep every review case's full review text and the judge's raw answer in `TBS_REVIEW_DIR` (default `<tmp>/tbs-reviews`); a failed case's evidence names the file. Without it a "not caught" could not be told apart from a strict judge.

## 1.1.3

1. Fix 1.1.2's review snapshot failing on every case ("sanitize failed") when the checkout's hidden files differ from the suite base, which is always true while a project updates the kit. Found on Acme Mobile's first 1.1.2 run.

## 1.1.2

1. Run blind review evals in hermetic snapshot repositories, hiding answer keys from files and git history. Suite `hidePaths` adds project-specific exclusions; gate cases retain worktrees.
2. Include effective hidden paths in settings hashes: all existing eval records become stale and must be re-earned with a new run. Validate effective branch names and reject hidden seed targets and skill/link overlaps.

## 1.1.1

1. A gate killed by a signal, or one that failed to start, no longer counts as catching a seeded fault (found by Acme Web's Codex review, 15 Nov 2026).
2. `--check --fresh` fails a record whose date is missing or invalid instead of passing it.

## 1.1.0

1. Correct Acme Flutter's develop-merge policy and keep its self-merge lane off pending decision 4.
2. Require configured PR evidence comments on the current head; configure both for Acme Flutter.
3. Refuse changes to existing eval files in the self-merge lane while allowing additions.
4. Require a reason for hook skips, log them in the git directory and show them with owed reviews.
5. Fail empty eval suites and feature discovery; check for stale seeds during eval dry runs.
6. Allow Codex's default judge model and a TBS_JUDGE_MODEL override; remove the generic model pin.
7. Widen whole-word blinding checks and record passes/repeats, requiring every repeat to pass.
8. Add non-clobbering project updates with per-file status and an installed VERSION record.
9. Prioritize architecture through docs for repeated mistakes, with red proof and an enforcer table.
10. Investigate answerable questions first and batch owner decisions with evidence, risk and fallback.
11. Link feature-map entries to verification journeys and capture their preconditions.
12. Credit Lauren Tan's MIT pstack, explain the comparison and document updates and project provenance.
13. Bump the plugin version to 1.1.0 and add this changelog.
14. Bind required PR evidence to the head declared on the matching heading line, ignoring body SHAs.
15. Record evaluation settings hashes and require a new eval when effective settings change or the hash is missing.

## 1.0.0

initial export
