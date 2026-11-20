// The Codex project hook the kit writes into .codex/hooks.json. bin/tbs-init (CommonJS) builds the same
// command; plugins/trust-before-scale/tests/codex-hook.test.mjs keeps the two identical.
export const gateTarget = "scripts/tbs/merge-gate.py";

const gateNote = (digest) => `trust-before-scale: merge gate at ${gateTarget} is missing or differs from sha256 ${digest}; command not checked. Run the kit update with --codex-hook, then trust the hook again.`;

export function gateCommandFor(digest) {
  const runner = `python3 -I -c 'import hashlib,sys;p=sys.argv[1];d=open(p,"rb").read().replace(b"\\r\\n",b"\\n");hashlib.sha256(d).hexdigest()!=sys.argv[2] and (print(sys.argv[3],file=sys.stderr),sys.exit(0));sys.argv=[p];exec(compile(d,p,"exec"),{"__name__":"__main__","__file__":p})' "$f" "${digest}" "${gateNote(digest)}"`;
  return `if f="$(git rev-parse --show-toplevel 2>/dev/null)/${gateTarget}" && [ -f "$f" ]; then exec ${runner}; fi; echo "${gateNote(digest)}" >&2`;
}

const parts = gateCommandFor("DIGEST").split("DIGEST").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const kitCommand = new RegExp(`^${parts[0]}([0-9a-f]{64})${parts.slice(1).join("\\1")}$`);

// The pinned digest when the command is exactly the kit's generated hook, else null.
export const kitGateDigest = (command) => kitCommand.exec(command ?? "")?.[1] ?? null;
