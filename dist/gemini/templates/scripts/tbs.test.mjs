// Trust before scale: tests for the pure parts of every script. Run: node --test scripts/tbs/tbs.test.mjs
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { laneAllowance, main as lanesMain } from "./lanes.mjs";
import { evidenceFor, loadConfig } from "./config.mjs";
import { decide, eligibility, reviewClean, run } from "./self-merge.mjs";
import { casesHash, hiddenPaths, loadCases, runCase, skillHash, gated, judged, recordProblems, reviewText, settingsHash, validateCase, main as evalMain } from "./skill-eval.mjs";
import { discover, discoverIn, problems, topLevelNames, main as mapMain } from "./feature-map.mjs";
import { bootEnv, isolate, portsNeeded } from "./free-ports.mjs";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const lane = {
  enabled: true,
  allow: ["^docs/", "\\.test\\.(ts|mjs)$", "^evals/"],
  block: ["^docs/instructions/", "^firebase/", "\\.rules$"],
  testFile: "\\.test\\.(ts|mjs)$",
  gateRanPattern: "all good",
  review: { ranPattern: "REVIEW RAN", findingPattern: "\\[P[123]\\]" },
};
const config = { level: 4, baseBranch: "develop", mergeGate: { exitMarker: "EXIT=0" }, selfMerge: lane };
const gateLog = (head = HEAD, exit = "EXIT=0") => `HEAD=${head}\nall good\n${exit}\n`;
const reviewLog = (extra = "") => `HEAD=${HEAD}\nlog=x\n${extra}REVIEW RAN (4 commands)\nEXIT=0\n`;
const info = { headRefOid: HEAD, baseRefName: "develop", state: "OPEN", isDraft: false };

test("evidence must name this head once and end in the exit marker", () => {
  assert.deepEqual(evidenceFor(gateLog(), HEAD, "EXIT=0"), { sameHead: true, passed: true });
  assert.equal(evidenceFor(gateLog(OTHER), HEAD, "EXIT=0").sameHead, false);
  assert.equal(evidenceFor(gateLog(HEAD, "EXIT=1"), HEAD, "EXIT=0").passed, false);
  assert.equal(evidenceFor(`HEAD=${HEAD}\nEXIT=1\nEXIT=0\n`, HEAD, "EXIT=0").passed, false, "two exits is not one green run");
});

test("eligibility: allowed paths pass, blocks win, deleted tests block", () => {
  assert.equal(eligibility([{ path: "docs/briefs/x.md", status: "added" }], lane).eligible, true);
  assert.equal(eligibility([{ path: "docs/instructions/a.md", status: "modified" }], lane).eligible, false);
  assert.equal(eligibility([{ path: "src/app.ts", status: "modified" }], lane).eligible, false);
  assert.equal(eligibility([{ path: "src/a.test.ts", status: "removed" }], lane).eligible, false);
  assert.equal(eligibility([{ path: "firebase/x.test.ts", status: "modified" }], lane).eligible, false);
  assert.equal(eligibility([], lane).eligible, false);
});

test("decide refuses every missing or wrong piece of evidence", () => {
  const ok = { info, files: [{ path: "docs/a.md", status: "added" }], config,
    gateLogs: [{ name: "g", text: gateLog() }], reviewLog: { name: "r", text: reviewLog() } };
  assert.deepEqual(decide(ok), []);
  assert.ok(decide({ ...ok, config: { ...config, selfMerge: { ...lane, enabled: false } } }).length);
  assert.ok(decide({ ...ok, gateLogs: [] }).length);
  assert.ok(decide({ ...ok, gateLogs: [{ name: "g", text: gateLog(OTHER) }] }).length);
  assert.ok(decide({ ...ok, reviewLog: { name: "r", text: reviewLog("[P2] something\n") } }).length);
  assert.ok(decide({ ...ok, reviewLog: undefined }).length);
  // HEAD and EXIT with nothing between them is not a gate that ran.
  assert.ok(decide({ ...ok, gateLogs: [{ name: "g", text: `HEAD=${HEAD}\nEXIT=0\n` }] }).length);
  assert.ok(decide({ ...ok, config: { ...config, selfMerge: { ...lane, gateRanPattern: undefined } } }).length);
  // A line-anchored marker matches mid-log, after the HEAD line.
  const anchored = { ...config, selfMerge: { ...lane, gateRanPattern: "^all good$" } };
  assert.deepEqual(decide({ ...ok, config: anchored }), []);
  assert.ok(decide({ ...ok, info: { ...info, baseRefName: "main" } }).length);
  assert.ok(decide({ ...ok, info: { ...info, headRefName: "external/verification-skill" } }).length, "a bot lane branch");
  assert.ok(decide({ ...ok, info: { ...info, labels: [{ name: "external-agent" }] } }).length, "a bot lane label");
  assert.deepEqual(decide({ ...ok, info: { ...info, headRefName: "chore/x", labels: [{ name: "docs" }] } }), []);
  assert.equal(reviewClean("HEAD=" + HEAD + "\nEXIT=0\n", HEAD, { exitMarker: "EXIT=0", ...lane.review }).ran, false);
});

test("the lane labels before it merges, and never merges on a refusal", () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args.slice(0, 2).join(" "));
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify(info);
    if (args[0] === "api") return JSON.stringify([[{ filename: "docs/a.md", status: "added" }]]);
    return "";
  };
  const read = (path) => (path === "r" ? reviewLog() : gateLog());
  assert.equal(run(["7", "--gate", "g", "--review", "r"], { config, ghRun: gh, read, log: () => {} }), 0);
  assert.ok(calls.indexOf("pr edit") < calls.indexOf("pr merge"), "label first");
  calls.length = 0;
  const badRead = (path) => (path === "r" ? reviewLog("[P1] x\n") : gateLog());
  assert.equal(run(["7", "--gate", "g", "--review", "r"], { config, ghRun: gh, read: badRead, log: () => {} }), 1);
  assert.ok(!calls.includes("pr merge"));
  calls.length = 0;
  // A wrapper that prints only log=<path>: the findings live in the linked file.
  const linkedRead = (path) => (path === "r" ? reviewLog() : path === "x" ? "# Codex Review\n- [P2] hidden finding\n" : gateLog());
  assert.equal(run(["7", "--gate", "g", "--review", "r"], { config, ghRun: gh, read: linkedRead, log: () => {} }), 1);
  const missingRead = (path) => { if (path === "x") throw new Error("gone"); return path === "r" ? reviewLog() : gateLog(); };
  assert.equal(run(["7", "--gate", "g", "--review", "r"], { config, ghRun: gh, read: missingRead, log: () => {} }), 1);
  assert.ok(!calls.includes("pr merge"));
});

test("skill eval: cases stay blind, judges are checked, records go stale", () => {
  const patch = "--- a/src/x.ts\n+++ b/src/x.ts\n@@\n+bad\n";
  const item = validateCase({ id: "x", expect: "review", rule: "r", mustName: ["m"], file: "src/x.ts" }, "x", patch);
  assert.throws(() => validateCase({ ...item }, "x", `${patch}+// seeded eval\n`));
  assert.doesNotThrow(() => validateCase({ ...item }, "x", `--- a/src/x.ts\n+++ b/src/x.ts\n@@\n // written by the seed script\n+bad\n`), "context lines are not the change");
  assert.throws(() => validateCase({ ...item, file: "src/y.ts" }, "x", patch));
  assert.equal(judged(JSON.stringify({ caught: true, evidence: "line 3: bad" }), "intro\nline 3: bad\n").pass, true);
  assert.equal(judged(JSON.stringify({ caught: true, evidence: "invented" }), "line 3: bad").pass, false);
  assert.equal(gated({ status: 0, stdout: "src/x.ts" }, "src/x.ts").pass, false);
  assert.equal(gated({ status: 1, stdout: "error in src/x.ts" }, "src/x.ts").pass, true);
  assert.equal(gated({ status: null, signal: "SIGTERM", stdout: "src/x.ts" }, "src/x.ts").pass, false);
  assert.equal(gated({ status: null, stdout: "src/x.ts" }, "src/x.ts").pass, false);
  assert.equal(gated({ status: 1, error: new Error("ENOENT"), stdout: "src/x.ts" }, "src/x.ts").pass, false);
  const cases = [{ ...item, patch }];
  const record = { date: new Date().toISOString(), skillHash: "h", settingsHash: "s", casesHash: casesHash(cases), cases: [{ id: "x", pass: true }] };
  assert.deepEqual(recordProblems(record, { hash: "h", settingsHash: "s", cases }), []);
  assert.ok(recordProblems(record, { hash: "changed", settingsHash: "s", cases }).length);
  assert.ok(recordProblems(undefined, { hash: "h", settingsHash: "s", cases }).length);
  assert.ok(recordProblems({ ...record, cases: [{ id: "x", pass: false }] }, { hash: "h", settingsHash: "s", cases }).length);
  assert.ok(recordProblems({ ...record, date: "2020-01-01T00:00:00Z" }, { hash: "h", settingsHash: "s", cases, fresh: true, maxAgeDays: 7 }).length);
  for (const date of [undefined, "", "not a date"]) {
    assert.deepEqual(recordProblems({ ...record, date }, { hash: "h", settingsHash: "s", cases, fresh: true, maxAgeDays: 7 }),
      ["the record has no valid date: run it again"]);
  }
});

test("feature map: discovery and coverage", () => {
  assert.deepEqual(topLevelNames("a, b(x: Int, y: Int), c = 3"), ["a", "b", "c"]);
  const swift = "enum KidsRoute: Hashable {\n  case kid(Kid)\n  case enroll, settings\n}\n";
  assert.deepEqual(discoverIn(swift, { block: "enum (\\w*Route)\\s*:\\s*Hashable[^{]*\\{", item: "\\bcase\\s+([^\\n]+)", splitList: true, id: "ios:{block}.{item}" }),
    ["ios:KidsRoute.kid", "ios:KidsRoute.enroll", "ios:KidsRoute.settings"]);
  const found = new Map([["a", "f"], ["b", "f"]]);
  const screen = { id: "a", title: "A", roles: ["parent"], landed: ".list", acts: [{ name: "Save", who: ["parent"], result: "Saved" }] };
  assert.deepEqual(problems({ screens: [screen], notMappedYet: [{ id: "b", reason: "later" }] }, found), []);
  assert.ok(problems({ screens: [screen], notMappedYet: [] }, found).some((p) => p.includes("not in the map: b")));
  assert.ok(problems({ screens: [screen, { id: "z", notBuilt: true }], notMappedYet: [{ id: "b", reason: "x" }] }, found).some((p) => p.includes("does not have: z")));
  assert.ok(problems({ screens: [{ ...screen, acts: [{ name: "Save", who: ["admin"], result: "Saved" }] }], notMappedYet: [{ id: "b", reason: "x" }] }, found).length);
  assert.ok(problems({ screens: [{ ...screen, acts: [{ name: "Save", who: ["parent"], result: ".list" }] }], notMappedYet: [{ id: "b", reason: "x" }] }, found).length, "result already on screen");
});

test("free ports: every emulator moves, UI off, SDK variables point at this boot", () => {
  const only = ["auth", "firestore", "functions"];
  const ports = Array.from({ length: portsNeeded(only) }, (_, i) => 20000 + i);
  const emulators = isolate({ auth: { port: 9099 }, firestore: { port: 8080 }, functions: { port: 5001 }, ui: { enabled: true, port: 4000 } }, only, ports);
  assert.equal(emulators.ui.enabled, false);
  for (const name of [...only, "hub", "logging", "eventarc", "tasks"]) assert.ok(emulators[name].port >= 20000, name);
  assert.ok(emulators.firestore.websocketPort >= 20000);
  const env = bootEnv(emulators, only, ports.at(-1));
  assert.equal(env.FIRESTORE_EMULATOR_HOST, `127.0.0.1:${emulators.firestore.port}`);
  assert.equal(new Set(Object.values(emulators).flatMap((e) => [e.port, e.websocketPort]).filter(Boolean)).size,
    Object.values(emulators).flatMap((e) => [e.port, e.websocketPort]).filter(Boolean).length, "no port used twice");
});


function inRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), "tbs-check-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const put = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  const oldReviewDir = process.env.TBS_REVIEW_DIR;
  process.env.TBS_REVIEW_DIR = join(root, "kept-reviews");
  try {
    git("init", "-q");
    put("src/x.ts", "const count = 1;\n");
    put(".claude/skills/routine/SKILL.md", "Review the change.\n");
    git("add", ".");
    git("-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", "commit", "-qm", "Initial work");
    fn({ root, git, put });
  } finally {
    if (oldReviewDir === undefined) delete process.env.TBS_REVIEW_DIR; else process.env.TBS_REVIEW_DIR = oldReviewDir;
    rmSync(root, { recursive: true, force: true });
  }
}
const suite = { name: "routine", base: "HEAD", skills: [".claude/skills/routine"], reviewPrompt: "/routine {branch}" };
const seed = "diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-const count = 1;\n+const count = 2;\n";
const caseValue = { id: "count", expect: "gate", rule: "count stays one", mustName: ["count"], file: "src/x.ts", gate: "printf 'src/x.ts incorrect\\n'; exit 1" };
function putCase(put, patch = seed, value = caseValue) {
  put("evals/routine/cases/count/case.json", JSON.stringify(value));
  put("evals/routine/cases/count/seed.patch", patch);
}

test("required PR comments must each match and name this head in the same comment", () => {
  const requiredComments = [{ name: "Codex local", pattern: "^## Codex review \\(local\\)" }, { name: "routine", pattern: "^## Acme Flutter review \\(routine\\)" }];
  const cfg = { ...config, selfMerge: { ...lane, requiredComments } };
  const comments = [{ body: `## Codex review (local) · head ${HEAD}` }, { body: `## Acme Flutter review (routine) · head ${HEAD.slice(0, 7)}` }];
  const input = { info: { ...info, comments }, files: [{ path: "docs/a.md", status: "added" }], config: cfg,
    gateLogs: [{ name: "g", text: gateLog() }], reviewLog: { name: "r", text: reviewLog() } };
  assert.deepEqual(decide(input), []);
  const check = (rows) => decide({ ...input, info: { ...info, comments: rows } });
  for (const body of ["", `## Codex review (local) · head ${OTHER}`, "## Codex review (local)",
    `## Codex review (local) · head ${HEAD.slice(0, 6)}`, `prefix ## Codex review (local) · head ${HEAD}`,
    `## Codex review (local) · head ${HEAD}b`]) {
    assert.ok(check([{ body }, comments[1], { body: HEAD }]).some((reason) => reason.includes("Codex local")), body);
  }
  assert.ok(check([comments[0]]).some((reason) => reason.includes("routine")));
  assert.ok(check([comments[1]]).some((reason) => reason.includes("Codex local")));
  const ghRun = (args) => {
    if (args[1] === "view") { assert.ok(args.at(-1).split(",").includes("comments")); return JSON.stringify({ ...info, comments }); }
    if (args[0] === "api") return JSON.stringify([[{ filename: "docs/a.md", status: "added" }]]);
    throw new Error("dry-run must not write");
  };
  assert.equal(run(["7", "--gate", "g", "--review", "r", "--dry-run"], { config: cfg, ghRun, read: (path) => path === "r" ? reviewLog() : path === "x" ? "clean" : gateLog(), log: () => {} }), 0);
});

test("the lane permits new eval files and refuses changes to existing ones", () => {
  for (const path of ["evals/routine/cases/a/case.json", "evals/routine/cases/a/seed.patch", "evals/routine/result.json"]) {
    assert.equal(eligibility([{ path, status: "added" }], lane).eligible, true);
    for (const status of ["modified", "removed", "renamed", "M", "D"]) {
      assert.ok(eligibility([{ path, status }], lane).reasons.some((reason) => reason.includes("changing an existing eval case loosens a gate")), `${path} ${status}`);
    }
  }
});

test("empty eval suites fail dry-run, a run and --check with the seed hint", () => inRepo(({ root }) => {
  for (const argv of [["routine", "--dry-run"], ["routine"], ["--check"]]) {
    const output = [];
    assert.equal(evalMain(argv, { root, config: { level: 4, evals: { suites: [suite] } }, log: (line) => output.push(line) }), 1);
    assert.ok(output.some((line) => line.includes("no cases in evals/routine/cases: add 3–8 seeds from real failures")));
  }
}));

test("dry-run checks every seed on the configured base and reports stale cases", () => inRepo(({ root, put }) => {
  putCase(put);
  // A dirty checkout must not affect the base used by --dry-run.
  put("src/x.ts", "uncommitted work\n");
  const output = [];
  const options = { root, config: { level: 4, evals: { suites: [suite] } }, log: (line) => output.push(line) };
  assert.equal(evalMain(["routine", "--dry-run"], options), 0);
  assert.ok(output.some((line) => line.includes("codex default")));
  putCase(put, seed.replace("-const count = 1;", "-const count = 9;"));
  assert.equal(evalMain(["routine", "--dry-run"], options), 1);
  assert.ok(output.some((line) => line.includes("STALE count")));
}));

test("blinding checks added whole words, branch and message without scanning context", () => {
  const value = { ...caseValue, id: "x" };
  for (const word of ["eval", "seed", "test", "judge", "rubric", "score", "candidate", "benchmark", "planted", "fixture"]) {
    for (const changed of ["patch", "branch", "message"]) {
      const item = { ...value, ...(changed === "patch" ? {} : { [changed]: `Update ${word.toUpperCase()}` }) };
      assert.throws(() => validateCase(item, "x", changed === "patch" ? `${seed}+// ${word.toUpperCase()}\n` : seed), /must not reveal/, `${changed}: ${word}`);
    }
  }
  assert.doesNotThrow(() => validateCase(value, "x", seed.replace("@@ -1 +1 @@", "@@ -1 +1 @@\n // test judge fixture").replace("+const count = 2;", "+const testCount = existing_test;")));
});

test("all repeats must pass and old records count as one repeat", () => {
  const cases = [{ id: "count" }];
  const record = { skillHash: "h", settingsHash: "s", casesHash: casesHash(cases), cases: [{ id: "count", pass: true }] };
  assert.deepEqual(recordProblems(record, { hash: "h", settingsHash: "s", cases }), []);
  assert.ok(recordProblems(record, { hash: "h", settingsHash: "s", cases, repeats: 2 }).some((p) => p.includes("repeat")));
  const partial = { ...record, cases: [{ id: "count", pass: true, passes: 1, repeats: 2 }] };
  assert.ok(recordProblems(partial, { hash: "h", settingsHash: "s", cases, repeats: 2 }).length);
});

test("suite stops a gate case at its first failed repeat and records passes/repeats", () => inRepo(({ root, put }) => {
  putCase(put);
  let gates = 0;
  const runner = (command, args, options) => {
    if (command === "sh") {
      assert.equal(readFileSync(join(options.cwd, "src/x.ts"), "utf8"), "const count = 2;\n");
      assert.equal(realpathSync(execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: options.cwd, encoding: "utf8" }).trim()), realpathSync(join(root, ".git")));
      return { status: ++gates === 2 ? 0 : 1, stdout: "src/x.ts", stderr: "" };
    }
    return spawnSync(command, command === "git" ? ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args] : args, { encoding: "utf8", ...options });
  };
  assert.equal(evalMain(["routine"], { root, config: { level: 4, evals: { suites: [{ ...suite, repeats: 3 }] } }, run: runner, log: () => {} }), 1);
  const result = JSON.parse(readFileSync(join(root, "evals/routine/result.json"), "utf8")).cases[0];
  assert.equal(gates, 2);
  assert.equal(result.passes, 1);
  assert.equal(result.repeats, 3);
  assert.equal(result.pass, false);
  assert.equal(result.evidence.length, 2);
}));

for (const caught of [false, true]) {
  test(`suite ${caught ? "runs every passing repeat" : "stops after the first failed review"}`, () => inRepo(({ root, put }) => {
    putCase(put, seed, { ...caseValue, expect: "review" });
    const repeats = 3;
    const exit = caught ? 0 : 1;
    const expectedRuns = caught ? repeats : 1;
    const evidence = "src/x.ts has incorrect count";
    let reviews = 0;
    let judgments = 0;
    const run = (command, args, options) => {
      if (command === "claude") {
        reviews++;
        return { status: 0, stdout: JSON.stringify({ result: evidence }) };
      }
      if (command === "codex") {
        judgments++;
        writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ caught, evidence }));
        return { status: 0 };
      }
      return spawnSync(command, ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args], { encoding: "utf8", ...options });
    };
    const options = { root, config: { level: 4, evals: { suites: [{ ...suite, repeats }] } }, run, log: () => {} };
    assert.equal(evalMain(["routine"], options), exit);
    assert.equal(reviews, expectedRuns);
    assert.equal(judgments, expectedRuns);
    const [result] = JSON.parse(readFileSync(join(root, "evals/routine/result.json"), "utf8")).cases;
    assert.equal(result.repeats, repeats);
    assert.equal(result.passes, caught ? repeats : 0);
    assert.equal(result.pass, caught);
    assert.equal(result.evidence.length, expectedRuns);
    assert.equal(evalMain(["--check", "--fresh"], options), exit);
    reviews = 0;
    judgments = 0;
    assert.equal(evalMain(["routine", "--case", "count"], options), exit);
    assert.equal(reviews, expectedRuns);
    assert.equal(judgments, expectedRuns);
  }));
}

test("judge model is optional and the environment overrides suite settings", () => inRepo(({ root, put }) => {
  putCase(put, seed, { ...caseValue, expect: "review" });
  const old = process.env.TBS_JUDGE_MODEL;
  try {
    for (const [configured, env, expected] of [[undefined, undefined, undefined], ["suite-model", undefined, "suite-model"], ["suite-model", "env-model", "env-model"]]) {
      if (env === undefined) delete process.env.TBS_JUDGE_MODEL; else process.env.TBS_JUDGE_MODEL = env;
      let judgedOnce = false;
      const runner = (command, args, options) => {
        if (command === "claude") return { status: 0, stdout: JSON.stringify({ result: "src/x.ts has incorrect count" }) };
        if (command === "codex") {
          judgedOnce = true;
          const index = args.indexOf("--model");
          assert.equal(index < 0 ? undefined : args[index + 1], expected);
          writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ caught: true, evidence: "src/x.ts has incorrect count" }));
          return { status: 0 };
        }
        return spawnSync(command, ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args], { encoding: "utf8", ...options });
      };
      assert.equal(evalMain(["routine"], { root, config: { level: 4, evals: { suites: [{ ...suite, judgeModel: configured }] } }, run: runner, log: () => {} }), 0);
      assert.ok(judgedOnce);
      const output = [];
      assert.equal(evalMain(["routine", "--dry-run"], { root, config: { level: 4, evals: { suites: [{ ...suite, judgeModel: configured }] } }, log: (line) => output.push(line) }), 0);
      assert.ok(output.some((line) => line.includes(expected ?? "codex default")));
    }
  } finally { if (old === undefined) delete process.env.TBS_JUDGE_MODEL; else process.env.TBS_JUDGE_MODEL = old; }
}));

test("feature discovery refuses an empty or missing source with the fix hint", () => inRepo(({ root, put }) => {
  const hint = /no screens found: fix featureMap.sources in \.claude\/trust-before-scale.json/;
  for (const dir of ["src", "missing"]) {
    const config = { level: 4, featureMap: { sources: [{ dir, ext: ".tsx", item: "path: '([^']+)'" }] } };
    for (const argv of [["--list"], ["--init"]]) assert.throws(() => mapMain(argv, { root, config, log: () => {} }), hint);
  }
  put("src/routes.tsx", "path: '/home'");
  const config = { level: 4, featureMap: { sources: [{ dir: "src", ext: ".tsx", item: "path: '([^']+)'" }] } };
  assert.equal(mapMain(["--list"], { root, config, log: () => {} }), 0);
  mkdirSync(join(root, "docs"));
  assert.equal(mapMain(["--init"], { root, config, log: () => {} }), 0);
  const map = JSON.parse(readFileSync(join(root, "docs/feature-map.json"), "utf8"));
  assert.ok(!JSON.stringify(map).includes("verify"));
  assert.ok(!JSON.stringify(map).includes("preconditions"));
}));

test("feature verification journeys must exist and preconditions are strings", () => inRepo(({ root, put }) => {
  const found = new Map([["a", "src/x.ts"]]);
  const screen = { id: "a", title: "A", roles: ["user"], landed: "Welcome", acts: [], verify: "features/sign-in.md", preconditions: ["auth", "data", "role", "flags"] };
  assert.ok(problems({ screens: [screen] }, found, root).some((p) => p.includes("features/sign-in.md")));
  put("features/sign-in.md", "Sign in and verify the welcome screen.");
  assert.deepEqual(problems({ screens: [screen] }, found, root), []);
  assert.ok(problems({ screens: [{ ...screen, preconditions: [1] }] }, found, root).some((p) => p.includes("preconditions")));
  assert.ok(problems({ screens: [{ ...screen, verify: "../outside.md" }] }, found, root).some((p) => p.includes("verify")));
}));

test("--owed prints skips since the oldest owed PR, or all when none are owed", () => inRepo(({ root, git, put }) => {
  const gitDir = git("rev-parse", "--git-dir").trim();
  put(`${gitDir}/tbs-skips.log`, "2026-01-01T00:00:00Z\told reason\told command\n2026-02-02T00:00:00Z\tnew reason\tnew command\n");
  const output = [];
  const rows = [{ number: 7, title: "Docs", merge_commit_sha: HEAD, labels: ["self-merged"], merged_at: "2026-02-01T00:00:00Z" }, { number: 8, title: "Earlier", labels: ["self-merged"], merged_at: "2026-01-15T00:00:00Z" }];
  const ghRun = owedGh(() => rows);
  assert.equal(run(["--owed"], { root, config, ghRun, log: (line) => output.push(line) }), 0);
  assert.ok(output.includes(`#7\tDocs\t${HEAD}`));
  assert.ok(output.some((line) => line.includes("new reason")));
  assert.ok(!output.some((line) => line.includes("old reason")));
  rows.length = 0; output.length = 0;
  assert.equal(run(["--owed"], { root, config, ghRun, log: (line) => output.push(line) }), 0);
  assert.ok(output.some((line) => line.includes("old reason")));
}));

test("repeat configuration cannot skip all runs or silently truncate them", () => inRepo(({ root, put }) => {
  putCase(put);
  for (const repeats of [0, -1, 1.5, "2"]) {
    for (const argv of [["routine", "--dry-run"], ["routine"], ["--check"]]) {
      assert.throws(() => evalMain(argv, { root, config: { level: 4, evals: { suites: [{ ...suite, repeats }] } }, log: () => {} }), /repeats must be a positive integer/);
    }
  }
}));

for (const [name, heading] of [["old head", `## Codex review (local) · head ${OTHER}`], ["no head", "## Codex review (local)"]]) {
  test(`required comment refuses a heading with ${name} even when the body names this head`, () => {
    const input = { info: { ...info, comments: [{ body: `${heading}\nUpdated code at ${HEAD}` }] },
      files: [{ path: "docs/a.md", status: "added" }],
      config: { ...config, selfMerge: { ...lane, requiredComments: [{ name: "Codex local", pattern: "^## Codex review" }] } },
      gateLogs: [{ name: "g", text: gateLog() }], reviewLog: { name: "r", text: reviewLog() } };
    assert.ok(decide(input).some((reason) => reason.includes("missing required PR comment")));
    assert.deepEqual(decide({ ...input, info: { ...info, comments: [{ body: `Intro\n## Codex review (local) · head ${HEAD.slice(0, 7)}\nPreviously ${OTHER}` }] } }), []);
  });
}

for (const change of ["judge environment", "reviewPrompt", "missing settingsHash"]) {
  test(`eval record goes stale after ${change}`, () => inRepo(({ root, put }) => {
    putCase(put);
    const old = process.env.TBS_JUDGE_MODEL;
    try {
      delete process.env.TBS_JUDGE_MODEL;
      const configured = { ...suite, judgeModel: "suite-judge" };
      const output = [];
      const options = { root, config: { level: 4, evals: { suites: [configured] } }, log: (line) => output.push(line),
        run: (command, args, opts) => spawnSync(command, command === "git" ? ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args] : args, { encoding: "utf8", ...opts }) };
      assert.equal(evalMain(["routine"], options), 0);
      assert.equal(evalMain(["--check"], options), 0);
      const path = join(root, "evals/routine/result.json");
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (change === "judge environment") process.env.TBS_JUDGE_MODEL = "env-judge";
      else if (change === "reviewPrompt") configured.reviewPrompt = "/different {branch}";
      else { delete record.settingsHash; writeFileSync(path, JSON.stringify(record)); }
      output.length = 0;
      assert.equal(evalMain(["--check"], options), 1);
      const message = change === "missing settingsHash" ? "the record has no evaluation settings: run it again" : "the evaluation settings changed since the last eval: run it again";
      assert.ok(output.some((line) => line.includes(message)));
      assert.ok(recordProblems(record, { hash: record.skillHash, cases: [{ ...caseValue, patch: seed }], settingsHash: settingsHash(configured) }).includes(message));
      if (change !== "missing settingsHash") assert.match(record.settingsHash, /^[0-9a-f]{64}$/);
    } finally { if (old === undefined) delete process.env.TBS_JUDGE_MODEL; else process.env.TBS_JUDGE_MODEL = old; }
  }));
}

test("review repos hide answer keys in files and all history, preserve the seed and fetch, and leave no project refs", () => inRepo(({ root, git, put }) => {
  putCase(put, seed, { ...caseValue, expect: "review" });
  const hidden = ["evals", "scripts/tbs", ".claude/trust-before-scale.json", "docs/trust-before-scale", "private-key"];
  for (const path of hidden.slice(1)) put(path.includes(".json") ? path : `${path}/answer.txt`, "secret\n");
  git("add", ".");
  git("-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", "commit", "-qm", "Project setup");
  const beforeBranches = git("branch", "--list");
  const beforeTrees = git("worktree", "list");
  let reviews = 0;
  const runner = (command, args, options) => {
    if (command === "claude") {
      reviews++;
      const local = (...args) => spawnSync("git", args, { cwd: options.cwd, encoding: "utf8" });
      const objects = local("rev-list", "--objects", "--all").stdout;
      for (const path of hidden) {
        assert.ok(!objects.split("\n").some((line) => line.endsWith(` ${path}`) || line.includes(` ${path}/`)), path);
        assert.equal(existsSync(join(options.cwd, path)), false);
      }
      assert.notEqual(local("show", "origin/develop:evals").status, 0);
      assert.notEqual(local("show", "origin/main:private-key").status, 0);
      assert.equal(local("diff", "origin/develop...HEAD", "--name-only").stdout, "src/x.ts\n");
      assert.equal(local("fetch", "origin").status, 0);
      return { status: 0, stdout: JSON.stringify({ result: "x.ts and y.ts incorrect count" }) };
    }
    if (command === "codex") {
      assert.ok(!options.cwd.endsWith("/tree"));
      writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ caught: true, evidence: "x.ts and y.ts incorrect count" }));
      return { status: 0 };
    }
    return spawnSync(command, ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args], { encoding: "utf8", ...options });
  };
  const configured = { ...suite, hidePaths: ["private-key"] };
  assert.equal(evalMain(["routine"], { root, config: { level: 4, evals: { suites: [configured] } }, run: runner, log: () => {} }), 0);
  assert.equal(reviews, 2);
  assert.equal(git("branch", "--list"), beforeBranches);
  assert.equal(git("worktree", "list"), beforeTrees);
  const output = [];
  const leakingRunner = (command, args, options) => command === "git" && args[0] === "rev-list"
    ? { status: 0, stdout: `${HEAD} evals/answer.txt\n` } : runner(command, args, options);
  assert.equal(evalMain(["routine"], { root, config: { level: 4, evals: { suites: [configured] } }, run: leakingRunner, log: (line) => output.push(line) }), 1);
  assert.ok(output.some((line) => line.includes("blindness check failed")));
  assert.equal(reviews, 2);
}));

test("hidden paths validate overlaps, patch targets and effective branch names; old settings become stale", () => inRepo(({ root, put }) => {
  putCase(put);
  for (const extra of [{ linkDirs: ["evals"] }, { skills: ["scripts/tbs/review"] }, { hidePaths: [".claude"] }, { hidePaths: ["../secret"] }, { hidePaths: ["/secret"] }]) {
    assert.throws(() => evalMain(["routine", "--dry-run"], { root, config: { level: 4, evals: { suites: [{ ...suite, ...extra }] } } }), /hidden path|invalid/);
  }
  assert.throws(() => validateCase({ ...caseValue, id: "fixture-photo" }, "fixture-photo", seed), /must not reveal/);
  assert.throws(() => validateCase({ ...caseValue, expect: "review", file: "evals/x.ts" }, "count", seed.replaceAll("src/x.ts", "evals/x.ts")), /hidden path/);
  assert.notEqual(settingsHash(suite), settingsHash({ ...suite, hidePaths: ["private-key"] }));
  const legacy = { reviewPrompt: suite.reviewPrompt, reviewModel: null, judgeModel: process.env.TBS_JUDGE_MODEL || null, repeats: 1, base: "HEAD", linkDirs: [] };
  // This is exactly the settings shape recorded by 1.1.1, before hidePaths existed.
  const oldHash = createHash("sha256").update(JSON.stringify(legacy)).digest("hex");
  assert.ok(recordProblems({ settingsHash: oldHash, skillHash: "h", casesHash: casesHash([]), cases: [] }, { hash: "h", cases: [], settingsHash: settingsHash(suite) }).some((p) => p.includes("settings changed")));
}));

test("review snapshot works when the checkout's hidden files differ from the suite base", () => inRepo(({ root, git, put }) => {
  const commit = (message) => git("-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", "commit", "-qm", message);
  putCase(put, seed, { ...caseValue, expect: "review" });
  put("scripts/tbs/VERSION", "1.1.1\n");
  git("add", "."); commit("Base with old kit");
  const base = git("rev-parse", "HEAD").trim();
  // Updating the kit itself is the usual case: HEAD and the working tree hold a newer hidden file than the base.
  put("scripts/tbs/VERSION", "1.1.2\n");
  git("add", "."); commit("Update kit");
  let reviews = 0;
  const runner = (command, args, options) => {
    if (command === "claude") { reviews++; return { status: 0, stdout: JSON.stringify({ result: "x.ts and y.ts incorrect count" }) }; }
    if (command === "codex") { writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ caught: true, evidence: "x.ts and y.ts incorrect count" })); return { status: 0 }; }
    return spawnSync(command, ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args], { encoding: "utf8", ...options });
  };
  const output = [];
  assert.equal(evalMain(["routine"], { root, config: { level: 4, evals: { suites: [{ ...suite, base }] } }, run: runner, log: (line) => output.push(line) }), 0, output.join("\n"));
  assert.equal(reviews, 2);
}));

test("a failed review case keeps the full review text and points to it", () => inRepo(({ root, put }) => {
  putCase(put, seed, { ...caseValue, expect: "review" });
  const dir = mkdtempSync(join(tmpdir(), "tbs-reviews-"));
  const old = process.env.TBS_REVIEW_DIR;
  process.env.TBS_REVIEW_DIR = dir;
  try {
    const runner = (command, args, options) => {
      if (command === "claude") return { status: 0, stdout: JSON.stringify({ result: "Line one of the review.\nThe zero should be an em dash." }) };
      if (command === "codex") { writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ caught: false, evidence: "Line one of the review." })); return { status: 0 }; }
      return spawnSync(command, ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args], { encoding: "utf8", ...options });
    };
    const output = [];
    assert.equal(evalMain(["routine"], { root, config: { level: 4, evals: { suites: [suite] } }, run: runner, log: (line) => output.push(line) }), 1);
    const evidence = JSON.parse(output.find((line) => line.startsWith("{"))).evidence;
    assert.equal(evidence.length, 1);
    for (const entry of evidence) {
      const storedPath = entry.match(/\(full review: (.+)\)$/)[1];
      assert.equal(isAbsolute(storedPath), false);
      const kept = resolve(root, storedPath);
      const text = readFileSync(kept, "utf8");
      assert.ok(text.includes("The zero should be an em dash."));
      assert.ok(text.includes('"caught":false'));
      assert.ok(kept.startsWith(dir));
    }
  } finally {
    if (old === undefined) delete process.env.TBS_REVIEW_DIR; else process.env.TBS_REVIEW_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
}));

test("the judged review is every top-level assistant message, not only the final addendum", () => {
  const event = (value) => JSON.stringify(value);
  const stream = [
    event({ type: "system", subtype: "init" }),
    event({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Critical: the query has no limit at missingPapersFirestore.ts:33." }] } }),
    event({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", name: "Bash" }] } }),
    event({ type: "assistant", parent_tool_use_id: "toolu_1", message: { content: [{ type: "text", text: "subagent chatter" }] } }),
    event({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "This replaces the note in Pass 1." }] } }),
    event({ type: "result", result: "This replaces the note in Pass 1." }),
  ].join("\n");
  const review = reviewText(stream);
  assert.ok(review.includes("no limit at missingPapersFirestore.ts:33"));
  assert.ok(review.includes("This replaces the note in Pass 1."));
  assert.ok(!review.includes("subagent chatter"));
  assert.equal(reviewText(JSON.stringify({ result: "single envelope" })), "single envelope");
  assert.equal(reviewText(""), "");
});


function reviewRunner(command, args, options) {
  if (command === "claude") return { status: 0, stdout: JSON.stringify({ result: "x.ts and y.ts incorrect count" }) };
  if (command === "codex") {
    writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ caught: true, evidence: "x.ts and y.ts incorrect count" }));
    return { status: 0 };
  }
  return spawnSync(command, args, { encoding: "utf8", ...options });
}
const reviewCase = { ...caseValue, expect: "review", patch: seed };
// Keep these tests independent of the machine's global identity and hooks.
function isolatedRunner(command, args, options) {
  const env = { ...process.env, ...options.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
    if (!options.env?.[key]) delete env[key];
  }
  return reviewRunner(command, command === "git" ? ["-c", "user.useConfigOnly=true", ...args] : args, { ...options, env });
}

test("review snapshot push bypasses a rejecting pre-push hook", () => inRepo(({ root, put }) => {
  put(".git/hooks/pre-push", "#!/bin/sh\nexit 1\n");
  chmodSync(join(root, ".git/hooks/pre-push"), 0o755);
  const runner = (command, args, options) => reviewRunner(command, command === "git"
    ? ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args] : args, options);
  const result = runCase(root, "HEAD", suite, reviewCase, runner);
  assert.equal(result.pass, true, result.evidence);
}));

test("review seed commit works with only repo-local identity", () => inRepo(({ root, git }) => {
  git("config", "user.name", "Project Author"); git("config", "user.email", "author@example.invalid");
  const result = runCase(root, "HEAD", suite, reviewCase, isolatedRunner);
  assert.equal(result.pass, true, result.evidence);
}));

test("review rename seed passes the leak self-check", () => inRepo(({ root, git, put }) => {
  git("config", "user.name", "Project Author"); git("config", "user.email", "author@example.invalid");
  put("src/x.ts", Array.from({ length: 20 }, (_, i) => `const n${i} = ${i};`).join("\n") + "\n");
  git("add", "."); git("commit", "-qm", "Expand module");
  git("mv", "src/x.ts", "src/y.ts");
  const patch = git("diff", "--cached");
  git("reset", "--hard", "HEAD");
  const result = runCase(root, "HEAD", suite, { ...reviewCase, file: "src/y.ts", patch }, isolatedRunner);
  assert.equal(result.pass, true, result.evidence);
}));

test("patch target parsing ignores header-like hunk content", () => inRepo(({ root, git, put }) => {
  git("config", "user.name", "Project Author"); git("config", "user.email", "author@example.invalid");
  put("src/x.ts", "-- a/evals/old\n"); git("add", "."); git("commit", "-qm", "Adjust module");
  const patch = seed.replace("-const count = 1;", "--- a/evals/old").replace("+const count = 2;", "+++ b/private/new");
  const item = { ...reviewCase, patch };
  assert.doesNotThrow(() => validateCase(item, item.id, patch, ["evals", "private"]));
  const result = runCase(root, "HEAD", suite, item, isolatedRunner);
  assert.equal(result.pass, true, result.evidence);
}));

test("trailing slash hidden paths reject targets and suite overlaps", () => {
  const patch = seed.replaceAll("src/x.ts", "private/x.ts");
  assert.throws(() => validateCase({ ...reviewCase, file: "private/x.ts" }, "count", patch, ["private/"]), /hidden path/);
  for (const extra of [{ skills: ["private/skill"] }, { linkDirs: ["private/cache/"] }]) {
    assert.throws(() => hiddenPaths({ ...suite, ...extra, hidePaths: ["private/"] }), /overlaps/);
  }
});

test("failed gate worktree add removes the branch it created", () => inRepo(({ root, git }) => {
  const before = git("branch", "--list");
  const runner = (command, args, options) => {
    if (command === "git" && args[0] === "worktree" && args[1] === "add") {
      git("branch", args[4], "HEAD");
      return { status: 1, stderr: "simulated worktree failure" };
    }
    return reviewRunner(command, args, options);
  };
  const result = runCase(root, "HEAD", suite, { ...caseValue, patch: seed }, runner);
  assert.equal(result.pass, false);
  assert.match(result.evidence, /worktree add failed/);
  assert.equal(git("branch", "--list"), before);
}));

test("effective default commit message is blind-checked", () => {
  const patch = seed.replaceAll("src/x.ts", "src/test.ts");
  assert.throws(() => validateCase({ ...reviewCase, file: "src/test.ts" }, "count", patch), /must not reveal/);
  assert.doesNotThrow(() => validateCase({ ...reviewCase, file: "src/test.ts", message: "Update module" }, "count", patch));
});


test("review links use one isolated run copy and remove it afterwards", () => inRepo(({ root, put }) => {
  putCase(put, seed, { ...caseValue, expect: "review" });
  put("node_modules/pkg/index.js", "module.exports = 1;\n");
  const targets = [];
  const runner = (command, args, options) => {
    if (command === "claude") {
      const target = realpathSync(join(options.cwd, "node_modules"));
      targets.push(target);
      for (let parent = target; ; parent = dirname(parent)) {
        assert.notEqual(parent, realpathSync(root));
        assert.equal(existsSync(join(parent, "evals/routine/cases/count/case.json")), false);
        if (dirname(parent) === parent) break;
      }
      assert.equal(readFileSync(join(target, "pkg/index.js"), "utf8"), "module.exports = 1;\n");
    }
    return reviewRunner(command, args, options);
  };
  assert.equal(evalMain(["routine"], { root, config: { level: 4, evals: { suites: [{ ...suite, linkDirs: ["node_modules"], repeats: 2 }] } }, run: runner, log: () => {} }), 0);
  assert.equal(targets.length, 2);
  assert.equal(targets[0], targets[1]);
  assert.equal(existsSync(targets[0]), false);
}));

test("kept reviews default to the project git common directory", () => inRepo(({ root, git }) => {
  delete process.env.TBS_REVIEW_DIR;
  const result = runCase(root, "HEAD", suite, reviewCase, (command, args, options) => {
    if (command === "codex") {
      writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ caught: false, evidence: "x.ts and y.ts incorrect count" }));
      return { status: 0 };
    }
    return reviewRunner(command, args, options);
  });
  const storedPath = result.evidence.match(/\(full review: (.+)\)$/)[1];
  assert.equal(isAbsolute(storedPath), false);
  const kept = resolve(root, storedPath);
  try {
    assert.equal(dirname(kept), resolve(root, git("rev-parse", "--git-common-dir").trim(), "tbs-reviews"));
    assert.ok(existsSync(kept));
  } finally { rmSync(kept, { force: true }); }
}));

test("vendored tests contain no conditional installer skip", () => {
  assert.doesNotMatch(readFileSync(fileURLToPath(import.meta.url), "utf8"), /\{\s*skip\s*:\s*!/);
});

test("plain multi-file patches retain later targets and ignore header-like hunk content", () => {
  const patch = "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n--- a/x\n+++ b/x\n--- a/src/y.ts\n+++ b/src/y.ts\n@@ -0,0 +1 @@\n+const value = 2;\n";
  assert.doesNotThrow(() => validateCase({ ...reviewCase, file: "src/y.ts" }, "count", patch));
  assert.throws(() => validateCase({ ...reviewCase, file: "x" }, "count", patch), /does not touch x/);
});

function laneFixture({ root, put }) {
  putCase(put);
  const cfg = { ...config, autopilot: { maxLanes: 4 }, evals: { suites: [suite] },
    featureMap: { file: "docs/feature-map.json", sources: [{ dir: "src", ext: ".ts", item: "const (\\w+)", id: "{item}" }] } };
  put("docs/feature-map.json", JSON.stringify({ notMappedYet: [{ id: "count", reason: "pending" }] }));
  const record = { evidenceRule: 3, date: new Date().toISOString(), skillHash: skillHash(root, suite),
    settingsHash: settingsHash(suite, true), casesHash: casesHash(loadCases(root, suite.name)),
    cases: [{ id: "count", pass: true, passes: 2, repeats: 2 }] };
  put("evals/routine/result.json", JSON.stringify(record));
  return { cfg, record, options: { root, config: cfg, ghRun: owedGh(() => []) } };
}

test("owed search trims the repo name from raw gh output", () => inRepo((repo) => {
  const { options } = laneFixture(repo);
  const queries = [];
  const ghRun = (args) => {
    if (args[0] === "repo" && args[1] === "view") return "acme/project\n";
    const query = args.find((arg) => arg.startsWith("q="));
    queries.push(query);
    if (query.includes("\n")) throw new Error("gh: Validation Failed (HTTP 422)");
    return options.ghRun(args);
  };
  const output = [];
  const result = run(["--owed"], { ...options, ghRun, log: (line) => output.push(line) });
  const { reasons } = laneAllowance({ ...options, ghRun });
  assert.equal(queries.length, 2);
  for (const query of queries) assert.doesNotMatch(query, /\n/);
  assert.equal(result, 0);
  assert.ok(output.includes("nothing owed"));
  assert.doesNotMatch(reasons.join("\n"), /could not check owed/);
}));

test("skip acknowledgement hides older skips and restores the lane ceiling", () => inRepo((repo) => {
  const { options } = laneFixture(repo);
  repo.put(".git/tbs-skips.log", "2020-01-01T00:00:00Z\told skip\tcommand\n");
  assert.equal(laneAllowance(options).allowed, 1);
  const before = Date.now();
  assert.equal(run(["--ack-skips"], { ...options, ghRun: () => { throw new Error("ack must work offline"); }, log: () => {} }), 0);
  const marker = readFileSync(join(repo.root, ".git/tbs-skips.reviewed"), "utf8").trim();
  assert.equal(new Date(marker).toISOString(), marker);
  assert.ok(Date.parse(marker) >= before && Date.parse(marker) <= Date.now());
  const output = [];
  run(["--owed"], { ...options, log: (line) => output.push(line) });
  assert.ok(!output.some((line) => line.startsWith("HOOK SKIP\t")));
  assert.deepEqual(laneAllowance(options), { allowed: 4, max: 4, reasons: [] });
}));

test("a skip after acknowledgement caps again and must also meet the oldest owed PR cutoff", () => inRepo((repo) => {
  const { options } = laneFixture(repo);
  run(["--ack-skips"], { ...options, log: () => {} });
  const ack = Date.parse(readFileSync(join(repo.root, ".git/tbs-skips.reviewed"), "utf8").trim());
  const stamp = (offset) => new Date(ack + offset).toISOString();
  repo.put(".git/tbs-skips.log", `${stamp(-1000)}\tbefore ack\tcommand\n${stamp(0)}\tat ack\tcommand\n${stamp(1000)}\tafter ack\tcommand\n${stamp(3000)}\tafter PR\tcommand\n`);
  const result = laneAllowance(options);
  assert.equal(result.allowed, 1);
  assert.match(result.reasons.join("\n"), /after ack/);
  assert.doesNotMatch(result.reasons.join("\n"), /before ack|at ack/);
  const output = [];
  run(["--owed"], { ...options, ghRun: owedGh(() => [{ number: 7, title: "Docs", merged_at: stamp(2000) }]), log: (line) => output.push(line) });
  const skips = output.filter((line) => line.startsWith("HOOK SKIP\t"));
  assert.equal(skips.length, 1);
  assert.match(skips[0], /after PR/);
}));

for (const marker of ["missing", "invalid"]) {
  test(`${marker === "invalid" ? "an" : "a"} ${marker} skip acknowledgement preserves existing behavior until acknowledged`, () => inRepo((repo) => {
    const { options } = laneFixture(repo);
    if (marker === "invalid") repo.put(".git/tbs-skips.reviewed", "not a timestamp\n");
    repo.put(".git/tbs-skips.log", "2020-01-01T00:00:00Z\told skip\tcommand\n2020-03-01T00:00:00Z\tnew skip\tcommand\n");
    const output = [];
    run(["--owed"], { ...options, log: (line) => output.push(line) });
    assert.equal(output.filter((line) => line.startsWith("HOOK SKIP\t")).length, 2);
    assert.equal(laneAllowance(options).allowed, 1);
    output.length = 0;
    run(["--owed"], { ...options, ghRun: owedGh(() => [{ number: 7, title: "Docs", merged_at: "2020-02-01T00:00:00Z" }]), log: (line) => output.push(line) });
    assert.equal(output.filter((line) => line.startsWith("HOOK SKIP\t")).length, 1);
    assert.match(output.join("\n"), /new skip/);
    run(["--ack-skips"], { ...options, log: () => {} });
    assert.equal(laneAllowance(options).allowed, 4);
  }));
}

test("lane gate: absent config allows one; all actual checks green allow the ceiling", () => inRepo((repo) => {
  const { cfg, options } = laneFixture(repo);
  assert.deepEqual(laneAllowance(options), { allowed: 4, max: 4, reasons: [] });
  const unconfigured = { ...cfg }; delete unconfigured.autopilot;
  const result = laneAllowance({ ...options, config: unconfigured });
  assert.equal(result.allowed, 1);
  assert.equal(result.max, 1);
  assert.match(result.reasons[0], /not configured/);
}));

for (const condition of ["stale", "red", "owed", "map", "skip", "two", "offline"]) {
  test(`lane gate fails closed: ${condition}`, () => inRepo((repo) => {
    const { options, record } = laneFixture(repo);
    const { put } = repo;
    if (condition === "stale") record.date = "2020-01-01T00:00:00Z";
    if (["red", "two"].includes(condition)) record.cases[0].pass = false;
    put("evals/routine/result.json", JSON.stringify(record));
    if (condition === "owed") options.ghRun = owedGh(() => [{ number: 42, title: "owed", merged_at: new Date().toISOString() }]);
    if (["map", "two"].includes(condition)) put("docs/feature-map.json", "{}");
    if (condition === "skip") put(".git/tbs-skips.log", `${new Date().toISOString()}\treason\tcommand\n`);
    if (condition === "offline") options.ghRun = () => { throw new Error("fake runner offline"); };
    const result = laneAllowance(options);
    assert.equal(result.allowed, 1);
    const expected = { stale: /older than 7 days/, red: /cases not caught/, owed: /owed a review/, map: /feature map check is red/, skip: /unreviewed hook skips/, two: /cases not caught/, offline: /could not check owed/ };
    assert.match(result.reasons.join("\n"), expected[condition]);
    assert.equal(result.reasons.length, condition === "two" ? 2 : 1);
    if (condition === "two") assert.match(result.reasons[1], /feature map check is red/);
  }));
}

test("lane gate retains other reasons when checks cannot run", () => inRepo((repo) => {
  const { options } = laneFixture(repo);
  repo.put(".git/tbs-skips.log", "2026-01-01T00:00:00Z\treason\tcommand\n");
  options.ghRun = () => { throw new Error("offline"); };
  options.evalCheck = () => { throw new Error("unreadable suite"); };
  options.mapCheck = () => { throw new Error("unreadable map"); };
  const result = laneAllowance(options);
  assert.equal(result.allowed, 1);
  assert.equal(result.reasons.length, 4);
  assert.match(result.reasons.join("\n"), /could not check eval/);
  assert.match(result.reasons.join("\n"), /could not check feature map/);
  assert.match(result.reasons.join("\n"), /unreviewed hook skips/);
}));

test("lane CLI require status and JSON shape", () => inRepo((repo) => {
  const { options } = laneFixture(repo);
  const lines = [];
  assert.equal(lanesMain(["--json", "--require", "3"], { ...options, log: (line) => lines.push(line) }), 0);
  assert.deepEqual(JSON.parse(lines.pop()), { allowed: 4, max: 4, reasons: [] });
  repo.put("docs/feature-map.json", "{}");
  assert.equal(lanesMain(["--require", "3"], { ...options, log: () => {} }), 1);
  assert.equal(lanesMain([], { ...options, log: () => {} }), 0);
  for (const args of [["--require"], ["--require", "0"], ["--require", "2.5"], ["--wat"]]) {
    assert.throws(() => lanesMain(args, options), /Usage/);
  }
}));

test("autopilot config rejects invalid ceilings and paths while older configs load", () => inRepo(({ root, put }) => {
  const save = (autopilot) => put(".claude/trust-before-scale.json", JSON.stringify({ autopilot }));
  for (const maxLanes of [0, -1, 2.5, "5"]) {
    save({ maxLanes });
    assert.throws(() => loadConfig(root), /maxLanes must be a positive integer/);
  }
  for (const key of ["handoff", "continuation", "extension"]) {
    for (const path of ["", "/tmp/outside", "../outside", "C:\\outside", 42]) {
      save({ maxLanes: 2, [key]: path });
      assert.throws(() => loadConfig(root), /repo-relative path/);
    }
  }
  save({ maxLanes: 2, checkIns: { timeZone: "Asia/Kuala_Lumpur", times: ["12:00", "18:00", "22:00"] } });
  assert.equal(loadConfig(root).autopilot.maxLanes, 2);
  save({ maxLanes: 2, checkIns: { timeZone: "invalid", times: ["12:00"] } });
  assert.throws(() => loadConfig(root), /valid time zone/);
  save({ maxLanes: 2, checkIns: { timeZone: "UTC", times: ["24:00"] } });
  assert.throws(() => loadConfig(root), /HH:MM/);
  put(".claude/trust-before-scale.json", "{}");
  assert.deepEqual(loadConfig(root), {});
}));


test("installed lane CLI returns real exit codes and JSON", () => inRepo((repo) => {
  const { root, put } = repo;
  const { cfg } = laneFixture(repo);
  // Install the scripts that sit beside this test, which exist in the kit and in every project.
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(join(root, "scripts/tbs"), { recursive: true });
  for (const name of readdirSync(here).filter((file) => file.endsWith(".mjs"))) copyFileSync(join(here, name), join(root, "scripts/tbs", name));
  copyFileSync(new URL(existsSync(new URL("./config.schema.json", import.meta.url)) ? "./config.schema.json" : "../../schema/config.schema.json", import.meta.url), join(root, "scripts/tbs/config.schema.json"));
  put(".claude/trust-before-scale.json", JSON.stringify(cfg));
  put("fake-bin/gh", "#!/bin/sh\nprintf '[]'\n");
  chmodSync(join(root, "fake-bin/gh"), 0o755);
  const cli = (...args) => spawnSync(process.execPath, [realpathSync(join(root, "scripts/tbs/lanes.mjs")), ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${join(root, "fake-bin")}:${process.env.PATH}` },
  });
  const green = cli("--json", "--require", "3");
  assert.equal(green.status, 0, green.stderr);
  assert.deepEqual(JSON.parse(green.stdout), { allowed: 4, max: 4, reasons: [] });
  put("docs/feature-map.json", "{}");
  const red = cli("--json", "--require", "3");
  assert.equal(red.status, 1, red.stderr);
  assert.equal(JSON.parse(red.stdout).allowed, 1);
  assert.equal(cli().status, 0);
}));

test("a project that has not adopted the kit feature map is not capped by it", () => inRepo((repo) => {
  const { cfg, options } = laneFixture(repo);
  const { featureMap, ...withoutMap } = cfg;
  assert.ok(featureMap);
  const result = laneAllowance({ ...options, config: withoutMap });
  assert.equal(result.allowed, 4, result.reasons.join("; "));
  assert.deepEqual(result.reasons, []);
  assert.ok(result.notes.some((note) => note.includes("feature map not configured")));
  // Adopted but red still caps.
  repo.put("docs/feature-map.json", "{}");
  assert.equal(laneAllowance(options).allowed, 1);
}));

function owedGh(getRows) {
  return args => {
    if (args[0] === "repo") return "acme/project";
    if (args.includes("search/issues")) {
      assert.deepEqual(args, ["api", "-X", "GET", "search/issues", "-f", 'q=repo:acme/project is:pr is:merged label:"self-merged" -label:"reviewed-after-merge"', "-f", "per_page=100", "--paginate", "--slurp"]);
      const rows = getRows();
      return JSON.stringify([{ total_count: rows.length, items: rows }]);
    }
    const row = getRows().find(row => args[1] === `repos/{owner}/{repo}/pulls/${row.number}`);
    assert.ok(row, `unexpected gh call: ${args}`);
    return JSON.stringify(row);
  };
}

for (const body of [`## Routine evidence\nHEAD=${HEAD}`, `Intro\n## /rOuTiNe evidence (head ${HEAD})`]) {
  test(`accepts current routine evidence from ${body.split("\n").find(line => line.startsWith("##"))}`, () => {
    const input = { files: [{ path: "docs/a.md", status: "added" }],
      config: { ...config, selfMerge: { ...lane, requiredComments: [{ name: "Routine evidence", pattern: "^## Routine evidence$" }] } },
      gateLogs: [{ name: "g", text: gateLog() }], reviewLog: { name: "r", text: reviewLog() } };
    const check = body => decide({ ...input, info: { ...info, comments: [{ body }] } });
    assert.deepEqual(check(body), []);
    assert.ok(check(body.replace(HEAD, OTHER)).some(reason => reason.includes("missing required PR comment")));
    // A 1.7.0-style short head in the heading still counts; a short stale one does not.
    if (body.includes("(head")) {
      assert.deepEqual(check(body.replace(HEAD, HEAD.slice(0, 7))), []);
      assert.ok(check(body.replace(HEAD, OTHER.slice(0, 7))).some(reason => reason.includes("missing required PR comment")));
    } else {
      assert.ok(check(body.replace(HEAD, HEAD.slice(0, 7))).some(reason => reason.includes("missing required PR comment")));
    }
  });
}

test("self-merge checks configured evals before it can write", () => inRepo(({ root, put }) => {
  putCase(put);
  const output = [];
  const options = { root, config: { ...config, evals: { suites: [suite] } },
    ghRun: args => {
      if (args[1] === "view") return JSON.stringify(info);
      if (args[0] === "api") return JSON.stringify([[{ filename: "docs/a.md", status: "added" }]]);
      assert.fail(`unexpected write: ${args}`);
    },
    read: path => path === "r" ? reviewLog() : path === "x" ? "clean" : gateLog(),
    log: line => output.push(line) };
  assert.equal(run(["7", "--gate", "g", "--review", "r", "--dry-run"], options), 1);
  assert.match(output.join("\n"), /no result\.json/);
}));

test("fresh eval checks detect script changes while old records still pass", () => inRepo(({ root, git, put }) => {
  const script = "scripts/gate.mjs";
  put(script, "console.log('src/x.ts incorrect'); process.exitCode = 1;\n");
  git("add", script);
  git("-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", "commit", "-qm", "Gate script");
  putCase(put, seed, { ...caseValue, gate: `node "${script}"` });
  const output = [];
  const options = { root, config: { level: 4, evals: { suites: [suite] } }, log: line => output.push(line),
    run: (command, args, opts) => spawnSync(command, command === "git" ? ["-c", "user.name=Kit Check", "-c", "user.email=kit@example.invalid", ...args] : args, { encoding: "utf8", ...opts }) };
  assert.equal(evalMain(["routine"], options), 0);
  assert.equal(evalMain(["--check", "--fresh"], options), 0);
  put(script, "process.exitCode = 0;\n");
  assert.equal(evalMain(["--check"], options), 0);
  assert.equal(evalMain(["--check", "--fresh"], options), 1);
  assert.match(output.join("\n"), /gate inputs changed/);
  const path = "evals/routine/result.json";
  const record = JSON.parse(readFileSync(join(root, path), "utf8"));
  delete record.gateFingerprint;
  put(path, JSON.stringify(record));
  assert.equal(evalMain(["--check", "--fresh"], options), 0);
  assert.match(output.join("\n"), /predates the gate fingerprint/);
}));

test("Next.js parallel pages share the same URL ID", () => inRepo(({ root, put }) => {
  const ids = () => [...discover(root, [{ dir: "app", preset: "nextjs-app" }]).keys()];
  put("app/@modal/photo/page.tsx", "");
  assert.deepEqual(ids(), ["/photo"]);
  put("app/photo/page.tsx", "");
  assert.deepEqual(ids(), ["/photo"]);
  rmSync(join(root, "app/@modal"), { recursive: true });
  assert.deepEqual(ids(), ["/photo"]);
}));
