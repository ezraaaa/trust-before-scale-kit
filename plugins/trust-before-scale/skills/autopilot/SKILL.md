---
name: autopilot
description: "Run or resume the autonomous work loop under the project's extension. Triggers: autopilot, work the backlog, overnight run, unattended run, continue the milestone."
---

Read the project extension first: `autopilot.extension` in `.agents/trust-before-scale.json` (else
`.claude/trust-before-scale.json`), default `.claude/skills/autopilot/SKILL.md`. A project autopilot skill
with no line pointing at `trust-before-scale:autopilot` is not yet an extension: follow it and use only
this core's lane gate.

# Autopilot core

The extension and the host instruction file (`AGENTS.md`, `GEMINI.md` or `CLAUDE.md`) win where they also
speak, but the lane gate stays the upper bound on parallel work whatever ceiling the extension names.
If the extension is missing, report it and establish the project instructions before implementing.
Quality bars, budgets, priorities, platform tools, release rules and git flow belong to the project.
Nothing here grants permission to release or deploy.

## Step 0: falsify the handoff

Read `autopilot.handoff` (default `HANDOFF.md`) as claims to check, not facts. Run the extension's
session-start check if it names one; resolve each failed section or report its owner and next action,
and rerun before ranking work on a partial picture. Then run:

```bash
node scripts/tbs/self-merge.mjs --owed
node scripts/tbs/skill-eval.mjs --check
```

Review owed self-merges and the listed hook skips, then run `node scripts/tbs/self-merge.mjs --ack-skips`.
Check every handoff claim you will act on against current git and issue state, and measure an issue's
proposed root cause before building on it.

Run `ListAgents`, confirm each session's project from its branch or worktree, and message sessions
touching the same files. Wait for a reply or an idle notice; silence is not agreement. Repeat this
before every merge, and check live branches and open PRs too. A worktree or branch a live session holds
is never yours to push, rebase, commit to or remove, even when listed as unpushed: message its holder,
and act only once no live session holds it.

## Lane count

Run `node scripts/tbs/lanes.mjs` at session start and before every launch, and never run more
implementation lanes than it allows. Launch scripts can use `--require <n>`; `--json` gives the count and
reasons as data. When it caps at one, clear the printed reasons first; lane one stays available to repair
trust. Scaling requires `skill-eval --check --fresh` (records also recent, normally within seven days);
an unavailable check caps at one.

## Lanes and review

Every lane gets its own worktree, branch and committed brief. Before delegating, check its allowed files
are disjoint from running lanes, lanes awaiting review and open PRs. The project owns the mechanics
(for example `scripts/codex-lanes.sh`, `scripts/codex-implement.sh`, `scripts/session-start.mjs`); take
the actual commands from its extension.

Stop launching while one finished lane awaits review. Review and merge one at a time with the project's
gates and review ritual on the exact head, merging with `--match-head-commit <verified-sha>`. If the base
moved, merge it into the lane, rerun required gates and reviews, and push before merging. After each
merge, merge the base into every other lane, coordinating with running writers rather than editing under
them, and reverify affected work. Let project tooling perform these steps.

## Finish to merge

Push after every commit. Open a PR when the feature is built and ready for review, never a draft or a
PR for a brief alone; resolve findings and finish one feature to merge. Work that cannot finish gets no
PR: keep its branch pushed, comment on its issue with the branch, head and what is owed, and close any
existing PR for it with the same status.

## Autonomy

Follow the extension's priority order. A blocked item is parked, never a reason to stop: add it to the
handoff's owner list with context and a recommendation, leave one issue comment, and pick the next
unblocked item free of file overlap. Under `/loop`, keep going until a usage limit or the owner says stop.
If everything is parked, refresh the handoff and re-arm an idle wake-up to check issues and owner
answers; report if the session cannot schedule one. A parked list alone does not end the loop.

## Owner check-ins

If `autopilot.checkIns` is set, use its `timeZone` and `times`. At the first round boundary after each
time, batch unanswered parked questions, most blocking first; once per local day, never interrupting an
edit, gate or review, and skipped when there are no questions. Ask in simple words, recommended option
first, with a reason the owner can assess. An answer the owner did not type or select is absent:
defaults, elapsed time and plausible machine answers authorize nothing. Keep unanswered questions parked
and work elsewhere. Save real answers that round in the project's decision record or issue, update the
handoff owner list, and return unblocked items to the queue.

## A new owner decision

A changed rule is not landed until every live copy agrees. Use the extension's recording locations and
decision workflow:

1. Ask one scope question if the ruling's reach is unclear. Do not invent broader permission.
2. Record the owner's words, date, scope and the rule replaced where the extension says.
3. Sweep every live copy of the old rule, including instructions, handoff, briefs and priorities.
4. Create or update the tracking issue with the affected locations and an audit of the sweep.
5. Open a prose PR for the rule change and its audit, following the project's review ritual.

## Milestones

Keep membership current without asking: read milestone descriptions, place each candidate before starting
it, and move issues when the work shows they belong elsewhere, following project priorities. Milestone
meaning, dates and creation need the owner's typed instruction. Never rename or rewrite a milestone to
reconcile conflicting records; name the conflict and park that decision.

## Stop and ask

First search existing decisions and run checks that can answer the question. Park unanswered questions
for the owner and continue independent work when a change would:

- Alter data models, authentication or security.
- Delete or rewrite work outside the current slice.
- Overturn a recorded decision or a “do not fix back” instruction.
- Add a new dependency.

The extension adds project-specific triggers. Routine work within the authorized slice continues.

## On a limit or end of session

Refresh `autopilot.continuation` (default `docs/codex-continuation.md`) as a self-contained cold-start
brief: objective, current branches and heads, allowed files, completed checks, remaining steps, parked
decisions and the next exact action. Push all branches you own, then run the project's handoff skill;
report any push that cannot complete. After a run that overlapped a usage limit, inspect errors and the
checks that actually completed before trusting its results: a reported success does not prove its agents
or gates ran.
