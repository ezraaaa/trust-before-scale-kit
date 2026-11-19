# Routine extension: trust-before-scale-kit

Read with the `routine` skill and `.agents/trust-before-scale.json`. This repo is the kit itself: a
plugin, its vendored scripts, hooks and an installer. It has no app, screens or user accounts.

## Gates

- Full gates: `node scripts/gates.mjs` from the repo root (the `run-gates` skill). Each gate writes a log
  under a temporary `tbs-gates-logs-*` directory that starts `HEAD=<sha>` and ends `EXIT=<code>`. Every
  gate log must end `EXIT=0`. `--quick` skips the fresh installs and is diagnostic only.
- Evidence for a merge is one log of the whole run, not one gate's log:
  `{ echo "HEAD=$(git rev-parse HEAD)"; node scripts/gates.mjs; } > gate.log 2>&1; echo "EXIT=$?" >> gate.log`.
- For a PR: `node scripts/ci-local.mjs --pr <N>`; read every job log, including NOT RUN jobs.
- Gates test the working tree. Commit first, then run them, so the logs prove the committed head.

## Generated files

`scripts/build-harness.mjs` generates `dist/gemini/`, the Codex and Cursor manifests and hook files,
`.agents/plugins/marketplace.json`, `scripts/tbs/` and `docs/trust-before-scale/brief-template.md`.
Review the source, not the output; `harness-check` proves the output matches. A diff that edits a
generated file by hand is a finding.

## Surfaces for security-review

Who can reach what: the merge-gate hook (`plugins/trust-before-scale/hooks/merge-gate.py`) runs on
every shell command in configured projects; `bin/tbs-init` and `templates/scripts/update.mjs` write into
other people's repositories; `hooks/update-notice.mjs` runs at session start; `.github/workflows/` runs
with repository tokens; `scripts/leak-check.mjs` guards private names and reads the gitignored
`.leakcheck.local` in place. Never read, print or copy `.leakcheck.local`.

## Passes that do not apply

- **user-roles:** not run: the kit has no user roles or permissions model. Who can reach a surface is
  covered by security-review.
- **design-audit:** not run: no `routine.designSystem` configured; the kit has no UI.
- **verify-walk:** not run: no browser or simulator journey. The real journeys (install, update,
  doctor) run in the `install-*` gates; name those gate logs instead.

## Rules that the kit's review must hold

- Gate code (the `gate-code` row) changes need a test that fails first, and its red output in the PR.
- A shipped skill or template change reaches every adopting project: check `CHANGELOG.md` gets a line and
  that `dist/gemini/` was regenerated.
- Eval cases are never deleted to make a suite green (`skill-eval` skill).
