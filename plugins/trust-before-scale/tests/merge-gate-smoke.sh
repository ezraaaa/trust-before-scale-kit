#!/usr/bin/env bash
# Red and green cases for hooks/merge-gate.py. Run: bash tests/merge-gate-smoke.sh
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"; HOOK="$HERE/hooks/merge-gate.py"
PROJ=$(mktemp -d); mkdir -p "$PROJ/.claude"; BARE=$(mktemp -d); NOGIT=$(mktemp -d)
printf '{"mergeGate":{"exitMarker":"EXIT=0","gateCommandPattern":"(npm\\\\s+test|xcodebuild|\\\\./gradlew|melos\\\\s+run\\\\s+test)"}}' > "$PROJ/.claude/trust-before-scale.json"
mkdir -p "$NOGIT/.claude"
cp "$PROJ/.claude/trust-before-scale.json" "$NOGIT/.claude/"
git -C "$PROJ" init -q
# Exercise both config locations and each host's actual stdin/response shape.
python3 - "$HOOK" "$PROJ" "$BARE" <<'PYHOSTS'
import json, pathlib, subprocess, sys
hook, root, bare = sys.argv[1:]
root = pathlib.Path(root)
for folder in (".claude", ".agents"):
    if folder == ".agents":
        (root / folder).mkdir()
        (root / ".claude/trust-before-scale.json").rename(root / folder / "trust-before-scale.json")
    for event in ("PreToolUse", "BeforeTool", "beforeShellExecution"):
        payload = {"cwd": str(root), "hook_event_name": event}
        if event == "beforeShellExecution": payload["command"] = "gh pr merge 5"
        else: payload["tool_input"] = {"command": "gh pr merge 5"}
        result = subprocess.run(["python3", hook], input=json.dumps(payload), text=True, capture_output=True)
        assert result.returncode == 2 and result.stderr, result
        output = json.loads(result.stdout)
        if event == "PreToolUse": assert output["hookSpecificOutput"]["permissionDecision"] == "deny"
        elif event == "BeforeTool": assert output["decision"] == "deny"
        else: assert output["permission"] == "deny" and output["agent_message"] and output["user_message"]
        print("PASS", folder, event, "deny + JSON + exit 2")
for event in ("beforeShellExecution", "preToolUse"):
    for cwd, command in ((str(root), "echo hello"), (bare, "gh pr merge 5"), (str(root), "")):
        payload = {"cwd": cwd, "hook_event_name": event}
        if event == "beforeShellExecution": payload["command"] = command
        else: payload["tool_input"] = {"command": command}
        result = subprocess.run(["python3", hook], input=json.dumps(payload), text=True, capture_output=True)
        assert result.returncode == 0 and result.stdout == '{"permission":"allow"}\n' and not result.stderr, result
        print("PASS", event, "allow + exact JSON + exit 0", command)
for event in ("PreToolUse", "BeforeTool"):
    result = subprocess.run(["python3", hook], input=json.dumps({"cwd": str(root), "hook_event_name": event, "tool_input": {"command": "echo hello"}}), text=True, capture_output=True)
    assert result.returncode == 0 and result.stdout == "", result
for text in ('invalid JSON', '{"hook_event_name":"preToolUse",'):
    result = subprocess.run(["python3", hook, "--cursor"], input=text, text=True, capture_output=True)
    assert result.returncode == 0 and result.stdout == '{"permission":"allow"}\n', result
print("PASS Cursor malformed input allows; other hosts allow silently")
(root / ".agents/trust-before-scale.json").rename(root / ".claude/trust-before-scale.json")
PYHOSTS
if [[ $? != 0 ]]; then exit 1; fi
pass=0; fail=0
run_case() { local cwd="$1" want="$2" name="$3" cmd="$4" rc
  python3 -c 'import json,sys; print(json.dumps({"cwd":sys.argv[1],"tool_input":{"command":sys.argv[2]}}))' "$cwd" "$cmd" | python3 "$HOOK" >/dev/null 2>&1; rc=$?
  if [[ $rc == "$want" ]]; then printf 'PASS  %-50s (exit %s)\n' "$name" "$rc"; pass=$((pass+1)); else printf 'FAIL  %-50s (exit %s, wanted %s)\n' "$name" "$rc" "$want"; fail=$((fail+1)); fi; }
S=0123456789abcdef0123456789abcdef01234567
run_case "$PROJ" 2 "merge without a pinned head"            "grep -qx 'EXIT=0' g.log && gh pr merge 5 --merge"
run_case "$PROJ" 2 "merge without testing the exit"         "gh pr merge 5 --merge --match-head-commit $S"
run_case "$PROJ" 2 "printed exit is not a test"             "tail -1 g.log && gh pr merge 5 --merge --match-head-commit $S"
run_case "$PROJ" 2 "exit tested in another chain"           "grep -qx 'EXIT=0' g.log; gh pr merge 5 --merge --match-head-commit $S"
run_case "$PROJ" 2 "wrong marker"                           "grep -qx 'VERIFY_EXIT=0' g.log && gh pr merge 5 --merge --match-head-commit $S"
run_case "$PROJ" 2 "gate piped before a commit"             "xcodebuild test -scheme X | tail -5 && git commit -m x"
run_case "$PROJ" 2 "gradle piped with a merge"              "./gradlew test | tee t.log; grep -qx 'EXIT=0' t.log && gh pr merge 5 --merge --match-head-commit $S"
run_case "$PROJ" 0 "gated, pinned merge"                    "grep -qx 'EXIT=0' g.log && gh pr merge 5 --merge --match-head-commit $S"
run_case "$PROJ" 0 "gated merge on a continued line"        $'grep -qx \'EXIT=0\' g.log &&\n  gh pr merge 5 --merge --match-head-commit '$S
run_case "$PROJ" 0 "gate redirected, then commit"           "xcodebuild test -scheme X > t.log 2>&1; git commit -m x"
run_case "$PROJ" 0 "a pipe with no merge or commit"         "npm test | tail -5"
run_case "$PROJ" 0 "merge named inside a commit message"    "git commit -m 'run gh pr merge later'"
run_case "$PROJ" 2 "bare HOOK_SKIP is held"                  "HOOK_SKIP=1 gh pr merge 5 --merge"
run_case "$PROJ" 2 "empty skip reason is held"              'HOOK_SKIP=1 HOOK_SKIP_REASON="" gh pr merge 5 --merge'
run_case "$PROJ" 2 "blank skip reason is held"              'HOOK_SKIP=1 HOOK_SKIP_REASON="  " gh pr merge 5 --merge'
run_case "$PROJ" 2 "reason after command is not a prefix"   'HOOK_SKIP=1 gh pr merge 5 HOOK_SKIP_REASON="x"'
run_case "$PROJ" 0 "reasoned HOOK_SKIP stands down"          'HOOK_SKIP=1 HOOK_SKIP_REASON="x" gh pr merge 5 --merge'
if python3 - "$PROJ/.git/tbs-skips.log" <<'PYLOG'
import pathlib, re, sys
lines = pathlib.Path(sys.argv[1]).read_text().splitlines() if pathlib.Path(sys.argv[1]).exists() else []
assert len(lines) == 1, lines
assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)\tx\tHOOK_SKIP=1 HOOK_SKIP_REASON="x" gh pr merge 5 --merge', lines[0]), lines
PYLOG
then pass=$((pass+1)); echo 'PASS  skip writes one UTC audit line'; else fail=$((fail+1)); echo 'FAIL  skip writes one UTC audit line'; fi
run_case "$NOGIT" 0 "reasoned skip without git still passes" 'HOOK_SKIP=1 HOOK_SKIP_REASON="x" gh pr merge 5 --merge'
run_case "$PROJ" 0 "a word ending in a gate name is not one"  "echo myxcodebuild | tail -1 && git commit -m x"
run_case "$BARE" 0 "no config: the plugin stays out"        "gh pr merge 5 --merge"
if python3 - "$HOOK" "$PROJ" <<'PYDETAIL'
import json, pathlib, subprocess, sys
hook, cwd = sys.argv[1:]
def invoke(command):
    return subprocess.run(["python3", hook], input=json.dumps({"cwd": cwd, "tool_input": {"command": command}}), text=True, capture_output=True)
held = invoke("HOOK_SKIP=1 gh pr merge 5")
assert held.returncode == 2 and "HOOK_SKIP_REASON" in held.stderr and "non-empty" in held.stderr
command = 'HOOK_SKIP=1 HOOK_SKIP_REASON="line one\nline two" gh pr merge 5 ' + 'x' * 150
assert invoke(command).returncode == 0
lines = (pathlib.Path(cwd) / ".git/tbs-skips.log").read_text().splitlines()
assert len(lines) == 2, lines
_, reason, preview = lines[-1].split("\t")
assert reason == "line one\\nline two", reason
assert preview == command[:120].replace("\n", "\\n"), preview
PYDETAIL
then pass=$((pass+1)); echo 'PASS  skip hint, multiline reason and 120-character preview'; else fail=$((fail+1)); echo 'FAIL  skip hint, multiline reason and 120-character preview'; fi
if python3 - "$HOOK" "$PROJ" <<'PYGATE'
import json, pathlib, shlex, subprocess, sys
hook, cwd = sys.argv[1:]
root = pathlib.Path(cwd)
def invoke(command):
    return subprocess.run(["python3", hook], input=json.dumps({"cwd": cwd, "tool_input": {"command": command}}), text=True, capture_output=True)
subprocess.run(["git", "-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "test"], check=True)
sha = subprocess.check_output(["git", "-C", cwd, "rev-parse", "HEAD"], text=True).strip()
log = root / "gate's log.txt"
quoted = shlex.quote(str(log))
command = f"grep -qx 'EXIT=0' {quoted} && gh pr merge 5 --match-head-commit {sha}"
for head, expected in (("f" * 40, 2), (None, 2), (sha, 0), (sha[:7], 0), (sha[:6], 2)):
    log.write_text((f"HEAD={head}\n" if head else "") + "EXIT=0\n")
    result = invoke(command)
    assert result.returncode == expected, (head, result)
    if expected == 2: assert "gate log HEAD" in result.stderr
log.write_text("HEAD=stale\nEXIT=0\n")
assert invoke(f"echo HEAD={sha} > {quoted}; " + command).returncode == 0
assert invoke(f"echo HEAD={sha} > {quoted} && " + command).returncode == 0
assert invoke("HOOK_SKIP=1 HOOK_SKIP_REASON=reviewed " + command).returncode == 0
log.unlink()
assert invoke(command).returncode == 0
config = root / ".claude/trust-before-scale.json"
journal = root / ".git/tbs-learn/docs/trust-before-scale/lessons.jsonl"
for level in (2, 3):
    config.write_text(json.dumps({"level": level}))
    before = journal.read_text() if journal.exists() else ""
    result = invoke("git revert " + sha)
    assert result.returncode == 0 and not result.stdout and not result.stderr, result
    after = journal.read_text() if journal.exists() else ""
    if level == 2: assert after == before
    else:
        record = json.loads(after[len(before):])
        assert record["class"] == "revert" and record["where"] == sha
        assert record["source"] == "revert" and record["evidence"] == "git revert " + sha
        assert invoke("git revert -m 1 --no-edit " + sha).returncode == 0
        record = json.loads(journal.read_text().splitlines()[-1])
        assert record["where"] == sha
        before = journal.read_text()
        assert invoke('echo "git revert HEAD"').returncode == 0
        assert journal.read_text() == before
print("PASS gate log head and revert capture: log head, quoted path, pending writes, skip and revert levels")
PYGATE
then pass=$((pass+1)); else fail=$((fail+1)); echo 'FAIL gate log head and revert capture'; fi
rm -rf "$PROJ" "$BARE" "$NOGIT"
echo "Pass: $pass · Fail: $fail"; [[ $fail == 0 ]]
