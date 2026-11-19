#!/usr/bin/env node
// Plan only: never runs a review, executes configured commands, posts evidence or merges.
import { execFileSync } from "node:child_process";
import { ROOT, isMain, loadConfig, validateConfig } from "./config.mjs";

export const ORDER = ["simplify", "correctness", "deep-review", "security", "user-roles", "edge-cases", "design-audit", "cross-review", "verify-walk"];
export function plan(config, changes, { base, head, range } = {}) {
  validateConfig(config);
  if (!config.routine) throw new Error("routine is not configured; add routine.rows and routine.passes");
  const rows = config.routine.rows.map(row => ({ ...row, files: changes.filter(change =>
    (!row.addedOnly || change.status === "A") && row.paths.some(pattern => new RegExp(pattern).test(change.path))
  ).map(change => change.path) })).filter(row => row.files.length);
  const covered = new Set(rows.flatMap(row => row.files));
  const unmatched = changes.map(change => change.path).filter(path => !covered.has(path));
  if (unmatched.length) throw new Error(`Unclassified paths (add a routine row before review): ${unmatched.join(", ")}`);
  const required = new Set(rows.flatMap(row => row.passes));
  const passes = ORDER.filter(step => required.has(step)).map(step => ({
    step, reasons: rows.filter(row => row.passes.includes(step)).map(row => `${row.name}: ${row.reason}`),
    commands: config.routine.passes[step],
  }));
  return { base, head, range, rows, before: ORDER.filter(step => rows.some(row => row.before?.includes(step))),
    passes, gates: rows.some(row => row.gates), level: required.has("security") ? "xhigh" : rows.every(row => ["tests-tooling", "prose-no-gate", "prose-consumed"].includes(row.name)) ? "medium" : "high",
    notes: ["Commands are briefs/templates, not shell code to execute automatically.",
      "Run pre-build passes before implementation; an existing diff cannot prove they happened.",
      "If a different-model cross-review will run, defer same-model correctness; if absent or empty, run correctness one level higher (ceiling xhigh unless owner asks).",
      "A plan is not review evidence. Every required pass needs a result or a stronger replacement; never merge from this command."] };
}

export function main(argv = [], { root = ROOT, config, log = console.log } = {}) {
  if (argv[0] !== "plan") throw new Error("Usage: routine.mjs plan [--base <ref>] [--json]");
  let base;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--json") continue;
    if (argv[i] === "--base" && argv[i + 1] && !argv[i + 1].startsWith("-")) { base = argv[++i]; continue; }
    throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  config ??= loadConfig(root);
  base ??= `origin/${config.baseBranch ?? "develop"}`;
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  // Resolve refs before using them; a ref cannot become an option or a shell command.
  const baseSha = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`).trim();
  const head = git("rev-parse", "HEAD").trim();
  const ancestor = git("merge-base", baseSha, head).trim();
  // --no-renames includes both sides of a move so the old surface cannot lose its review.
  const fields = git("diff", "--no-renames", "--name-status", "-z", ancestor, "--").split("\0");
  const changes = [];
  for (let i = 0; fields[i]; i += 2) changes.push({ status: fields[i], path: fields[i + 1] });
  for (const path of git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean)) changes.push({ status: "A", path });
  const result = plan(config, changes, { base, head, range: `${base}...HEAD` });
  result.dirty = !!git("status", "--porcelain", "--untracked-files=normal").trim();
  if (argv.includes("--json")) log(JSON.stringify(result, null, 2));
  else {
    log(`HEAD=${head}\nRange: ${result.range}${result.dirty ? " + uncommitted changes (evidence must be refreshed on final head)" : ""}`);
    for (const row of result.rows) log(`Row ${row.name}: ${row.reason} [${row.files.join(", ")}]`);
    if (result.before.length) log(`Before building, and again after: ${result.before.join(", ")}`);
    for (const pass of result.passes) log(`${pass.step}: ${pass.reasons.join("; ")}`);
    log(`Correctness level: ${result.level}; gates: ${result.gates ? "required" : "not required by matched rows"}`);
    for (const note of result.notes) log(note);
  }
  return 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
