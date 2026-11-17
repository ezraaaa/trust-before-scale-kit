# Trust before scale

Project snippet for Codex and Cursor: read the installed `method` skill at session start.
Read `.agents/trust-before-scale.json`, falling back to `.claude/trust-before-scale.json`.
Run the configured gates and skill eval checks before scaling agents or merging.
Keep evidence on the exact head; follow the project's instructions and approval boundaries.
See `docs/harnesses.md` for host setup and hook trust.

For this kit: if PLAN.md exists, implement only the requested lane and its allowed files.
Run its verification steps, report failures and unrun gates, and leave PLAN.md uncommitted.

Maintainer skills: `run-gates`, `start-feature`, `cut-release`, `hotfix` (in `.agents/skills/`; `.claude/skills` links there for Claude Code). Codex reads the real folder but not a symlinked one, so keep the real files in `.agents/`; its sandbox cannot edit them.
