#!/usr/bin/env node
// Diagnose the adopted pieces using the shared config loader and installed schema.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ROOT, isMain, loadConfig, configPath, validateConfig, adoptionLevel } from "./config.mjs";
import { outcomes } from "./learn.mjs";
export function main(argv = [], { root = ROOT, config, log = console.log,
  probe = (command) => execFileSync(command, ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 10000 }),
  plugin = process.env.TBS_PLUGIN,
} = {}) {
  let failures = 0;
  const fail = (message, next) => { failures++; log(`FAIL ${message}. Next: ${next}`); };
  for (const command of ["node", "python3", "git", "gh"]) {
    try { probe(command); log(`PASS ${command}`); }
    catch { if (command === "gh") log("OPTIONAL gh missing; install GitHub CLI before using self-merge"); else fail(`${command} missing`, `install ${command} and rerun doctor`); }
  }
  if (Number(process.versions.node.split(".")[0]) < 20) fail("Node 20+ required", "upgrade Node");
  try { config = config === undefined ? loadConfig(root) : validateConfig(config); }
  catch (error) { fail(error.message, "repair the project config using the config schema"); return 1; }
  const level = adoptionLevel(config);
  log(`PASS config (level ${level})`);
  if (config.level === undefined) log(`NOTE level not set: treated as level 1 (scripts and autopilot). Set "level": <1-4> in ${configPath(root)} to opt in to more.`);
  const versionFile = join(root, "scripts/tbs/VERSION");
  if (existsSync(versionFile)) {
    const project = readFileSync(versionFile, "utf8").trim();
    log(`NOTE kit ${project}`);
    if (plugin) {
      try {
        const { version: installed } = JSON.parse(readFileSync(join(plugin, ".claude-plugin/plugin.json"), "utf8"));
        if (typeof installed === "string" && /^\d+\.\d+\.\d+$/.test(installed)) {
          const parts = /^\d+\.\d+\.\d+$/.test(project) ? project.split(".").map(BigInt) : [];
          const installedParts = installed.split(".").map(BigInt);
          const difference = parts.findIndex((part, index) => part !== installedParts[index]);
          if (difference !== -1 && parts[difference] < installedParts[difference]) {
            log(`WARN project kit ${project} is older than installed plugin ${installed}. Next: node "$TBS_PLUGIN/bin/tbs-init" --update`);
          } else {
            log(`NOTE installed kit plugin ${installed}`);
          }
        }
      } catch { /* A missing or invalid plugin manifest is advisory. */ }
    }
  }
  const piece = (ok, name, next) => { if (!ok) fail(name, next); else log(`PASS ${name}`); };
  piece(!!config.mergeGate, "merge gate settings", "add mergeGate settings and install/trust your harness hook");
  log("NOTE hook installation/trust must be checked in your harness; doctor cannot prove it is active");
  if (existsSync(join(root, ".codex"))) {
    let installed = false;
    try {
      const hooks = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8"));
      // Warn when the hook's script is missing, including for legacy absolute commands.
      installed = hooks.hooks?.PreToolUse?.some(entry => entry.matcher === "Bash" &&
        entry.hooks?.some(hook => {
          if (hook.type !== "command") return false;
          const command = hook.command ?? "";
          if (/^if f="\$\(git rev-parse --show-toplevel 2>\/dev\/null\)\/scripts\/tbs\/merge-gate\.py" && /.test(command)) {
            // The hook runs the gate only when its pinned SHA-256 matches; a changed gate is not enforced.
            const gate = join(root, "scripts/tbs/merge-gate.py");
            const pinned = /"([0-9a-f]{64})"/.exec(command)?.[1];
            const digest = (file) => createHash("sha256").update(readFileSync(file).toString("latin1").replaceAll("\r\n", "\n"), "latin1").digest("hex");
            return existsSync(gate) && !!pinned && digest(gate) === pinned;
          }
          const path = /"([^"]*hooks\/merge-gate\.py)"/.exec(command)?.[1]?.replace(/\\(.)/g, "$1");
          return !!path && existsSync(path);
        }));
    } catch { /* Missing or malformed hooks are advisory; the installer reports malformed JSON. */ }
    if (!installed) log('WARN Codex project merge hook is missing, or its gate script is missing or changed. Next: node "<plugin-root>/bin/tbs-init" --update --codex-hook, then trust it in Codex /hooks');
  }
  if (level >= 2) {
    // A project may keep its own feature map (owner decision 19 Nov 2026), as lanes.mjs accepts.
    if (!config.featureMap) log("NOTE feature map not configured in the kit: not checked (the project may keep its own). To use the kit's: add featureMap.sources");
    if (config.featureMap) {
      piece(existsSync(join(root, config.featureMap.file ?? "docs/feature-map.json")), "feature map file", "run node scripts/tbs/feature-map.mjs --init");
      for (const source of config.featureMap.sources) piece(existsSync(join(root, source.dir)), `feature source ${source.dir}`, "correct featureMap.sources[].dir");
    }
  }
  if (level >= 3) {
    try {
      const lessons = outcomes({ root, config, committedOnly: argv.includes("--ci") });
      log(`NOTE lessons: ${lessons.due.length} due classes, ${lessons.recurred.length} recurred classes. Next: node scripts/tbs/learn.mjs --due`);
    } catch (error) { fail(`lessons: ${error.message}`, "repair lesson records and run node scripts/tbs/learn.mjs --due"); }
    const suites = config.evals?.suites ?? [];
    piece(suites.length > 0, "eval suites configured", "add evals.suites and run your review evals");
    const checked = new Set();
    for (const suite of suites) {
      piece(existsSync(join(root, "evals", suite.name, "cases")), `eval ${suite.name} cases`, "create the suite cases");
      for (const skill of suite.skills) piece(existsSync(join(root, skill)), `skill ${skill}`, "install the configured review skill");
      const reviewer = suite.reviewer ?? "claude", judge = suite.judge ?? "codex";
      piece(reviewer !== judge || suite.allowSameJudge === true || config.evals.allowSameJudge === true, `independent judge for ${suite.name}`, "choose a different judge or explicitly set allowSameJudge");
      for (const runner of argv.includes("--ci") ? [] : [reviewer, judge]) {
        const command = runner.match(/^\s*([^\s]+)/)?.[1];
        if (checked.has(command)) continue; checked.add(command);
        try { probe(command); log(`PASS ${command} reviewer/judge CLI`); }
        catch { fail(`${command} reviewer/judge CLI missing`, `install ${command} or configure reviewer/judge command templates`); }
        if (!["claude", "codex", "cursor-agent", "gemini"].includes(runner)) log(`NOTE custom runner ${command}: command execution and credentials require a real eval`);
      }
    }
  }
  if (level >= 4) {
    piece(!!config.autopilot, "lane settings", "add autopilot.maxLanes");
    piece(!!config.selfMerge, "self-merge settings", "add selfMerge settings; enable only after accepting the ADR");
    for (const key of ["handoff", "continuation", "extension"]) if (config.autopilot?.[key]) piece(existsSync(join(root, config.autopilot[key])), `autopilot.${key}`, `create ${config.autopilot[key]}`);
  }
  return failures ? 1 : 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
