# Harnesses

The same method and Python merge gate serve every host. Run `node scripts/build-harness.mjs`
after editing the Claude manifest, `hooks/hooks.json`, or bundled skills. CI runs `--check`.
In restricted worktrees, `--skip-agents-marketplace` leaves that artifact for the reviewer.
Generated manifests retain the source version; there is no root `plugin.json`.

| Host | Install / invoke | Hooks and trust |
| --- | --- | --- |
| Claude Code | Add this repository as a plugin marketplace, install `trust-before-scale`; invoke `/trust-before-scale:method` | `hooks/hooks.json`, `PreToolUse` / `Bash`; approve plugin hooks in host settings |
| Codex CLI | `codex plugin marketplace add <kit-checkout>` then `codex plugin add trust-before-scale@trust-before-scale-kit`; select the `method` skill with `$method` | Project hook in `.codex/hooks.json` (the manifest hook is unconfirmed); trust it in `/hooks` |
| Cursor | Add the repository marketplace in Cursor settings, install the plugin; invoke `/method` or select the skill | Manifest selects `hooks/cursor.json`, `beforeShellExecution`, `failClosed`; review hook trust in Cursor settings |
| Gemini CLI | `gemini extensions install <repo-url> --ref gemini`; ask to use the `method` skill | Extension-root `hooks/hooks.json`, `BeforeTool` / `run_shell_command`; review extension consent |

Codex CLI 0.166.0, checked 17 Nov 2026 in a project with a kit config:

- **Project hook: works once trusted.** With the hook in `<repo>/.codex/hooks.json`, Codex ran it before
  `gh pr merge 1 --squash` and blocked the command with the kit's reason.
- **Untrusted, it is skipped silently.** `codex exec` printed no warning and ran the merge command.
  Trust the hook in `/hooks` in an interactive session, then confirm an unpinned merge is denied.
- **Plugin-shipped hook: not confirmed.** `codex features list` shows `plugin_hooks` as removed, so the
  hook in the plugin manifest may never run. Use the project hook.
- **Only configured projects are guarded.** The hook stands down where there is no kit config.

From the project's Git checkout, run `node "<plugin-root>/bin/tbs-init" generic --codex-hook`.
For an existing install, run `node "<plugin-root>/bin/tbs-init" --update --codex-hook`.
This merges `.codex/hooks.json`, preserving unrelated hooks and replacing any earlier kit hook
with the current absolute plugin path. Malformed hook JSON stops installation without overwriting it.
Trust the project hook in Codex `/hooks`, then confirm an unpinned merge is denied.
Plugins containing hooks are not eligible for the Codex public directory.

Gemini has fixed extension-root discovery for hooks and skills; its manifest cannot redirect
those into `plugins/`. The generated `dist/gemini/` tree is a complete local extension, with no
unsupported manifest keys. To prepare a dedicated git-root branch tree for remote installs,
run `node scripts/build-harness.mjs --gemini-dir <destination>`, then the owner publishes a `gemini` branch whose root is the contents of `dist/gemini/`.
Branch publication is outside this lane. Gemini and Antigravity installs remain untested here;
where `agy` is installed, test `agy plugin import gemini` against the exported extension.

Reference: [Gemini extension format](https://geminicli.com/docs/extensions/reference/) and
[Cursor hooks](https://cursor.com/docs/hooks). Current Gemini documentation still describes
Gemini CLI installs; this implementation does not assume a migration date to Antigravity.

For setup commands, resolve `<plugin-root>` to the host's installed plugin directory. Claude
exports `CLAUDE_PLUGIN_ROOT`, Codex supplies `CLAUDE_PLUGIN_ROOT` or `PLUGIN_ROOT`, Cursor uses
`CURSOR_PLUGIN_ROOT`, and Gemini substitutes `extensionPath` in hook configuration. Skill
bodies use a literal path placeholder so they do not depend on a host's variable expansion.
Copy the root `AGENTS.md` snippet into Codex/Cursor projects; use `GEMINI.md` for Gemini context.

Project config loads `.agents/trust-before-scale.json` first, then legacy
`.claude/trust-before-scale.json`. New installs write `.agents/`; existing config stays in place,
including during `--update`. A malformed preferred JSON config is reported rather than silently
loading a legacy config. The hook retains its existing inert behavior for unreadable config.

Each `evals.suites[]` accepts `reviewer` and `judge`: `claude`, `codex`, `cursor-agent`, `gemini`,
or a shell command template containing `{prompt}` and optionally `{branch}`. Place placeholders
outside shell quotes: `my-review --prompt {prompt} --branch {branch}`. Substitutions are shell-quoted
data, with no recursive substitution. Custom commands return plain text on stdout; judges return
only JSON containing `caught` and an exact `evidence` quote. Defaults remain Claude review / Codex
judge. Identical selections require suite `allowSameJudge: true`. Different command strings cannot
prove different underlying models; configure independent agents deliberately.

`reviewModel` and `judgeModel` select preset models; `TBS_JUDGE_MODEL` overrides `judgeModel`.
Templates control their own model flags. Explicit agent settings invalidate eval records; absent
settings preserve legacy settings hashes. Both config locations are hidden from blind reviews.
For self-merge, `selfMerge.review.reviewer` selects a preset's default `ranPattern`; an explicit
`ranPattern` wins. Custom wrappers should print `REVIEW RAN` after actually running the review,
or configure a specific marker. Exit markers, exact-head checks and finding checks still apply.

## Routine and review passes

Install/update the shared scripts with `tbs-init`; run
`node scripts/tbs/routine.mjs plan --base origin/<base> --json` before implementation and before
review. Rows use JavaScript regexes against repository-relative paths, union all matches, and fail
on unmatched paths. Review the profile defaults for your layout: a new surface inside an existing
file needs an explicit row/pattern. Added UI files conservatively require pre-build and post-build
role/design review. The plan also includes local changes; PR evidence must describe the final clean
head. It never runs reviews or merges. `routine.passes.<step>` overrides the table below; commands
use `{base}`, `{range}` and `{level}` as data placeholders. These are briefs, not executable shell
configuration. Confirm CLI availability and actual model independence before selecting a reviewer.

| Step | Claude Code | Codex CLI | Cursor / Gemini | Fallback |
| --- | --- | --- | --- | --- |
| simplify | `/simplify origin/<base>...HEAD`; always pass the range, since the upstream default can be empty after `push -u` | Write task: simplify the explicit range with no behaviour change | Agent task with the same brief | Kit `simplify` skill; behaviour-only diff inspection by routine |
| correctness | `/code-review <level>` on the explicit range; medium for tests/tooling, high for behaviour, xhigh for security; never max/ultra without owner request | `codex review --base <base>` | Agent correctness review of the range | Kit `code-review` |
| deep-review | Invoke `deep-review` skill | Select `$deep-review` | Select `deep-review` skill | Kit pass with `routine.ruleSources` |
| security | `/claude-security` change scan or `/security-review`; include whole-surface access review | Agent task with `security-review` | Same | Kit `security-review` |
| user-roles | Invoke `user-roles` skill | Select `$user-roles` | Select `user-roles` skill | Kit pass with `routine.personas` |
| edge-cases | Invoke `edge-cases` skill | Select `$edge-cases` | Select `edge-cases` skill | Kit pass with `routine.coreFlows` |
| design-audit | Invoke `design-audit` skill | Select `$design-audit` | Select `design-audit` skill | Kit pass; record skipped when no design system is configured |
| cross-review | If author was Claude: `codex review --base <base>` | If author was Codex: Claude `/code-review <level>` | Other installed host, confirming a different model | Record reason, then correctness one level higher (ceiling xhigh; fresh independent reviewer at ceiling) |
| verify-walk | Invoke `verify-walk`; use installed browser/device tools | Select `$verify-walk`; use available browser or simulator tools | Use the host's browser/device tools | Kit walk brief; report tooling gaps, never fabricate a walk |

Same-model correctness is provisionally skipped when a different-model cross-review will run.
An empty review, quota error or absent reviewer requires the stronger replacement before readiness.
Other missing passes require stronger review of their own subject. `verify-walk` records browser or
simulator, role, steps, visible outcome and SHA; tests alone are not a walk. Start the project's dev
server with its configured free-port workflow, then use the host's browser navigation/interaction
or simulator launch, input and screenshot facilities. If these are unavailable, record the gap.
Do not invent a tool invocation or install a platform SDK merely to claim completion.

`routine.extension` is an optional repo-relative project instruction file. `ruleSources`,
`designSystem` and `coreFlows` are arrays of repo-relative files. `personas` contains role, pressure
and task strings. Empty designSystem means an explicitly skipped design audit; absent persona/rule
inputs mean stated coverage gaps. Doctor validates these keys through the shared config validator,
including regex syntax, unique row names, pass mappings and before/after consistency; file existence
and browser availability remain routine preflight checks. Existing profiles stay at adoption level 1;
raise to level 3 before evaluating review skills. New Acme suites default to two repeats.

The installer vendors scripts and cases, not plugin skills. For evaluation, copy the named kit
skills into the profile's configured `.agents/skills/` paths (or override suite paths to an existing
host-neutral installation). Commit the fresh project's baseline and provide `origin/<base>` before
`node scripts/tbs/skill-eval.mjs <suite> --dry-run`. This validates cases and patch applicability;
it does not measure whether a model catches them. Live reviews are separate and require agent access.
The routine evidence heading is `## Routine evidence`, matched by the profiles' required comment.
