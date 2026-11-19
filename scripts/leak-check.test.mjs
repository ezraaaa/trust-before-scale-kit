import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./leak-check.mjs', import.meta.url));
const run = (cwd, ...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-check-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return temp;
}

function repo(t, treeName = 'tree') {
  const temp = fixture(t);
  const main = path.join(temp, 'main');
  const tree = path.join(temp, treeName);
  git(temp, 'init', '-q', main);
  fs.writeFileSync(path.join(main, 'tracked.txt'), 'Acme\n');
  git(main, 'add', 'tracked.txt');
  git(main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  git(main, 'worktree', 'add', '--detach', tree);
  return { main, tree };
}

test('uses the main checkout patterns to scan the linked worktree', t => {
  const { main, tree } = repo(t);
  fs.writeFileSync(path.join(main, '.leakcheck.local'), 'Acme\n');
  fs.writeFileSync(path.join(main, 'tracked.txt'), 'clean\n');
  const result = run(tree);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Private-name match: tracked\.txt/);
});

test('the worktree pattern file takes precedence and excludes itself from the scan', t => {
  const { main, tree } = repo(t);
  fs.writeFileSync(path.join(main, '.leakcheck.local'), 'Acme\n');
  fs.writeFileSync(path.join(tree, '.leakcheck.local'), 'AcmeLocal\n');
  const result = run(tree, '--require');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Private-name check passed\./);
});

test('a missing pattern file reports NOT RUN and returns 78 only with --require', t => {
  const { tree } = repo(t);
  const optional = run(tree);
  const required = run(tree, '--require');
  assert.equal(optional.status, 0);
  assert.equal(required.status, 78, required.stdout + required.stderr);
  assert.match(optional.stdout, /^NOT RUN:/);
  assert.match(required.stdout, /^NOT RUN:/);
});

test('outside a git repository the check reports NOT RUN even with a local file', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '.leakcheck.local'), 'Acme\n');
  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^NOT RUN:/);
  assert.equal(result.stderr, '');
});

test('invoking the CLI through a symlink honors --require', t => {
  const { tree } = repo(t);
  const link = path.join(fixture(t), 'leak-check.mjs');
  fs.symlinkSync(script, link);
  const result = spawnSync(process.execPath, [link, '--require'], { cwd: tree, encoding: 'utf8' });
  assert.equal(result.status, 78, result.stdout + result.stderr);
  assert.match(result.stdout, /^NOT RUN:/);
});

test('a linked worktree of a bare repo ignores patterns beside the bare repo', t => {
  const { main } = repo(t);
  const dir = fixture(t);
  const bare = path.join(dir, 'bare.git');
  const tree = path.join(dir, 'tree');
  git(dir, 'clone', '--bare', main, bare);
  fs.writeFileSync(path.join(dir, '.leakcheck.local'), 'Acme\n');
  git(bare, 'worktree', 'add', '--detach', tree);
  const result = run(tree, '--require');
  assert.equal(result.status, 78, result.stdout + result.stderr);
  assert.match(result.stdout, /^NOT RUN:/);
});

test('scans a worktree whose checkout path ends in a space', t => {
  const { tree } = repo(t, 'tree ');
  fs.writeFileSync(path.join(tree, '.leakcheck.local'), 'Acme\n');
  const result = run(tree, '--require');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Private-name match: tracked\.txt/);
});
