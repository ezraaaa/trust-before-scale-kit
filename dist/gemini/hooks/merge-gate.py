#!/usr/bin/env python3
"""Trust before scale: the merge gate (Claude/Codex, Cursor and Gemini).

Does nothing unless the project has `.agents/trust-before-scale.json` or legacy `.claude/trust-before-scale.json`. That keeps the plugin
project-based: install it once per machine, and only configured projects are guarded.

Three rules, each from a failure that really happened:
  1. `gh pr merge` must pin the head it verified (`--match-head-commit`). A push between the
     green run and the merge otherwise merges code nobody tested.
  2. `gh pr merge` must TEST the gate's exit earlier in the same && chain
     (`grep -qx '<exitMarker>' <log> && gh pr merge ...`). Printing the exit is not testing it:
     a printed "EXIT=1" was once followed by a merge anyway.
  3. A gate command must not be piped in a command that also merges or commits. The pipe
     returns the exit of `tail`/`tee`, so a red gate looks green.

Exit 2 blocks (the reason goes to stderr). Prefix a command with
`HOOK_SKIP=1 HOOK_SKIP_REASON="<text>"` to stand down with a logged reason. Red and green cases: tests/merge-gate-smoke.sh.
"""
from datetime import datetime, timezone
import json
import os
import re
import shlex
import sys
import subprocess
import uuid

# A command START: the beginning or a shell separator, never a bare \b (which cannot match before "./gradlew").
START = r"(?:^|(?<=[\s;&|(]))"
DEFAULT_GATE = r"(?:npm\s+(?:run\s+)?(?:test|verify)\S*|npx\s+(?:vitest|jest)|flutter\s+test|dart\s+test|melos\s+run\s+\S*test\S*|xcodebuild|(?:\./)?gradlew)"


def load_config(cwd):
    for folder in (".agents", ".claude"):
        path = os.path.join(cwd, folder, "trust-before-scale.json")
        try:
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except FileNotFoundError:
            continue
        except (OSError, ValueError):
            return None
    return None


def strip_quoted(text):
    """Drop heredoc bodies and quoted strings, so a commit message that names a command is not read as one."""
    text = re.sub(r"<<-?['\"]?(\w+)['\"]?[^\n]*\n.*?\n\1(?=[\s;|&)$]|$)", " ", text, flags=re.DOTALL)
    text = re.sub(r"'[^']*'", " ", text)
    return re.sub(r'"[^"]*"', " ", text)


def tokens_of(raw):
    text = raw.replace("\\\n", " ")
    text = re.sub(r"[0-9]*>&[0-9]+", " ", text)
    lexer = shlex.shlex(text, posix=True, punctuation_chars=";&|()\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    tokens = list(lexer)
    # shlex groups adjacent punctuation (`;\n`, `&&\n`, `)&&`); split runs into single operators.
    return [op for token in tokens for op in
            (re.findall(r"&&|\|\||[;&|()\n]", token) if re.fullmatch(r"[;&|()\n]+", token) else [token])]


def merge_is_gated(raw, marker, cwd):
    """True when every `gh pr merge` follows a quiet grep for the exit marker in the same && chain."""
    try:
        tokens = tokens_of(raw)
    except ValueError:
        return False
    gated, segment, logs, written = False, [], [], set()
    for index, token in enumerate(tokens + [";"]):
        if token == "\n" and index > 0 and tokens[index - 1] == "&&":
            continue  # a newline after && continues the chain
        if token in ("&&", ";", "||", "|", "&", "(", ")", "\n"):
            if segment[:3] == ["gh", "pr", "merge"]:
                if not gated:
                    return False
                sha = next((segment[i + 1] for i, value in enumerate(segment[:-1])
                            if value == "--match-head-commit"), "")
                sha = next((value.split("=", 1)[1] for value in segment
                            if value.startswith("--match-head-commit=")), sha)
                for log in logs:
                    if log not in written and not log_matches_head(log, sha, cwd):
                        hold("gate log HEAD is missing, invalid or differs from --match-head-commit.",
                             "Record HEAD=<verified sha> in the gate log and pin that same head when merging.")
            if segment[:1] == ["grep"]:
                flags = [x for x in segment[1:] if x.startswith("-")]
                pattern = next((x for x in segment[1:] if not x.startswith("-")), None)
                if any(re.fullmatch(r"-[qxF]*q[qxF]*", x) for x in flags) and pattern == marker:
                    gated = True
                    position = segment.index(pattern)
                    logs.extend(segment[position + 1:])
            # A log produced earlier in this command cannot be inspected yet.
            for i, value in enumerate(segment):
                match = re.fullmatch(r"(?:[0-9]*)(>>?)(.*)", value)
                if match:
                    target = match[2] or (segment[i + 1] if i + 1 < len(segment) else "")
                    if target:
                        written.add(target)
            if token != "&&":
                gated = False
                logs = []
            segment = []
        else:
            segment.append(token)
    return True


def log_matches_head(log, sha, cwd):
    try:
        with open(os.path.join(cwd, log), encoding="utf-8") as handle:
            heads = [line.rstrip("\n")[5:] for line in handle if line.startswith("HEAD=")]
    except (OSError, UnicodeError):
        return True  # Missing/unreadable logs may be produced by the pending command.
    if not re.fullmatch(r"[0-9a-fA-F]{40}", sha) or len(heads) != 1:
        return False
    head, sha = heads[0].lower(), sha.lower()
    if head == sha:
        return True
    if not re.fullmatch(r"[0-9a-f]{7,39}", head) or not sha.startswith(head):
        return False
    try:
        matches = subprocess.check_output(["git", "rev-parse", "--disambiguate=" + head],
                                          cwd=cwd, text=True, stderr=subprocess.DEVNULL,
                                          timeout=2).splitlines()
        return matches == [sha]
    except (OSError, subprocess.SubprocessError):
        return False


EVENT = "beforeShellExecution" if "--cursor" in sys.argv or os.environ.get("CURSOR_PLUGIN_ROOT") else "PreToolUse"

CAPTURE = None

def capture_lesson(kind, where, source, evidence):
    if CAPTURE is None:
        return
    cwd, config = CAPTURE
    if config.get("level", 4) < 3:
        return
    try:
        relative = config.get("learn", {}).get("file", "docs/trust-before-scale/lessons.jsonl")
        if not isinstance(relative, str) or not relative or os.path.isabs(relative) or ".." in relative.split("/") or "\\" in relative or re.match(r"^[A-Za-z]:", relative):
            return
        common = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=cwd, text=True,
                                         stderr=subprocess.DEVNULL, timeout=2).strip()
        path = os.path.join(cwd, common, "tbs-learn", relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        record = {"id": str(uuid.uuid4()), "date": datetime.now(timezone.utc).isoformat(),
                  "class": kind, "where": where, "source": source, "evidence": evidence}
        data = (json.dumps(record) + "\n").encode("utf-8")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)
    except Exception:
        pass  # Capture is best effort and must never affect the decision or stdout.


def hold(reason, fix):
    capture_lesson("merge-gate-block", "merge-gate", "hook-block", reason)
    message = f"{reason}\n{fix}"
    if EVENT == "BeforeTool":
        output = {"decision": "deny", "reason": message}
    elif EVENT == "beforeShellExecution":
        output = {"permission": "deny", "user_message": message, "agent_message": message}
    else:
        output = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": message}}
    print(json.dumps(output))
    sys.stderr.write(f"[trust-before-scale] {reason}\n{fix}\n\n"
                     'Override with a recorded reason: prefix with HOOK_SKIP=1 HOOK_SKIP_REASON="<text>"\n')
    sys.exit(2)


def main():
    global EVENT, CAPTURE
    text = sys.stdin.read()
    try:
        payload = json.loads(text)
    except ValueError:
        if re.search(r'"hook_event_name"\s*:\s*"(?:beforeShellExecution|preToolUse)"', text):
            EVENT = "beforeShellExecution"
        return
    if not isinstance(payload, dict):
        return
    EVENT = payload.get("hook_event_name") or ("beforeShellExecution" if "command" in payload else EVENT)
    if EVENT == "preToolUse":
        EVENT = "beforeShellExecution"
    raw = (payload.get("tool_input") or {}).get("command") or payload.get("command") or ""
    if not raw.strip():
        return
    cwd = payload.get("cwd") or os.getcwd()
    config = load_config(cwd)
    if config is None:
        return
    CAPTURE = (cwd, config)
    # Record attempted reverts best-effort, without changing the gate decision.
    try:
        segment = []
        for token in tokens_of(raw) + [";"]:
            if token in ("&&", ";", "||", "|", "&", "(", ")", "\n"):
                if segment[:2] == ["git", "revert"]:
                    refs, skip_value = [], False
                    for value in segment[2:]:
                        if skip_value:
                            skip_value = False
                        elif value in ("-m", "--mainline", "--strategy", "-X", "--strategy-option"):
                            skip_value = True
                        elif not value.startswith("-"):
                            refs.append(value)
                    if refs:
                        capture_lesson("revert", " ".join(refs), "revert", " ".join(segment)[:200])
                segment = []
            else:
                segment.append(token)
    except ValueError:
        pass
    # Only leading shell assignments count: a reason written after the command is an argument.
    try:
        assignments = {}
        for token in tokens_of(raw):
            match = re.fullmatch(r"([A-Za-z_][A-Za-z_0-9]*)=(.*)", token, re.DOTALL)
            if not match:
                break
            assignments[match[1]] = match[2]
        if assignments.get("HOOK_SKIP") == "1":
            reason = assignments.get("HOOK_SKIP_REASON", "").strip()
            if not reason:
                hold("bare HOOK_SKIP=1 is held: HOOK_SKIP_REASON must be non-empty.",
                     'Use: HOOK_SKIP=1 HOOK_SKIP_REASON="<text>" <command>')
            try:
                git_dir = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=cwd,
                                                  text=True, stderr=subprocess.DEVNULL).strip()
                path = os.path.join(cwd, git_dir, "tbs-skips.log")
                # Keep each accepted skip to one physical line, including multiline reasons/commands.
                clean = lambda text: text.replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
                with open(path, "a", encoding="utf-8") as handle:
                    handle.write(f"{datetime.now(timezone.utc).isoformat()}\t{clean(reason)}\t{clean(raw[:120])}\n")
            except (OSError, subprocess.CalledProcessError):
                pass  # A missing git directory must not prevent an explicit stand-down.
            return
    except ValueError:
        pass  # Malformed shell input gets the normal gate checks.
    gate = config.get("mergeGate") or {}
    marker = gate.get("exitMarker", "VERIFY_EXIT=0")
    gate_pattern = gate.get("gateCommandPattern", DEFAULT_GATE)

    visible = strip_quoted(raw).replace("\\\n", " ")
    merges = re.findall(r"\bgh\s+pr\s+merge\b[^|;&]*", visible)

    if gate.get("requireMatchHead", True) and any(
            not re.search(r"--match-head-commit([ =]|$)", m) for m in merges):
        hold("gh pr merge without --match-head-commit: the merge must name the head that went green.",
             "Use: gh pr merge <N> --merge --match-head-commit <verified sha>")

    if merges and gate.get("requireExitTest", True) and not merge_is_gated(raw, marker, cwd):
        hold(f"gh pr merge must test the gate's exit ({marker}) earlier in the same && chain.",
             f"Use: grep -qx '{marker}' <log> && gh pr merge <N> --merge --match-head-commit <sha>")

    piped = re.sub(r"[0-9]*>&[0-9]+", " ", visible)
    if re.search(r"\b(gh\s+pr\s+merge|git\s+commit)\b", piped) and re.search(
            START + r"(?:" + gate_pattern + r")[^|;&]*\|(?!\|)", piped):
        hold("a gate command is piped in a command that also merges or commits; the pipe can hide its failure.",
             f"Redirect instead: <gate> > log 2>&1; echo \"{marker.split('=')[0]}=$?\" >> log; test the log before merging.")


if __name__ == "__main__":
    main()
    if EVENT == "beforeShellExecution":
        print('{"permission":"allow"}')
