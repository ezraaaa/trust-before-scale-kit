#!/usr/bin/env node
// Diagnose the adopted pieces using the shared config loader and installed schema.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, isMain, loadConfig, validateConfig, adoptionLevel } from "./config.mjs";
import { outcomes } from "./learn.mjs";
export function main(argv = [], { root = ROOT, config, log = console.log,
  probe = (command) => execFileSync(command, ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 10000 }),
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
  const piece = (ok, name, next) => { if (!ok) fail(name, next); else log(`PASS ${name}`); };
  piece(!!config.mergeGate, "merge gate settings", "add mergeGate settings and install/trust your harness hook");
  log("NOTE hook installation/trust must be checked in your harness; doctor cannot prove it is active");
  if (existsSync(join(root, ".codex"))) {
    let installed = false;
    try {
      const hooks = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8"));
      // The hook must name a script that still exists: plugin updates move the install directory.
      installed = hooks.hooks?.PreToolUse?.some(entry => entry.matcher === "Bash" &&
        entry.hooks?.some(hook => {
          const path = /"([^"]*hooks\/merge-gate\.py)"/.exec(hook.command ?? "")?.[1]?.replace(/\\(.)/g, "$1");
          return hook.type === "command" && !!path && existsSync(path);
        }));
    } catch { /* Missing or malformed hooks are advisory; the installer reports malformed JSON. */ }
    if (!installed) log('WARN Codex project merge hook missing or pointing at a moved plugin. Next: node "<plugin-root>/bin/tbs-init" --update --codex-hook, then trust it in Codex /hooks');
  }
  if (level >= 2) {
    piece(!!config.featureMap, "feature map configured", "add featureMap.sources");
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
