# Maintaining the kit

## Gates

Run from the repository root before review and release. No test may be skipped.

Run `node scripts/gates.mjs` (or the repo-local `run-gates` skill). It runs, in order:

1. Repository script tests, vendored script tests and plugin tests.
2. The merge-gate smoke test and generated harness check.
3. Strict marketplace validation and plugin directory validation.
4. The private-name leak check.
5. Three fresh temporary git installs: `generic --ci`, `acme-mobile`, and a copy of the
   generic profile installed via `--profile-dir`; each runs doctor and all vendored tests.

Each gate prints PASS or FAIL with a retained log in a temporary
`tbs-gates-logs-*` directory. Logs record HEAD, commands, output and exit code; temporary
install directories are removed even on failure. Changes in the working tree are tested too,
so uncommitted results do not prove a committed head. Re-run after committing for release evidence.
`--quick` skips the three installs for diagnosis only; it is not full verification.
The runner never reads or copies `.leakcheck.local`; the leak-check subprocess reads it in place.

## When Actions cannot run

CI is sized for a private repository's free Actions quota, where macOS minutes count ten times.
Pull requests and pushes to `develop` run only the Linux job (Node 20 and 22). The macOS job runs on
pushes to `main` and on a manual run. Tags do not trigger CI: a release tag is pushed with `main`,
which already runs both jobs on the same commit. Feature branches run once their PR is open; a
newer push cancels the older run. On a Mac, `ci-local.mjs` skips the conditional macOS job unless you
pass `--all-jobs`, and a run in which no job ran is reported as failed.

Run `node scripts/ci-local.mjs --pr <N>` on the review machine. It fetches the PR,
merges its head into the current origin base in a temporary detached worktree, and
executes that tree's CI workflow for each local OS/Node combination. Other OS jobs
are reported as NOT RUN. Uncommitted changes are not tested.

Node 22 must be on PATH or configured with `TBS_CI_NODE22`; Node 20 uses
`TBS_CI_NODE20` or the runner's cache (a missing runtime prints an install command).
The overrides accept an executable or bin directory. Legacy `*-ci/node20/bin`
caches under `~/.cache` are also searched, with the version verified before use. Global npm installs use a
temporary prefix. The ignored `.leakcheck.local` is copied privately for leak checks.
Logs under the git common directory's `tbs-ci-local/<pr>-<merge-sha>/` record the
merge, PR head, Node version, commands, outputs and exit code. Review those logs
alongside the summary; local evidence covers only the OS actually run.
Use `--keep` to preserve the temporary worktree and installs, and `--post` only when
you intend to publish a `ci-local` status on the PR head. Without it nothing is posted.
The runner supports a strict subset of workflow YAML and fails on unsupported fields.

## Generated files

`scripts/build-harness.mjs` generates the Codex and Cursor manifests and marketplaces,
`.agents/plugins/marketplace.json`, the Codex/Cursor hook files and the Gemini extension in
`dist/gemini/` from the Claude manifest, `hooks/hooks.json` and the plugin folder. Edit the sources,
then run it. Codex's sandbox cannot write `.agents/`; there, use `--skip-agents-marketplace` and
regenerate in a normal checkout before merging.

## Private names

Real project names belong only in the gitignored `.leakcheck.local` (one regex per line, a leading
`(?i)` for case-insensitive). Examples use invented Acme projects. `node scripts/leak-check.mjs --history`
checks every commit; history matches need owner action.

## Release

Use the repo-local `start-feature`, `cut-release` and `hotfix` skills for the git flow cycle;
use `run-gates` before review and release. Each first checks `git flow version` and `git config --get gitflow.branch.develop`. If the executable
is missing, install it with `brew install git-flow`. Stop on a dirty tree, a starting branch behind
or diverged from origin, an existing version tag or missing changelog section; never stash or reset
owner work. Fetch origin before comparing branches. Tagging, pushing `main`/tags, creating a release
and publishing the `gemini` branch need the owner's explicit go-ahead in that session.

Releases use git flow (`git flow init -d`, then `git config gitflow.prefix.versiontag v`). Work lands
on `develop`; `main` holds released code only. Run `git flow release start X.Y.Z`, bump the version in
`plugins/trust-before-scale/.claude-plugin/plugin.json` only, run `node scripts/build-harness.mjs`, add a
`CHANGELOG.md` section, run `node scripts/gates.mjs`, get review and the owner’s explicit go-ahead. Then `git flow release finish -m vX.Y.Z X.Y.Z` merges
into `main` and `develop` and tags `vX.Y.Z`; push `main`, `develop` and the tag. The release workflow
publishes the changelog section; when Actions cannot run, first check `gh release view vX.Y.Z` (stop on errors other than confirmed not-found), then create an absent release with `gh release create vX.Y.Z --title vX.Y.Z --notes-file <release-notes-file>`
from the same section. Publish the Gemini
branch so each release is one fast-forward commit on top of the last:
`git clone --branch gemini --single-branch <origin-url> <dir>` (on the very first publish, `git init -b gemini`
and `git remote add origin <origin-url>` instead), delete every tracked file there (`git rm -rq .`), export
with `node scripts/build-harness.mjs --gemini-dir <export>` into a separate new directory, and copy the
export's contents into `<dir>`. Before committing, run the source checkout's `scripts/leak-check.mjs`
from `<dir>`, using a private temporary copy of `.leakcheck.local` there (never stage it; remove it
immediately after checking), and check the staged file list excludes it. Commit `gemini X.Y.Z`, then with
the owner's go-ahead `git push origin HEAD:gemini`. Never force-push; if the push is rejected, stop for the
owner. Remove both temporary directories afterward.
Installed projects update with `node <plugin-dir>/bin/tbs-init --update` on a project branch, then
re-earn eval records if the runner, skills, seeds or settings changed.

## Working with Codex lanes

Put Codex worktrees under `~/Development/tools/tbs-kit-<lane>` (its sandbox only writes under
`~/Development`) and launch Codex with that worktree as its working directory. Codex cannot commit:
review, then commit and merge one lane at a time. Each brief lists the lane's allowed files with full
paths, including any existing test files the lane may need to update.

## State (18 Nov 2026)

1.7.1 is released: tag `v1.7.1` on `main`, with the `gemini` branch published. This public repository
starts from a fresh history at 1.5.0; earlier history stays private with the owner. Hosted CI runs and is
green on `main` (Linux and macOS, Node 20 and 22); the release workflow publishes releases.

`main` and `develop` are protected: the `linux (20)` and `linux (22)` checks are required, and force-pushes
and deletions are blocked. Admins are not enforced, so `git flow release finish` and `hotfix finish` can
push `main` directly; contributors go through PRs against `develop`.

Codex CLI 0.166: the trusted project hook blocks an unpinned merge; the plugin-shipped hook is not
confirmed (`plugin_hooks` shows as removed); see `docs/harnesses.md`. Untested so far: Cursor, Gemini and
Antigravity installs (none installed on the review machine). The kit workflows run on Node 24 action majors
since 1.7.1.

**Adoption.** The owner's five projects all run 1.7.1 (four updated with `update.mjs --branch`, one new install at
level 4 from the generic profile), each merged into its `develop`. Projects update with
`node scripts/tbs/update.mjs --branch` or the `update` skill; the update notice tells them when.

**Handoff for the next session (Codex or Claude).** Nothing is in flight: no open PRs, branches or worktrees.
Next work, in order:
1. The 1.7.2 patch in the Backlog below (owner deferred it; plan it first, then release as usual).
2. A public demo project at level 2.
3. A long-form explainer.

## Backlog

- Expand gate fingerprinting to script dependencies and package-manager scripts. Resolving those
  inputs would need command-specific logic. This release fingerprints the command and the main
  script when it can resolve that file directly.
- Update the optional project CI template separately. This release updates the kit's own
  workflows, so existing project workflow files retain their current runner requirements.
- Next patch (1.7.2), owner deferred on 2026-11-18. Each item needs a test that fails first:
  - `update.mjs --branch` compares versions on the starting checkout. Read `scripts/tbs/VERSION` from the fetched
    base, and stop if the installed kit is not newer (this prevents a downgrade).
  - Without `gitflow.*` config, `--branch` uses `chore/`. Decide a default the git-flow projects accept, or require
    `--branch-name`.
  - Gate fingerprint: `skill-eval --check --fresh` compares the seeded script with the unseeded checkout. A seed that
    edits its own gate script reads stale right after passing. Fingerprint the same inputs on both paths.
