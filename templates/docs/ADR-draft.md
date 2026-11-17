# Trust before scale: checks, a feature map and skill evals before more agents ({project})

**Status:** proposed. Move it into the project's decision log with its next number once the owner decides each item.

## Context

Agent output is limited by how much of it can be trusted without a full human read, not by how many agents run.
Each repeated review finding or process failure that lives only as a note will repeat; a check that fails on it will
not. This adopts the trust-before-scale method for {project}: build verification first, measure it, and only then
run more agents or let more merge without a full read.

## Decisions (accept, change or reject each)

1. **Resolve repeated mistakes at the strongest layer.** Start with architecture that prevents the mistake;
   then try types, a lint whose error explains the fix, a test, and a hook or gate, in that order. Use docs last
   for what still needs judgment. Prove each check red on a real past mistake before trusting it. Keep the
   rule-to-enforcer table in `docs/trust-before-scale/enforcers.md` current. Each exception needs a reason,
   an expiry date and a human's approval. The plugin's merge gate pins the verified head, tests `EXIT=0` in
   the same `&&` chain, and forbids piping a gate.
2. **A feature map that walks read.** `docs/feature-map.json` lists every screen, who reaches it, how a walk signs in,
   what shows it has loaded, and each act that changes something. `node scripts/tbs/feature-map.mjs` fails when the
   code gains a screen the map does not name.
3. **Evals for the review skills.** `evals/routine/cases/` holds faults this project has really shipped or nearly
   shipped. `node scripts/tbs/skill-eval.mjs routine` runs each blind and records the result. The gate runs
   `skill-eval.mjs --check`, so a change to the review skills cannot merge without a fresh, fully passing run.
   The release runs `--check --fresh` (a record older than 7 days stops it).
4. **A self-merging low-risk lane.** PRs that touch only the allowed paths in `.claude/trust-before-scale.json`
   (tests, briefs, notes, eval cases) merge once every gate log and the Codex review prove green on the exact head.
   They are labelled `self-merged`, and Claude reviews each one at the next session (`self-merge.mjs --owed`).
   Off until this item is accepted (`selfMerge.enabled`).
5. **Find answers before asking the owner.** First check whether a run or the code can answer the question;
   if it can, investigate and use that answer. Batch the questions that remain at check-ins. For each, give
   the recommended pick, the evidence, the risk, and what happens if no answer comes.
6. **Scale after trust.** Run `node scripts/tbs/lanes.mjs` before each lane launch and never exceed its count.
   It requires fresh evals (normally within 7 days), reviewed self-merges and hook skips, and a green feature map;
   an unavailable check allows only one lane. `autopilot.maxLanes` sets the owner's ceiling.

## Do not fix back

- A check replaces a note only after it has been seen red. Shorten the prose rule to one line naming the check.
- The lane never covers product code, security rules, functions, payments, auth, release config, `.claude/` or
  agent instructions, whatever the allow-list says: its block-list wins.
- No eval or lane ever answers an owner confirmation on the owner's behalf.

Blind review cases use a hermetic repository containing only a sanitized base snapshot and the seeded commit; hidden answer keys are absent from both files and git history. Optional suite `hidePaths` adds repo-relative paths to the defaults (`evals`, `.claude/trust-before-scale.json`, `docs/trust-before-scale`, `scripts/tbs`); these must not overlap skills or linked directories.
