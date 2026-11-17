# Contributing

Start with [maintenance gates](docs/maintaining.md). Keep changes focused and leave
all tests enabled. Run both manifest validators, the three test gates, a fresh install,
and the leak checker before opening a PR. Branch from `develop` and open PRs against it; `main`
only receives releases.

To add an eval, create `profiles/<profile>/evals/<suite>/cases/<id>/case.json` and
`seed.patch` under `plugins/trust-before-scale/`. The JSON names `id`, `rule`,
`mustName`, `file`, `branch`, `message` and `expect` (`review` or `gate`). Gate cases
also name `gate`. Use an ordinary commit message and branch that do not reveal the
fault. The patch must apply to the configured base; new-file seeds are portable.
Run `node scripts/tbs/skill-eval.mjs <suite> --dry-run` in an installed project,
then the actual eval after configuring its review skill. Never weaken or skip tests.

Every release changes the plugin manifest version and CHANGELOG.md. The marketplace
must not duplicate that version: clients use the plugin version to detect updates.

Use invented examples only: Acme, acme-mobile, acme-flutter, acme-web,
`com.example.acme`, and `<owner>/<repo>#123`. Never include client names, private paths,
bundle identifiers, internal decision numbers or real project excerpts. Keep private
patterns only in ignored `.leakcheck.local`; never copy them into fixtures or commits.

When Actions cannot run, use the [local CI runner](docs/maintaining.md#when-actions-cannot-run).
