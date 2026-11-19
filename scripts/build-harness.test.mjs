import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { plan } from '../plugins/trust-before-scale/templates/scripts/routine.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const plugin = 'plugins/trust-before-scale';
const vendor = 'scripts/tbs';
const brief = 'docs/trust-before-scale/brief-template.md';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'tbs-build-harness-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'scripts'));
  for (const path of [plugin, '.claude-plugin', 'GEMINI.md', 'scripts/build-harness.mjs']) {
    cpSync(join(root, path), join(cwd, path), { recursive: true });
  }
  const run = (...args) => spawnSync(process.execPath, ['scripts/build-harness.mjs', ...args], { cwd, encoding: 'utf8' });
  const build = run('--skip-agents-marketplace');
  assert.equal(build.status, 0, build.stderr);
  return { cwd, run };
}

test('a fresh build generates the vendored scripts and brief and passes --check', t => {
  const { cwd, run } = fixture(t);
  const scripts = readdirSync(join(root, plugin, 'templates/scripts'))
    .filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
  assert.deepEqual(readdirSync(join(cwd, vendor)).sort(), [...scripts, 'VERSION', 'config.schema.json'].sort());
  for (const [output, input] of [
    ...scripts.map(name => [`${vendor}/${name}`, `templates/scripts/${name}`]),
    [`${vendor}/config.schema.json`, 'schema/config.schema.json'],
    [brief, 'templates/docs/brief-template.md'],
  ]) {
    assert.deepEqual(readFileSync(join(cwd, output)), readFileSync(join(root, plugin, input)));
  }
  const { version } = JSON.parse(readFileSync(join(root, plugin, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(readFileSync(join(cwd, vendor, 'VERSION'), 'utf8'), `${version}\n`);
  const build = run();
  assert.equal(build.status, 0, build.stderr);
  const check = run('--check');
  assert.equal(check.status, 0, check.stderr);
});

for (const [description, path, contents] of [
  ['a changed brief template', brief, 'edited brief\n'],
  ['an extra vendored file', `${vendor}/extra.test.mjs`, 'extra file\n'],
  ['a stale VERSION', `${vendor}/VERSION`, '0.0.0\n'],
  ['a missing vendored script', `${vendor}/doctor.mjs`],
]) {
  test(`--check rejects ${description}`, t => {
    const { cwd, run } = fixture(t);
    const initialBuild = run();
    assert.equal(initialBuild.status, 0, initialBuild.stderr);
    mkdirSync(join(cwd, vendor), { recursive: true });
    mkdirSync(join(cwd, 'docs/trust-before-scale'), { recursive: true });
    if (contents === undefined) rmSync(join(cwd, path), { force: true });
    else writeFileSync(join(cwd, path), contents);
    const build = run('--skip-agents-marketplace', '--check');
    assert.equal(build.status, 1, build.stderr);
    assert.ok(build.stderr.split('\n').some(line => line.endsWith(`: ${path}`)), build.stderr);
  });
}

test('routine rows cover tracked files, vendored files and HANDOFF.md', t => {
  const configPath = join(root, '.agents/trust-before-scale.json');
  if (!existsSync(configPath)) return t.skip('missing .agents/trust-before-scale.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const { cwd } = fixture(t);
  const vendored = readdirSync(join(cwd, vendor)).map(name => `${vendor}/${name}`);
  const paths = new Set([...tracked, ...vendored, brief, 'scripts/build-harness.test.mjs', 'HANDOFF.md']);
  plan(config, [...paths].map(path => ({ path, status: 'M' })));
});
