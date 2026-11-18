import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const installer = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/tbs-init");
test("installer updates only shared files and preserves project-owned files", () => inRepo(({ root, put }) => {
  const init = (...args) => execFileSync(process.execPath, [installer, ...args], { cwd: root, encoding: "utf8" });
  init("generic");
  const version = JSON.parse(readFileSync(resolve(dirname(installer), "../.claude-plugin/plugin.json"), "utf8")).version;
  assert.equal(readFileSync(join(root, "scripts/tbs/VERSION"), "utf8").trim(), version);
  const owned = [".claude/trust-before-scale.json", "docs/trust-before-scale/enforcers.md", "docs/trust-before-scale/ADR-draft.md", "docs/trust-before-scale/NOTES.md", "docs/feature-map.json", "evals/routine/result.json"];
  for (const path of owned) put(path, `Project owns ${path}\n`);
  rmSync(join(root, "scripts/tbs/lanes.mjs"));
  put("scripts/tbs/VERSION", "1.0.0\n");
  put("scripts/tbs/config.mjs", "old script\n");
  put("docs/trust-before-scale/brief-template.md", "old template\n");
  const output = init("--update", "--force");
  assert.ok(output.includes(`1.0.0 → ${version}`));
  assert.match(output, /updated\s+scripts\/tbs\/config.mjs/);
  assert.equal(readFileSync(join(root, "scripts/tbs/lanes.mjs"), "utf8"), readFileSync(resolve(dirname(installer), "../templates/scripts/lanes.mjs"), "utf8"));
  assert.match(output, /unchanged\s+scripts\/tbs\/free-ports.mjs/);
  for (const path of owned) assert.equal(readFileSync(join(root, path), "utf8"), `Project owns ${path}\n`);
  assert.equal(readFileSync(join(root, "scripts/tbs/VERSION"), "utf8").trim(), version);
  assert.match(init("--update"), /unchanged\s+scripts\/tbs\/config.mjs/);
}));


import { loadCases } from "../templates/scripts/skill-eval.mjs";

const pluginRoot = resolve(dirname(installer), '..');
for (const mode of ['generic', 'acme-mobile', 'acme-flutter', 'private-flag', 'private-env']) {
  test(`fresh ${mode} install validates portable seeds and vendored tests`, () => inRepo(({ root }) => {
    const profileDir = join(pluginRoot, 'profiles', 'generic');
    const args = mode === 'private-flag' ? ['--profile-dir', profileDir] : mode === 'private-env' ? [] : [mode];
    execFileSync(process.execPath, [installer, ...args], {
      cwd: root, env: { ...process.env, TBS_PROFILE_DIR: mode === 'private-env' ? profileDir : '' },
    });
    execFileSync(process.execPath, ['--test', 'scripts/tbs/tbs.test.mjs'], { cwd: root });
    assert.equal(loadCases(root, 'routine').length, 3);
    const casesDir = join(root, 'evals/routine/cases');
    for (const id of readdirSync(casesDir)) {
      const dir = join(casesDir, id);
      execFileSync('git', ['apply', '--check', join(dir, 'seed.patch')], { cwd: root });
    }
  }));
}
test('installer rejects a missing private directory argument', () => inRepo(({ root }) => {
  assert.throws(() => execFileSync(process.execPath, [installer, '--profile-dir'], { cwd: root, stdio: 'pipe' }));
}));

test('CI install parses as YAML, preserves workflow on update and refreshes schema',()=>inRepo(({root})=>{
 const install=args=>execFileSync(process.execPath,[installer,...args],{cwd:root});
 install(['generic','--ci']);
 const file=join(root,'.github/workflows/trust-before-scale.yml');
 execFileSync('ruby',['-ryaml','-e','YAML.load_file(ARGV[0]);',file]);
 assert.ok(readFileSync(join(root,'scripts/tbs/config.schema.json'),'utf8').includes('level'));
 writeFileSync(file,'# custom\n'); install(['--update','--ci']); assert.equal(readFileSync(file,'utf8'),'# custom\n');
}));

test('installer targets the current checkout with inherited Git settings', () => inRepo(({ root }) => {
  inRepo(({ root: sentinel }) => {
    execFileSync(process.execPath, [installer, 'generic'], {
      cwd: root, env: { ...process.env, GIT_DIR: join(sentinel, '.git'), GIT_WORK_TREE: sentinel },
    });
    assert.ok(existsSync(join(root, 'scripts/tbs/config.mjs')));
    assert.ok(!existsSync(join(sentinel, 'scripts/tbs/config.mjs')));
  });
}));
