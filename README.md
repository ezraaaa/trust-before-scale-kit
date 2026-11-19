# Trust before scale

Hard checks, review evals and a guarded merge lane for projects built with coding agents.

Repeated mistakes become executable checks.
A feature map makes verification cover what users can actually do.
Seeded faults measure review skills before you add more agents.

For maintainers using coding agents who want evidence before scaling parallel work.
Works in Claude Code, Codex CLI, Cursor and Gemini CLI, alone or mixed. Supports native,
Flutter and web projects; examples are invented Acme applications.

## Why

Running more agents is easy. Knowing their work is right is not. Most teams scale agent count
first and discover the review gap later, in production. This kit reverses the order: every
claim an agent makes ("tests pass", "reviewed", "safe to merge") has to come with evidence a
script can check, and the number of parallel agents is capped by how much of that evidence is
current. When trust drops, the cap drops with it.

It packages six working decisions:

| Decision | What you get |
|---|---|
| 1. Prevent repeated mistakes at the strongest layer | Architecture → types → lint with the fix in its error → test → hook or gate → docs last. Each check is proven red on the real past mistake and tracked in a rule-to-enforcer table. The first check ships with the kit: a merge gate that pins the verified head and tests the gate's exit code |
| 2. A feature map that walks read | `feature-map.mjs` finds every screen in the code and fails when one is not mapped |
| 3. Evals for the review skills | Seeded faults run blind through your review skills; an independent judge scores them; stale records cap scaling |
| 4. A low-risk self-merge lane | Tests, briefs, notes and eval cases can merge once logs prove green on the exact head, then get reviewed afterwards. Off until you accept it |
| 5. Questions batched | Answer what code or a run can settle first; batch the rest with a recommended pick and evidence |
| 6. Scale after trust | `lanes.mjs` sets how many agents may work in parallel from fresh evals, owed reviews, hook skips, the feature map and repeated mistakes |

Around those sit a pre-merge **routine** that runs only the reviews a diff needs and leaves one
exact-head evidence block, and a **learn loop** that records mistakes, counts repeats, drafts
the check, and notices when a check stops holding.

### Adopt one level at a time

| Level | Adds | Start with |
|---|---|---|
| 1 | Merge gate: no merge without exact-head, green evidence | `tbs-init generic`, then `doctor.mjs` |
| 2 | Feature map | `feature-map.mjs --init` |
| 3 | Review evals, routine and learn loop | `skill-eval.mjs <suite> --dry-run` |
| 4 | Parallel lanes and the self-merge lane | `lanes.mjs` |

Set `"level"` in the config; scripts above your level say "not adopted" instead of failing.
See [recipes](docs/recipes/) for worked scenarios.

#### What each level does

Each level keeps everything below it.

- **Level 1: merge gate.** The hook blocks `gh pr merge` unless the command pins the head that went
  green (`--match-head-commit`) and tests the gate log's exit line in the same `&&` chain; an existing
  gate log must name that head. Scripts for higher levels report "not adopted". One agent at a time.
- **Level 2: feature map.** `feature-map.mjs` checks that every screen or route found in your source
  is accounted for: either mapped, or listed in `notMappedYet` with a reason. A new screen fails until
  you do one or the other. `doctor.mjs` checks the map and its sources exist.
- **Level 3: proven reviews and learning.** `skill-eval.mjs` runs your review skills against seeded
  faults and `--check` fails when a record is missing, stale or red. `learn.mjs` records mistakes (the
  hook records its own blocks and `git revert`), and `doctor.mjs` reports repeating ones. `doctor.mjs`
  also checks the eval suites, their skills and an independent judge.
- **Level 4: scale.** `lanes.mjs` allows up to `autopilot.maxLanes` agents at once, and drops to one
  while any eval is red or stale, the feature map check fails, a self-merge review is owed, a hook skip
  is unacknowledged, a check did not hold, or too many mistakes repeat. The self-merge lane becomes
  available for low-risk paths, but stays off until you set `selfMerge.enabled` after accepting the ADR.

#### Changing your level

1. In `.agents/trust-before-scale.json` (or the older `.claude/trust-before-scale.json`), set `"level"`
   to 1, 2, 3 or 4.
2. Run `node scripts/tbs/doctor.mjs`. It lists what the new level still needs, each with a next step.
3. Commit the config change on a branch and merge it like any other change: it changes what your
   gates and lanes allow.

You can move down at any time; checks above the new level report "not adopted". Below level 4,
`lanes.mjs` allows one agent at a time and the self-merge lane is off; below level 3 `/autopilot` is
supervised (fully at level 1; see "Running agents unattended"). A config with no `level` keeps
level-4 behaviour, which is how installs from before levels existed keep working; set it explicitly to
step down. `tbs-init --update` keeps your level.

## Quickstart

Install in whichever tools you use; they share one project config and one merge-gate script.

**Claude Code**

```sh
claude plugin marketplace add ezraaaa/trust-before-scale-kit
claude plugin install trust-before-scale@trust-before-scale-kit
```

**Codex CLI**

```sh
codex plugin marketplace add ezraaaa/trust-before-scale-kit
codex plugin add trust-before-scale@trust-before-scale-kit
```

From your project, run `node "<plugin-root>/bin/tbs-init" generic --codex-hook`
(or `--update --codex-hook` for an existing install), then trust it in `/hooks`: Codex skips untrusted hooks
silently, and the plugin-shipped hook is not confirmed to run. Steps: [harnesses](docs/harnesses.md).

**Cursor**: add `https://github.com/ezraaaa/trust-before-scale-kit` under Settings → Plugins (or
`/add-plugin` in chat), and review the hook in Cursor's hook settings.

**Gemini CLI**

```sh
gemini extensions install https://github.com/ezraaaa/trust-before-scale-kit --ref gemini
```

Antigravity users can import the Claude plugin or the Gemini extension with `agy plugin import`.
Per-tool details, including what has and hasn't been tested on each, are in [harnesses](docs/harnesses.md).

To pin a release, add `#v1.7.1` to the repository source (`--ref v1.7.1` for Gemini).

## Requirements

| Dependency | Status | Purpose |
|---|---|---|
| One of Claude Code, Codex CLI, Cursor, Gemini CLI | Required | Skills and the merge hook |
| Node.js 20 or 22 | Required | Installer and local checks |
| Git | Required | Exact-head evidence, worktrees, eval isolation |
| Python 3 | Required | Merge hook |
| A second agent CLI | Optional | Independent eval judge and cross-review (level 3) |
| GitHub CLI (`gh`), authenticated | Optional | Self-merge lane and owed reviews (level 4) |
| Project build tools / Firebase emulators | Optional | Stack-specific gates |

Runs on macOS and Linux. Windows is untested. The kit collects no telemetry and makes no network
calls of its own; it only runs the tools you configure.

## Your first 10 minutes

1. Open your project's Git checkout and ask your agent to run the `setup` skill
   (`/trust-before-scale:setup` in Claude Code). Choose `generic`; the skill runs `bin/tbs-init`.
   Add `--ci` for a GitHub Actions workflow.
   For manual setup, set `TBS_PLUGIN` to the installed `plugins/trust-before-scale` directory
   and run `node "$TBS_PLUGIN/bin/tbs-init" generic` from your project.
2. Run `node scripts/tbs/doctor.mjs`; it lists what is missing for your level and the next step.
   Inspect `.agents/trust-before-scale.json` (it starts at level 1). The installer adds `scripts/tbs/` (including
   `VERSION`), `evals/routine/cases/`, and `docs/trust-before-scale/` with NOTES, an ADR,
   an enforcer table and a brief template. Existing files are kept unless `--force` is used.
3. Run `node --test scripts/tbs/*.test.mjs` to see the kit checks run.
4. Edit feature discovery for your source tree, then run
   `node scripts/tbs/feature-map.mjs --init`. Fill in the pending screens in
   `docs/feature-map.json`, including roles, journeys and expected results. Run
   `node scripts/tbs/feature-map.mjs` to check coverage; a screen that is neither mapped nor listed in
   `notMappedYet` with a reason fails.
5. Configure a project review skill at the suite's `skills` path, its `reviewPrompt`,
   and a reachable base branch (`develop` by default). Run
   `node scripts/tbs/skill-eval.mjs routine --dry-run` to validate seeds, then
   `node scripts/tbs/skill-eval.mjs routine` to run reviews and judging.
   `node scripts/tbs/skill-eval.mjs --check` checks the saved record.
6. Run `node scripts/tbs/lanes.mjs` to see the allowed concurrency and its reasons.
   Add feature-map and eval checks to your own gate. Review the ADR before enabling merges.

`generic` is a starting template, not a claim that your app is verified. Its three portable
new-file faults cover an embedded secret, missing authorization and a vacuous test.
`acme-mobile` demonstrates separate iOS/Android/Firebase gates; `acme-flutter` demonstrates
one Flutter/Firebase gate. Both include invented rules, cache/token or translation faults.
Adapt all examples and success patterns to your project.

Private profiles can stay in your own repository:

```sh
node "$TBS_PLUGIN/bin/tbs-init" --profile-dir ./private/tbs-profile
TBS_PROFILE_DIR=./private/tbs-profile node "$TBS_PLUGIN/bin/tbs-init"
```

The directory contains `trust-before-scale.json`, optional `NOTES.md`, and optional
`evals/<suite>/cases/`. The flag overrides the environment variable. Paths resolve
from the current directory. `--update` needs no profile and preserves project settings.

The `nextjs-app` feature-map preset merges parallel routes by URL. For example,
`app/@modal/photo/page.tsx` and `app/photo/page.tsx` share one `/photo` entry.

## Usage

You work through skills. In Claude Code they are prefixed: `/routine` is
`/trust-before-scale:routine`. In Codex, Cursor and Gemini, name the skill in your prompt
("use the routine skill …"). The examples below use the short names.

### Before every PR: `/routine`

The skill you will use most. It reads the diff, runs only the reviews that change needs, in a
fixed order, fixes or routes every finding, and writes one evidence block for the exact head
commit. It never merges.

```
/routine this branch adds offline sync to the notes screen. run what it needs and give me
the evidence block for the PR.
```

```
/routine design-only change to the settings page. skip what doesn't apply, but say why.
```

### When something slips through: `/learn`

Record the mistake. On a repeat, it drafts a check for you to approve, so the same class of
mistake is caught by a test, a lint or a gate next time, not by a reviewer's memory.

```
/learn the reviewer missed that the export endpoint skips the role check. that's the second
time this month.
```

```
/learn what is due? show me the mistake classes that keep coming back.
```

### Before running more agents: `/method`

Start a session with it, or ask it whether the evidence supports more agents. It answers with
the lane count `lanes.mjs` allows and the reasons, never a guess.

```
/method can I run three agents on the backlog tonight?
```

```
/method review what self-merges are owed before I start.
```

### Running agents unattended: `/autopilot`

Works the backlog in a loop, never running more lanes than `lanes.mjs` allows, and stops
launching while a finished lane waits for review. Supervision lifts with the adoption level: at level 1
you start every run and approve every plan and merge; level 2 lets it merge docs and prose; from level 3
runs may be scheduled and it merges code after routine, gates and evals (gate code and governance stay
yours); level 4 is the full loop. Unattended runs need level 3 or higher.

Level 4, with the self-merge lane on:

```
/autopilot work the milestone overnight. one PR per issue, routine evidence on each, merge
nothing that isn't allowed in the self-merge lane.
```

### Proving your reviews still work: `/skill-eval`

Runs your review skills against seeded faults and checks they still find them.

```
/skill-eval the code-review skill changed. re-run its suite and tell me what it missed.
```

```
/skill-eval a review missed a leaked token in a config file. add that as a seeded case.
```

<details>
<summary>All skills</summary>

| Skill | Use it when |
|---|---|
| `setup` | You are adopting the kit in a project. Copies the scripts, config, eval cases and ADR draft. |
| `method` | You start a session, or are deciding whether to run more agents. |
| `routine` | A change is ready for review. Runs the passes below as the diff needs them. |
| `update` | Update the project kit from an installed plugin, run doctor, and prepare a PR. |
| `learn` | A review missed something, a gate went red on merged code, or you corrected an agent. |
| `skill-eval` | A review skill changed, before a release, or to add a seeded fault after a miss. |
| `self-merge` | A PR touches only low-risk paths (tests, briefs, notes, eval cases), or reviews are owed. |
| `autopilot` | You want the backlog worked within the allowed lanes: supervised below level 3, unattended from level 3. |
| `simplify` | You want a change made smaller without changing behaviour. Runs before correctness review. |
| `code-review` | You want concrete regressions found in a settled change, with evidence. |
| `deep-review` | You want a change checked against your project's rules and recorded decisions. |
| `security-review` | A change touches who can reach a surface or its data. |
| `user-roles` | A change affects what different roles can see or do. |
| `edge-cases` | You want states, timings and actors beyond the happy path explored. |
| `design-audit` | A UI change needs checking against your design tokens, 31 UX and motion laws, and persona critics. |
| `verify-walk` | You want changed journeys walked in a browser or simulator on the exact head. |

`routine` runs the review passes for you; call one directly when you want only that review.

</details>

For longer walk-throughs, see the [recipes](docs/recipes/).

## Glossary

| Term | Meaning |
|---|---|
| Gate log | Command output with one `HEAD=<40-character sha>` line and a final exit marker |
| Lane | One concurrent unit of agent work; the lane gate limits concurrency by evidence |
| Seeded fault | A deliberately bad patch used to measure whether a check or review catches it |
| Owed review | A self-merged PR still awaiting the follow-up review label |
| Self-merge lane | Opt-in path that may merge low-risk PRs only after exact-head gate and review evidence |

## Configuration reference

The file is `.agents/trust-before-scale.json` (projects set up before 1.4.0 keep `.claude/trust-before-scale.json`, which is still read). Every key is in the [JSON Schema](plugins/trust-before-scale/schema/config.schema.json); keys starting with `_` are comments. Regex values are strings using JavaScript
syntax (the Python hook interprets gate-command patterns). Defaults below are runtime
fallbacks; the shipped profiles explicitly set some values. Omit optional blocks to disable
that integration. `_why_off` is explanatory metadata, not a setting read by scripts.

| Key | Type | Default / behavior |
|---|---|---|
| `level` | integer 1–4 | Absent means 4 (pre-1.4.0 behaviour); profiles start at 1 |
| `project` | string | Profile name; generic substitutes checkout directory name; descriptive |
| `baseBranch` | string | `develop` |
| `mergeGate.exitMarker` | string | Hook: `VERIFY_EXIT=0`; JS lane: `EXIT=0`; profiles explicitly use `EXIT=0` |
| `mergeGate.requireMatchHead` | boolean | `true` |
| `mergeGate.requireExitTest` | boolean | `true` |
| `mergeGate.gateCommandPattern` | regex string | Built-in test/build/lint command recognizer in `hooks/merge-gate.py` |
| `selfMerge.enabled` | boolean | Disabled unless truthy; all profiles set `false` |
| `selfMerge.allow`, `selfMerge.block` | regex string arrays | `[]`; block wins; all paths must be allowed |
| `selfMerge.testFile` | regex string | Unset; identifies tests whose deletion blocks eligibility |
| `selfMerge.label` | string | `self-merged` |
| `selfMerge.reviewedLabel` | string | `reviewed-after-merge` |
| `selfMerge.excludeHeads` | regex string | `^external/`; generic explicitly sets this neutral prefix |
| `selfMerge.excludeLabels` | string array | `["external-agent"]`; profiles explicitly set `[]` |
| `selfMerge.gateRanPattern` | regex string | Unset; merge denied without a gate success recognizer |
| `selfMerge.review.ranPattern` | regex string | No runtime fallback; configure proof the review ran |
| `selfMerge.review.findingPattern` | regex string | Owed review: `\[P[0-3]\]`; configure explicitly for merge reviews |
| `selfMerge.requiredComments` | object array | `[]`; each has `name` (string) and `pattern` (regex string); heading must name current head |
| `evals.suites` | object array | `[]`; no evals configured |
| `evals.suites[].name` | string | Required; resolves `evals/<name>/cases` |
| `evals.suites[].skills` | path string array | Required; skill files/directories hashed for freshness |
| `evals.suites[].reviewPrompt` | string | Required for review cases; `{branch}` is replaced |
| `evals.suites[].reviewModel` | string | Claude CLI default |
| `evals.suites[].judgeModel` | string | Codex default; `TBS_JUDGE_MODEL` overrides |
| `evals.suites[].base` | string | `origin/<baseBranch>` |
| `evals.suites[].maxAgeDays` | number | `7` |
| `evals.suites[].repeats` | positive integer | `1`; every repeat must pass |
| `evals.suites[].linkDirs` | path string array | `[]`; copied into isolated review scratch storage |
| `evals.suites[].hidePaths` | path string array | `[]`, added to built-in answer-key and record exclusions |
| `featureMap.file` | path string | `docs/feature-map.json` |
| `featureMap.sources` | object array | Required when feature map enabled |
| `featureMap.sources[].dir`, `.ext` | strings | Required directory and filename suffix |
| `featureMap.sources[].item` | regex string | Required capture for content discovery |
| `featureMap.sources[].block` | regex string | Unset; optional enclosing brace block with name capture |
| `featureMap.sources[].pathItem` | regex string | Unset; capture from file path instead of content |
| `featureMap.sources[].splitList` | boolean | `false` |
| `featureMap.sources[].id` | string | `{item}`; supports `{block}` and `{label}` for content discovery |
| `featureMap.sources[].label` | string | Empty string |
| `emulators.config` | path string | `firebase.json` |
| `emulators.only` | comma-separated string | Known emulator services configured in Firebase file |
| `emulators.project` | string | `demo-tbs` |
| `autopilot.maxLanes` | positive integer | `1` without autopilot; required if block exists |
| `autopilot.handoff` | path string | Optional, skill convention `HANDOFF.md` |
| `autopilot.continuation` | path string | Optional, skill convention `docs/codex-continuation.md` |
| `autopilot.extension` | path string | Optional, skill convention `.claude/skills/autopilot/SKILL.md` |
| `autopilot.checkIns.timeZone` | IANA zone string | No schedule without `checkIns` |
| `autopilot.checkIns.times` | HH:MM string array | Required with `checkIns` |
| `evals.suites[].reviewer`, `.judge` | preset or command template | `claude` / `codex`; presets `claude`, `codex`, `cursor-agent`, `gemini`; templates use `{prompt}`, `{branch}` |
| `evals.suites[].allowSameJudge` | boolean | `false`; a judge equal to the reviewer is refused |
| `routine.rows` | object array | Each has `name`, `paths` (regex strings) and the passes it requires; a diff runs the union |
| `routine.passes.<step>` | object | Host command or brief per step; the kit's pass skill when absent |
| `routine.ruleSources`, `.designSystem`, `.personas`, `.coreFlows` | paths / objects | Inputs for deep review, design audit, user roles and edge cases; a missing input is reported, never passed |
| `routine.extension` | path string | Project-specific passes and rules |
| `learn.file` | path string | `docs/trust-before-scale/lessons.jsonl` |
| `learn.window` | days | `14`; a recurrence inside it caps lanes |
| `learn.maxDue` | integer | `3`; more due classes cap lanes |

## Safety

The Bash hook is inert without the project config. It inspects merge commands for
head pinning, exit-status tests and unsafe piping; gate commands must propagate failure.
Explicit hook skips require a reason and are logged for review. Checks are local guardrails,
not an authorization boundary against malicious code or a replacement for branch protection.

The installer and checks do not push or merge. Eval execution creates isolated snapshots
and may push review snapshots to their local scratch remotes. The opt-in self-merge command
uses `gh` to label and merge eligible PRs only inside its configured lane; it refuses drafts,
wrong bases, unapproved paths, missing head evidence and unreviewed skips. Keep the lane off
until its policy and evidence patterns are reviewed. Run with `--dry-run` before enabling use.

## Updating and uninstalling

- In Claude Code, run `/trust-before-scale:update`. In Codex, Gemini CLI, or Cursor, ask your
  agent to use the update skill.
- In a terminal from your project, run `node scripts/tbs/update.mjs`. Add `--branch` to
  create an update branch after fetching `origin`. The base is the configured Git Flow
  integration branch, otherwise `origin/develop` if present, otherwise the remote default branch.
  The name uses the configured Git Flow feature prefix (for example, `feature/tbs-kit-1.7.1`)
  and defaults to `chore/tbs-kit-<version>`. Pass `--branch-name <name>` with `--branch` to
  choose a name, or `--dry-run` to preview the update without fetching.

The updater requires a tree clean of tracked changes, refuses to overwrite untracked installer targets,
and uses the newest installed kit. Set
`TBS_PLUGIN` to choose a specific plugin directory. The updater runs doctor after replacing
the shared scripts and brief template. Review the diff, run your project's gates, and open
a PR. Re-run evals when their inputs or runner change.

For your first update from 1.7.0 or earlier, use the update skill or the installed updater path
in the session-start notice. The installed updater applies its safety checks before replacing
the project copy.

For new Claude Code plugin releases, run:

```sh
claude plugin marketplace update trust-before-scale-kit
claude plugin update trust-before-scale@trust-before-scale-kit
```

To enable automatic plugin updates, open Claude Code’s `/plugin`, select **Marketplaces**,
choose `trust-before-scale-kit`, and select **Enable auto-update**. A pinned release stays
pinned until you change its source ref. [Claude Code plugin updates](https://code.claude.com/docs/en/discover-plugins#update-installed-plugins)

To also check GitHub for a newer plugin release, add `"updateCheck": { "latestRelease": true }`
to the project’s kit config. The setting defaults to off. When enabled, the hook checks via
`gh` at most once every 24 hours per Git repository with a two-second timeout.
See [host support](docs/harnesses.md#session-start-update-notice).

Uninstall with `claude plugin uninstall trust-before-scale@trust-before-scale-kit`.
Vendored project files remain: review and remove `scripts/tbs`, the config, installed eval
cases and `docs/trust-before-scale` if no longer needed; remove references from project gates.
Remove the marketplace with `claude plugin marketplace remove trust-before-scale-kit`.

## FAQ / troubleshooting

- **Hook does nothing?** Check that `.agents/trust-before-scale.json` (or the legacy
  `.claude/` one) exists in the project root, that you trusted the hook in your tool, and
  restart the tool after installing.
- **Merge blocked?** Use `--match-head-commit`, avoid piping failures away, and explicitly
  test the configured exit marker before merging. Logs must refer to the exact current head.
- **Eval is stale?** Run it again after skill, seed or settings changes. `--check --fresh`
  additionally enforces age. Dry runs need the configured base ref available locally.
- **Generic feature map is empty?** Replace the sample TSX route discovery with your stack's
  sources. Discovery is not a substitute for writing verification journeys.
- **Lane capped at one?** Read `lanes.mjs` output: missing evals, owed reviews, hook skips or
  an incomplete map can prevent scaling. Accepting an ADR does not create evidence.
- **Port collision?** Use `node scripts/tbs/free-ports.mjs -- <emulator command>`.
- **Keeping your own profiles private?** Store them in your own repository and install with
  `--profile-dir`.

## Works well with pstack

[pstack](https://github.com/cursor/plugins/tree/main/pstack) is a separate MIT-licensed skill pack by Lauren Tan.
It covers ground this kit leaves alone: interrogate and blast-radius, shipping verdicts, show-me-your-work,
visual parity and more. The two don't depend on each other, so you can use either one alone or both together.

pstack is written for Cursor first. To use it in Claude Code, follow its
[Claude Code guide](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md), which maps
Cursor's tool, model and path names to Claude Code's.

## Attribution and contributing

Adapted from [Lauren Tan's pstack](https://github.com/cursor/plugins/tree/3dbd22ff12742fb28c9700b9760baa29ed41dc13/pstack),
including its emphasis on harnesses and turning repeated failures into checks. This kit adds
project-specific evidence gates and measured review evals. See [third-party notices](THIRD_PARTY_NOTICES.md)
for the MIT notice and pinned source commit. The kit is [MIT licensed](LICENSE).
See [contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), and
[maintenance](docs/maintaining.md) for gates and release steps.
