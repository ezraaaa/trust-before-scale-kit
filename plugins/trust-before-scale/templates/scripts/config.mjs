// Trust before scale: the one place a project's settings are read (.agents/ first, then legacy .claude/).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function loadConfig(root = ROOT) {
  const path = [".agents", ".claude"].map((dir) => join(root, dir, "trust-before-scale.json")).find(existsSync)
    ?? join(root, ".agents", "trust-before-scale.json");
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch { throw new Error(`No ${path}. Run the trust-before-scale setup skill in this project first.`); }
  let config;
  try { config = JSON.parse(text); }
  catch (error) { throw new Error(`${path} is not valid JSON: ${error.message}`); }
  return validateConfig(config);
}

export const REVIEW_RAN = {
  claude: "REVIEW RAN|claude-review: reviewed",
  codex: "REVIEW RAN|codex-review: reviewed|OpenAI Codex",
  "cursor-agent": "REVIEW RAN|cursor-agent-review: reviewed",
  gemini: "REVIEW RAN|gemini-review: reviewed",
};

function validateSettings(config) {
  for (const suite of config.evals?.suites ?? []) {
    if (suite.repeats !== undefined && (!Number.isInteger(suite.repeats) || suite.repeats < 1)) throw new Error(`${suite.name}: repeats must be a positive integer`);
    const reviewer = suite.reviewer ?? "claude", judge = suite.judge ?? "codex";
    for (const value of [reviewer, judge]) {
      if (typeof value !== "string" || (!Object.hasOwn(REVIEW_RAN, value) && !value.includes("{prompt}")))
        throw new Error("reviewer/judge must be a preset or command template containing {prompt}");
    }
    if (reviewer === judge && suite.allowSameJudge !== true && config.evals.allowSameJudge !== true)
      throw new Error("judge must differ from reviewer (or set allowSameJudge: true)");
  }
  const lessonPath = config.learn?.file;
  if (lessonPath !== undefined && (typeof lessonPath !== "string" || !lessonPath || lessonPath.startsWith("/") || lessonPath.includes("\\") || lessonPath.split("/").includes("..") || /^[A-Za-z]:/.test(lessonPath))) throw new Error("learn.file must be a repo-relative path");
  const routine = config.routine;
  if (routine && Array.isArray(routine.rows)) {
    const names = new Set();
    for (const row of routine.rows) {
      if (!row || typeof row !== "object") continue; // Schema reports shape errors.
      if (names.has(row.name)) throw new Error(`routine.rows: duplicate name ${row.name}`);
      names.add(row.name);
      if (Array.isArray(row.paths)) for (const pattern of row.paths) {
        try { new RegExp(pattern); } catch { throw new Error(`routine.rows ${row.name}: invalid path regex`); }
      }
      if (Array.isArray(row.passes)) for (const step of row.passes) {
        if (!routine.passes?.[step]) throw new Error(`routine.passes.${step}: missing command mapping`);
      }
      if (Array.isArray(row.before)) for (const step of row.before) {
        if (!row.passes?.includes(step)) throw new Error(`routine.rows ${row.name}: before pass ${step} must also run after building`);
      }
    }
  }
  const review = config.selfMerge?.review;
  if (review && !review.ranPattern && Object.hasOwn(REVIEW_RAN, review.reviewer ?? "codex"))
    review.ranPattern = REVIEW_RAN[review.reviewer ?? "codex"];
  const settings = config.autopilot;
  if (settings === undefined) return config;
  if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
      !Number.isInteger(settings.maxLanes) || settings.maxLanes < 1) {
    throw new Error("autopilot.maxLanes must be a positive integer");
  }
  for (const key of ["handoff", "continuation", "extension"]) {
    const path = settings[key];
    if (path !== undefined && (typeof path !== "string" || !path.length ||
        path.startsWith("/") || path.split("/").includes("..") || path.includes("\\") || /^[A-Za-z]:/.test(path))) {
      throw new Error(`autopilot.${key} must be a repo-relative path`);
    }
  }
  if (settings.checkIns !== undefined) {
    const check = settings.checkIns;
    if (!check || typeof check.timeZone !== "string" || !Array.isArray(check.times) || !check.times.length ||
        !check.times.every((time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      throw new Error("autopilot.checkIns needs a timeZone and HH:MM times");
    }
    try { new Intl.DateTimeFormat("en", { timeZone: check.timeZone }); }
    catch { throw new Error("autopilot.checkIns.timeZone must be a valid time zone"); }
  }
  return config;
}

/** Evidence logs carry their own proof: a `HEAD=<sha>` line written before the gate runs, and the
 *  project's exit marker as the last line. That makes one rule work for any gate in any stack. */
export function evidenceFor(log, head, exitMarker) {
  const lines = log.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const heads = lines.filter((line) => /^HEAD=[0-9a-f]{40}$/.test(line)).map((line) => line.slice(5));
  const [key] = exitMarker.split("=");
  const exits = lines.filter((line) => line.startsWith(`${key}=`));
  return {
    sameHead: heads.length === 1 && heads[0] === head,
    passed: lines.at(-1) === exitMarker && exits.length === 1,
  };
}

/** Run as a script? (works through symlinks and `node path`) */
export function isMain(metaUrl) {
  try { return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl); }
  catch { return false; }
}

// Installed scripts vendor the schema beside this module; the kit keeps one canonical source.
const schemaUrl = ["./config.schema.json", "../../schema/config.schema.json"]
  .map(path => new URL(path, import.meta.url)).find(existsSync);
if (!schemaUrl) throw new Error("Missing config.schema.json beside config.mjs (reinstall the kit).");
export const schema = JSON.parse(readFileSync(schemaUrl, "utf8"));
export const adoptionLevel = (config) => config.level ?? 4; // Existing installs retain their behavior.
export function validateConfig(config) {
  const errors = [];
  function check(value, rule, at) {
    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (rule.type && !(rule.type === "integer" ? Number.isInteger(value) : type === rule.type)) { errors.push(`${at}: expected ${rule.type}`); return; }
    if (rule.enum && !rule.enum.includes(value)) errors.push(`${at}: unknown value ${value}`);
    if (typeof value === "number" && ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))) errors.push(`${at}: out of range`);
    if (typeof value === "string" && ((rule.minLength && value.length < rule.minLength) || (rule.pattern && !new RegExp(rule.pattern).test(value)))) errors.push(`${at}: invalid value`);
    if (Array.isArray(value)) {
      if (value.length < (rule.minItems ?? 0)) errors.push(`${at}: must not be empty`);
      value.forEach((item, i) => check(item, rule.items, `${at}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const key of rule.required ?? []) if (!(key in value)) errors.push(`${at}.${key}: required`);
      if (rule.anyOf && !rule.anyOf.some((option) => option.required.every((key) => key in value))) errors.push(`${at}: needs a preset or ext and item/pathItem`);
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined || key.startsWith("_") || key === "$schema") continue;
        if (rule.properties?.[key]) check(item, rule.properties[key], `${at}.${key}`);
        else if (rule.additionalProperties === false) errors.push(`${at}.${key}: unknown key`);
      }
    }
  }
  validateSettings(config);
  check(config, schema, "config");
  const zone = config?.autopilot?.checkIns?.timeZone;
  if (typeof zone === "string") try { new Intl.DateTimeFormat("en", { timeZone: zone }); } catch { errors.push("autopilot.checkIns.timeZone: invalid time zone"); }
  if (errors.length) throw new Error(errors.join("; "));
  return config;
}
