# Brief: <title>

Decided by: <ADR / issue / owner words>. Branch: `<type>/<slug>`, cut from `origin/<base>`.

## Goal
<What is true when this is done, in two or three sentences.>

## What to build
<Numbered steps. Name every file or folder each step touches.>

## Constraints
- Never edit the script that is running you (`scripts/codex-implement.sh`).
- Temporary edits to prove a check red are allowed on any file, if each is undone from a copy and listed.
  Only what `git status --short` shows at the end must be on the allowed list.
- No new dependency unless named here.
- <Nearby "do not fix back" decisions.>

## Allowed files
<The exact list. Before sending, check every step above, every red proof, and every pattern imported from other
code (a shared regex or classifier) against this list: a step the list forbids stops the run.>

## Acceptance
- [ ] <Observable result 1>
- [ ] Each new check proven red on known-bad input, then undone.

## Commands to get green
```bash
<the narrowest commands that cover the change>
```

## Self-check (end of your final message)
Tick the acceptance list against your own diff. Confirm no file outside the allowed list changed. Report each command
as PASS / FAIL / NOT RUN.
