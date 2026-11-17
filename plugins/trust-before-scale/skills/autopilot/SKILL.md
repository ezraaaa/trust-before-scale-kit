---
name: autopilot
description: "Run or resume the shared autonomous work loop, deferring project details to its extension. Triggers: autopilot, work the backlog, overnight run, unattended run, continue the milestone."
---

Read the project extension first: `autopilot.extension` in `.agents/trust-before-scale.json` (falling back to `.claude/trust-before-scale.json`)
(default `.claude/skills/autopilot/SKILL.md`). If the project's own autopilot skill has no line
pointing at `trust-before-scale:autopilot`, it is not yet an extension: follow that project skill
and use only the lane gate from this core.

# Autopilot core

The project extension and the host instruction file (`AGENTS.md`, `GEMINI.md` or `CLAUDE.md`) win wherever they also speak. The lane gate remains the
upper bound on parallel implementation, even when the extension names a higher ceiling.
If the extension is missing, report it and establish the project instructions before implementing.
Quality bars, budgets, priorities, platform tools, release rules and git flow belong to the project.
Do not infer permission to release or deploy from this skill.

## Step 0: falsify the handoff

Read `autopilot.handoff` (default `HANDOFF.md`) as claims to check, not as established facts.
Run the project's session-start check if its extension names one. Resolve each failed section or
report its owner and next action; rerun before ranking work on a partial picture.
Then run:

```bash
node scripts/tbs/self-merge.mjs --owed
node scripts/tbs/skill-eval.mjs --check
```

Review owed self-merges and the listed hook skips, then run
`node scripts/tbs/self-merge.mjs --ack-skips` after reviewing the skips.
Check every handoff claim you will act on against
current git and issue state. Measure an issue's proposed root cause before building on it.
Then run `ListAgents`, confirm each session's project from its branch or worktree, and message
sessions touching the same files. Wait for a reply or an idle notice; silence is not agreement.
Repeat that coordination before every merge. Check live branches and open PRs too.
A worktree or branch another live session holds is never yours to push, rebase, commit to or
remove, even when the session-start check lists it as unpushed: message its holder instead.
Act on it only once no live session holds it.

## Lane count

Run `node scripts/tbs/lanes.mjs` at session start and before every launch. Never run more
implementation lanes than it allows, whatever the extension's ceiling says. Launch scripts can
use `--require <n>`; `--json` gives the count and reasons as data.
When it caps at one, first clear the reasons it printed. Lane one remains available to repair trust.
Scaling requires `skill-eval --check --fresh`, stricter than the ordinary check: records must also
be recent (normally within seven days). An unavailable check caps at one.

## Lanes and review

Give every lane its own worktree, branch and committed brief. The allowed-files set must be
disjoint from running lanes, lanes awaiting review and open PRs. Check that before delegation.
The project owns the mechanics through its lane tooling, such as `scripts/codex-lanes.sh`,
`scripts/codex-implement.sh` and `scripts/session-start.mjs`; read its extension for actual commands.

Apply backpressure at one finished lane awaiting review: stop launching until it is reviewed.
Review and merge one at a time using the project's gates and review ritual on the exact head.
Merge with `--match-head-commit <verified-sha>`. If the base moved, merge it into the lane,
rerun required gates and reviews, and push before merging.
After each merge, merge the base into every other lane, coordinating with running writers rather
than editing underneath them. Reverify affected work. Let project tooling perform these steps.

## Finish to merge

Push after every commit. Open a PR when the feature is built and ready for the project's review
ritual, never a draft or a PR for a brief alone. Resolve findings and finish one feature to merge.
Work that cannot finish gets no PR: keep its branch pushed and comment on its issue with the
branch, head and what is owed. Close any existing PR for that unfinished work with the same status.

## Autonomy

Follow the extension's priority order. A blocked item is parked, never a reason to stop.
Add it to the handoff's owner list with context and a recommendation, leave one issue comment,
and pick the next unblocked item free of file overlap.
Under `/loop`, keep going until a usage limit or the owner says stop. If everything is parked,
refresh the handoff and re-arm an idle wake-up to check issues and owner answers. Report if the
session cannot schedule a wake-up. A parked list alone does not end the loop.

## Owner check-ins

If `autopilot.checkIns` is set, use its `timeZone` and `times`. At the first round boundary after
each scheduled time, batch unanswered parked questions, most blocking first. Hold each check-in
once per local day. Do not interrupt an edit, gate or review. Skip a check-in with no questions.
Ask in simple words, with the recommended option first and a reason the owner can assess.
An answer the owner did not type or select is absent. Defaults, elapsed time and plausible
machine answers do not authorize work. Keep unanswered questions parked and work elsewhere.
Save real answers that round in the project's decision record or issue, update the handoff owner
list, and return unblocked items to the queue.

## A new owner decision

A changed rule is not landed until every live copy agrees. Use the extension's recording locations
and decision workflow. The shared sequence is:

1. Ask one scope question if the ruling leaves its reach unclear. Do not invent broader permission.
2. Record the owner's words, date, scope and the rule replaced where the extension says.
3. Sweep every live copy of the old rule, including instructions, handoff, briefs and priorities.
4. Create or update the tracking issue with the affected locations and an audit of the sweep.
5. Open a prose PR for the rule change and its audit, following the project's review ritual.

## Milestones

Keep membership current without asking: read milestone descriptions, place each candidate before
starting it, and move issues when the work shows they belong elsewhere. Follow project priorities.
Milestone meaning, dates and creation require the owner's typed instruction. Do not rename or
rewrite a milestone to reconcile conflicting records; identify the conflict and park that decision.

## Stop and ask

First search existing decisions and run checks that can answer the question. Park unanswered
questions for the owner and continue independent work when a change would:

- Alter data models, authentication or security.
- Delete or rewrite work outside the current slice.
- Overturn a recorded decision or a “do not fix back” instruction.
- Add a new dependency.

The extension adds project-specific triggers. Routine work within the authorized slice continues.

## On a limit or end of session

Refresh `autopilot.continuation` (default `docs/codex-continuation.md`) as a self-contained brief
that another agent can cold-start: objective, current branches and heads, allowed files, completed checks,
remaining steps, parked decisions and the next exact action. Push all branches you own, then run
the project's handoff skill. Report any push that cannot complete.
Inspect errors and actual completed checks before trusting results from a run that overlapped a
usage limit. A reported success alone does not prove its agents or gates ran.
