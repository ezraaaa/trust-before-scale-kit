import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.deepEqual(readdirSync(join(cwd, vendor)).sort(), [...scripts, 'VERSION', 'config.schema.json', 'merge-gate.py'].sort());
  for (const [output, input] of [
    ...scripts.map(name => [`${vendor}/${name}`, `templates/scripts/${name}`]),
    [`${vendor}/config.schema.json`, 'schema/config.schema.json'],
    [`${vendor}/merge-gate.py`, 'hooks/merge-gate.py'],
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

test('a rebuild removes an extra vendored file and passes --check', t => {
  const { cwd, run } = fixture(t);
  const extra = join(cwd, vendor, 'removed-script.mjs');
  writeFileSync(extra, 'extra file\n');

  const build = run();
  assert.equal(build.status, 0, build.stderr);
  assert.equal(build.stdout, `removed: ${vendor}/removed-script.mjs\n`);
  const check = run('--check');
  assert.equal(check.status, 0, check.stderr);
  assert.equal(existsSync(extra), false);
});

for (const mode of ['check', 'build']) {
  const args = mode === 'check' ? ['--check'] : [];
  for (const path of [vendor, `${vendor}/VERSION`, brief]) {
    test(`${mode} rejects a symlink at ${path}`, t => {
      const { cwd, run } = fixture(t);
      const output = join(cwd, path);
      const target = join(cwd, 'link-target');
      assert.equal(run().status, 0);
      renameSync(output, target);
      symlinkSync(target, output, path === vendor ? 'dir' : 'file');
      const targetFile = path === vendor ? join(target, 'VERSION') : target;
      if (mode === 'build') writeFileSync(targetFile, 'keep this content\n');
      const original = readFileSync(targetFile);

      const result = run(...args);
      assert.deepEqual(readFileSync(targetFile), original);
      assert.equal(result.stderr, `symlink: ${path}\n`);
      assert.equal(result.status, 1);
    });
  }

  for (const path of ['docs', 'docs/trust-before-scale']) {
    test(`${mode} rejects a symlink at brief ancestor ${path}`, t => {
      const { cwd, run } = fixture(t);
      assert.equal(run().status, 0);
      const outside = mkdtempSync(join(tmpdir(), 'tbs-build-harness-outside-'));
      t.after(() => rmSync(outside, { recursive: true, force: true }));
      const output = join(cwd, path);
      const target = join(outside, 'target');
      renameSync(output, target);
      symlinkSync(target, output, 'dir');
      const targetFile = join(target, brief.slice(path.length + 1));
      if (mode === 'build') writeFileSync(targetFile, 'keep this content\n');
      const original = readFileSync(targetFile);

      const result = run(...args);
      const after = readFileSync(targetFile);
      assert.deepEqual(
        { status: result.status, stderr: result.stderr, outsideUnchanged: after.equals(original) },
        { status: 1, stderr: `symlink: ${path}\n`, outsideUnchanged: true },
      );
    });
  }

  test(`${mode} rejects a regular file at ${vendor}`, t => {
    const { cwd, run } = fixture(t);
    assert.equal(run().status, 0);
    rmSync(join(cwd, vendor), { recursive: true });
    writeFileSync(join(cwd, vendor), 'keep this content\n');

    const result = run(...args);
    assert.equal(result.stderr, `not a directory: ${vendor}\n`);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(join(cwd, vendor), 'utf8'), 'keep this content\n');
  });
}

for (const kind of ['directory', 'symlink']) {
  test(`a rebuild reports and preserves an extra vendored ${kind}`, t => {
    const { cwd, run } = fixture(t);
    const path = `${vendor}/extra`;
    const extra = join(cwd, path);
    if (kind === 'directory') mkdirSync(extra);
    else symlinkSync('missing-target', extra);

    const result = run();
    const entry = lstatSync(extra);
    assert.ok(kind === 'directory' ? entry.isDirectory() : entry.isSymbolicLink());
    assert.equal(result.stderr, `extra: ${path} (remove by hand)\n`);
    assert.equal(result.status, 1);
  });
}

test('routine rows cover tracked files, vendored files and HANDOFF.md', t => {
  const configPath = join(root, '.agents/trust-before-scale.json');
  assert.ok(existsSync(configPath), 'the kit config .agents/trust-before-scale.json is missing');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const { cwd } = fixture(t);
  const vendored = readdirSync(join(cwd, vendor)).map(name => `${vendor}/${name}`);
  const paths = new Set([...tracked, ...vendored, brief, 'scripts/build-harness.test.mjs', 'HANDOFF.md']);
  plan(config, [...paths].map(path => ({ path, status: 'M' })));
});
