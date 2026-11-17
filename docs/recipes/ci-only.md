# CI only, no agent

**Situation.** Your team wants the checks on every PR without installing an agent plugin.

**Level 1 and up.**

```bash
node "$TBS_PLUGIN/bin/tbs-init" generic --ci
```

This vendors the scripts into `scripts/tbs/` and adds `.github/workflows/trust-before-scale.yml`. On each
PR it runs the vendored tests, `doctor.mjs --ci`, and, at the levels you adopted, the feature map and
`skill-eval.mjs --check`. It needs no agent CLI and no secrets. `--update` leaves an existing workflow alone.

**Working looks like.** A PR that removes a mapped screen without updating the feature map, or lets
an eval record go stale, fails the workflow with the reason.
