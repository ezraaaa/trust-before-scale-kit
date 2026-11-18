---
name: update
description: "Update the vendored Trust before scale kit from an installed plugin. Use when asked to update trust before scale, update the kit, run a kit update, or run tbs update."
---

# Update the project kit

1. Work from the Git repository root. If `scripts/tbs/update.mjs` exists, run
   `node scripts/tbs/update.mjs --branch`. It checks for tracked changes, creates an update branch
   from a protected branch or detached HEAD, and runs doctor after updating. If it reports that the
   project is current, stop.
2. For an older project without the updater, check that the tree is clean of tracked changes first.
   Read the installed kit version and the project's `scripts/tbs/VERSION` and proceed only if the
   installed kit is newer. Create `chore/tbs-kit-<new version>` from the current HEAD. Substitute
   the base directory shown when this skill loaded and run
   `node "<this skill's base directory>/../../bin/tbs-init" --update` from the repo root. Pass
   `--codex-hook` if the project's `.codex/hooks.json` already has the kit's Bash merge-gate command
   or the user requests it. Then run `node scripts/tbs/doctor.mjs`.
3. Stop on a failed update or doctor check and report the failure. After a successful update, review
   `git diff`, run the project's gates, commit, and open a PR following the project's rules and
   approval requirements. Never merge without the user's go-ahead.
