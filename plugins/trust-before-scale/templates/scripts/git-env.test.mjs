import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import './config.mjs';

test('vendored tests leave the hook sentinel repository non-bare', t => {
  const root = mkdtempSync(join(tmpdir(), 'tbs-git-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');

  const file = fileURLToPath(import.meta.url);
  const dir = dirname(file);
  const tests = readdirSync(dir)
    .filter(name => name.endsWith('.test.mjs') && name !== basename(file))
    .map(name => join(dir, name));
  const env = { ...process.env, GIT_DIR: join(root, '.git') };
  delete env.NODE_TEST_CONTEXT; // Start a new test runner, outside this test worker.
  const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, encoding: 'utf8', env });
  assert.equal(git('config', 'core.bare'), 'false', 'vendored tests changed core.bare');
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
});
