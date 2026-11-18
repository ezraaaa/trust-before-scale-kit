// Trust before scale: one lane can always work on repairing trust.
import { execFileSync } from "node:child_process";
import { ROOT, isMain } from "./config.mjs";
import { loadConfig, validateConfig, adoptionLevel } from "./config.mjs";
import { outcomes } from "./learn.mjs";
import { main as evalMain } from "./skill-eval.mjs";
import { main as mapMain } from "./feature-map.mjs";
import { run as selfMerge } from "./self-merge.mjs";

export function laneAllowance({ root = ROOT, config = loadConfig(root),
  ghRun = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }),
  evalCheck = evalMain, mapCheck = mapMain, owedCheck = selfMerge,
} = {}) {
  validateConfig(config);
  const max = config.autopilot?.maxLanes ?? 1;
  const reasons = [];
  if (adoptionLevel(config) >= 3) {
  try {
    const lessons = outcomes({ root, config });
    if (lessons.recent.length) reasons.push(`learn: check did not hold: ${lessons.recent.map(c => c.class).join(", ")}`);
    if (lessons.due.length > (config.learn?.maxDue ?? 3)) reasons.push(`learn: ${lessons.due.length} due classes exceed maxDue ${config.learn?.maxDue ?? 3}`);
  } catch (error) { reasons.push(`could not check lessons: ${error.message}`); }
  }
  if (adoptionLevel(config) < 4) return { allowed: 1, max, reasons: [...reasons, "not adopted (level 4): allowing one repair lane"] };
  if (!config.evals?.suites?.length) reasons.push("no eval suite configured: add evals.suites before scaling");
  if (!config.autopilot) reasons.push("not configured: add an autopilot block with maxLanes to .claude/trust-before-scale.json");
  // Check suites separately: an unreadable suite must not hide another suite's failures.
  for (const suite of config.evals?.suites ?? []) {
    const lines = [];
    try {
      if (evalCheck(["--check", "--fresh"], { root,
        config: { ...config, evals: { ...config.evals, suites: [suite] } }, log: (line) => lines.push(line) }) !== 0) {
        reasons.push(`eval ${suite.name} failed --check --fresh (scaling requires age <= ${suite.maxAgeDays ?? 7} days): ${lines.join("; ")}`);
      }
    } catch (error) { reasons.push(`could not check eval ${suite.name}: ${error.message}`); }
  }
  const owedLines = [];
  const logOwed = (line) => owedLines.push(line);
  try { owedCheck(["--owed"], { root, config, ghRun, log: logOwed }); }
  catch (error) {
    reasons.push(`could not check owed self-merged PRs: ${error.message}`);
    // Still collect hook skips when GitHub is unavailable. With no known oldest PR, inspect all unacknowledged skips.
    try { owedCheck(["--owed"], { root, config, ghRun: () => "[]", log: logOwed }); }
    catch (skipError) { reasons.push(`could not check hook skips: ${skipError.message}`); }
  }
  const owed = owedLines.filter((line) => /^#\d+\t/.test(line));
  if (owed.length) reasons.push(`self-merged PRs owed a review: ${owed.map((line) => line.split("\t")[0]).join(", ")}`);
  const notes = [];
  // A project may keep its own feature map instead of the kit's (a "thin" install): not adopted is not red.
  if (!config.featureMap) notes.push("feature map not configured in the kit: not checked (the project may keep its own)");
  else try {
    const lines = [];
    if (mapCheck([], { root, config, log: (line) => lines.push(line) }) !== 0) {
      reasons.push(`feature map check is red: ${lines.join("; ")}`);
    }
  } catch (error) { reasons.push(`could not check feature map: ${error.message}`); }
  // A failed GitHub call and its offline retry can both log the same skip: report each once.
  const skips = [...new Set(owedLines.filter((line) => line.startsWith("HOOK SKIP\t")))];
  if (skips.length) reasons.push(`unreviewed hook skips after acknowledgement, since the oldest owed PR (all unacknowledged if none owed): ${skips.join("; ")}`);
  const result = { allowed: reasons.length ? 1 : max, max, reasons: reasons.map((reason) => reason.replace(/[\r\n]+/g, " ")) };
  if (notes.length) result.notes = notes;
  return result;
}

export function main(argv, { log = console.log, ...options } = {}) {
  let required = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") continue;
    if (argv[i] !== "--require" || !/^[1-9]\d*$/.test(argv[i + 1] ?? "")) {
      throw new Error("Usage: lanes.mjs [--json] [--require <positive integer>]");
    }
    required = Number(argv[++i]);
    if (!Number.isSafeInteger(required)) throw new Error("--require must be a safe positive integer");
  }
  const result = laneAllowance(options);
  if (argv.includes("--json")) log(JSON.stringify(result));
  else {
    log(`Allowed lanes: ${result.allowed} (max: ${result.max})`);
    for (const reason of result.reasons) log(reason);
    for (const note of result.notes ?? []) log(`note: ${note}`);
  }
  return result.allowed < required ? 1 : 0;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
