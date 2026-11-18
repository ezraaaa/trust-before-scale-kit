#!/usr/bin/env node
// Trust before scale, d2: a feature map that walks read.
//
// docs/feature-map.json (config.featureMap.file) lists every screen: who reaches it, how a walk
// signs in, what shows it has loaded, and each act that changes something, with its accessible name
// and what a correct result shows. Screens are DISCOVERED from the code (config.featureMap.sources),
// so a new screen fails this check until it is mapped or consciously listed in notMappedYet.
//
//   node scripts/tbs/feature-map.mjs           check the map (put it in the gate)
//   node scripts/tbs/feature-map.mjs --list    print every screen id found in the code
//   node scripts/tbs/feature-map.mjs --init    write a starting map with every screen in notMappedYet
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { ROOT, isMain } from "./config.mjs";
import { loadConfig, adoptionLevel } from "./config.mjs";

const EMPTY = "no screens found: fix featureMap.sources in .claude/trust-before-scale.json";

function walk(dir, ext, root) {
  const full = join(root, dir);
  if (!existsSync(full)) throw new Error(`${EMPTY} (source folder missing: ${dir})`);
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || ["build", "node_modules", "Pods", "DerivedData"].includes(entry.name)) return [];
    const child = join(dir, entry.name);
    if (entry.isDirectory()) return /tests?$/i.test(entry.name) ? [] : walk(child, ext, root);
    return entry.name.endsWith(ext) && !/(Test|Tests|_test|\.test)\.\w+$/.test(entry.name) ? [child] : [];
  });
}

/** The body of the brace block that opens at or after `from`. */
export function braceBody(text, from) {
  const open = text.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/** Top-level comma split, so `case a, b(x: Int, y: Int)` gives a and b. */
export function topLevelNames(list) {
  const names = []; let depth = 0; let piece = "";
  for (const ch of `${list},`) {
    if ("([{<".includes(ch)) depth++;
    if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) { const name = piece.trim().match(/^(\w+)/)?.[1]; if (name) names.push(name); piece = ""; }
    else piece += ch;
  }
  return names;
}

export const PRESETS = {
  "swift-routes": { ext: ".swift", block: "enum (\\w*Route|\\w*Tab)[^{]*\\{", item: "\\bcase\\s+([^\\n]+)", splitList: true, id: "{block}.{item}" },
  "kotlin-routes": { ext: ".kt", item: "(?:data\\s+)?(?:object|class)\\s+(\\w+)[^\\n{]*:\\s*\\w*Route\\b" },
  "react-router": { ext: ".tsx", item: "path\\s*[:=]\\s*['\"]([^'\"]+)['\"]" },
  "nextjs-app": { ext: "page.tsx" },
  "flutter-go-router": { ext: ".dart", item: "GoRoute\\s*\\(\\s*path:\\s*['\"]([^'\"]+)['\"]" },
};
export function resolveSource(source) {
  if (!source.preset) return source;
  if (!PRESETS[source.preset]) throw new Error(`Unknown feature-map preset: ${source.preset}`);
  const resolved = { ...PRESETS[source.preset], ...source };
  if (source.preset === "nextjs-app" && !source.pathItem) {
    const dir = source.dir.replaceAll("\\", "/").replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    resolved.ext = source.ext ?? "";
    resolved.pathItem = `^${dir}((?:/[^/]+)*)/page\\.(?:js|jsx|ts|tsx|mdx)$`;
  }
  return resolved;
}
export function discoverIn(text, source) {
  source = resolveSource(source);
  const ids = [];
  const item = new RegExp(source.item, "g");
  const fill = (block, name) => (source.id ?? "{item}").replace("{block}", block ?? "").replace("{item}", name).replace("{label}", source.label ?? "");
  const scan = (body, block) => {
    for (const match of body.matchAll(item)) {
      const names = source.splitList ? topLevelNames(match[1]) : [match[1]];
      for (const name of names) ids.push(fill(block, name));
    }
  };
  if (!source.block) scan(text);
  else for (const match of text.matchAll(new RegExp(source.block, "g"))) scan(braceBody(text, match.index + match[0].length - 1), match[1]);
  return ids;
}

export function discover(root, sources) {
  const found = new Map();
  for (const input of sources) {
    const source = resolveSource(input);
    for (const file of walk(source.dir, source.ext, root)) {
      // pathItem: the screen is the file itself (Next.js page.tsx and the like); capture group 1 is the route.
      const ids = source.pathItem
        ? [file.replaceAll("\\", "/").match(new RegExp(source.pathItem))?.[1]].filter((x) => x !== undefined)
          .map((route) => {
            if (input.preset === "nextjs-app" && !input.pathItem) {
              route = route.split("/").filter(segment => !/^\([^)]+\)$/.test(segment)).join("/");
            }
            return (source.id ?? "{item}").replace("{item}", route || "/").replace("{label}", source.label ?? "");
          })
        : discoverIn(readFileSync(join(root, file), "utf8"), source);
      for (const id of ids) if (!found.has(id)) found.set(id, relative(root, join(root, file)));
    }
  }
  return found;
}

export function problems(map, found, root = ROOT) {
  const out = [];
  const screens = map.screens ?? []; const pending = map.notMappedYet ?? [];
  const declared = [...screens.map((s) => s.id), ...pending.map((p) => p.id)];
  const seen = new Set();
  for (const id of declared) { if (seen.has(id)) out.push(`listed twice: ${id}`); seen.add(id); }
  for (const id of found.keys()) if (!seen.has(id)) out.push(`not in the map: ${id} (${found.get(id)}): map it, or add it to notMappedYet with a reason`);
  for (const id of seen) if (!found.has(id)) out.push(`the map names a screen the code does not have: ${id}`);
  for (const p of pending) if (!p.reason?.trim()) out.push(`notMappedYet ${p.id}: give a reason`);
  for (const s of screens) {
    if (s.verify !== undefined) {
      if (typeof s.verify !== "string" || !s.verify.trim() || isAbsolute(s.verify) || s.verify.split(/[\\/]/).includes("..")) {
        out.push(`${s.id}: verify must be a repo-relative file path: ${s.verify}`);
      } else if (!existsSync(join(root, s.verify)) || !statSync(join(root, s.verify)).isFile()) {
        out.push(`${s.id}: verify file missing: ${s.verify}`);
      }
    }
    if (s.preconditions !== undefined && (!Array.isArray(s.preconditions) || s.preconditions.some((item) => typeof item !== "string"))) {
      out.push(`${s.id}: preconditions must be a string array`);
    }
    if (s.notBuilt || s.redirectsTo) continue;
    if (!s.title?.trim()) out.push(`${s.id}: no title`);
    if (!Array.isArray(s.roles) || !s.roles.length) out.push(`${s.id}: no roles`);
    if (!s.landed?.trim()) out.push(`${s.id}: no "landed" (what only a loaded screen shows)`);
    if (!Array.isArray(s.acts)) out.push(`${s.id}: no acts list (use [] for a screen with none)`);
    for (const act of s.acts ?? []) {
      if (!act.name?.trim()) out.push(`${s.id}: an act has no accessible name`);
      if (!act.result?.trim()) out.push(`${s.id} / ${act.name}: no result (what a correct outcome shows)`);
      if (act.result && act.result === s.landed) out.push(`${s.id} / ${act.name}: its result is already on screen before the press`);
      for (const role of act.who ?? []) if (!(s.roles ?? []).includes(role)) out.push(`${s.id} / ${act.name}: ${role} cannot reach this screen`);
    }
  }
  return out;
}

export function main(argv, { root = ROOT, config = loadConfig(root), log = console.log } = {}) {
  if (adoptionLevel(config) < 2) { log("not adopted (level 2)"); return 0; }
  const settings = config.featureMap;
  if (!settings?.sources?.length) throw new Error(EMPTY);
  const found = discover(root, settings.sources);
  if (!found.size && (argv.includes("--list") || argv.includes("--init"))) throw new Error(EMPTY);
  const file = join(root, settings.file ?? "docs/feature-map.json");
  if (argv.includes("--list")) { for (const [id, where] of found) log(`${id}\t${where}`); return 0; }
  if (argv.includes("--init")) {
    if (existsSync(file)) throw new Error(`${relative(root, file)} already exists`);
    const map = { screens: [], notMappedYet: [...found.keys()].map((id) => ({ id, reason: "not mapped yet" })) };
    writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`);
    log(`wrote ${relative(root, file)} with ${found.size} screens to map`);
    return 0;
  }
  if (!existsSync(file)) { log(`no ${relative(root, file)}: run with --init`); return 1; }
  const out = problems(JSON.parse(readFileSync(file, "utf8")), found, root);
  for (const line of out) log(line);
  if (!out.length) log(`feature map covers all ${found.size} screens`);
  return out.length ? 1 : 0;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
