import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gateList, runGates } from './gates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(quick, failure) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-gates-test-'));
  const calls = [], rows = [];
  try {
    const code = runGates({ root, temp, quick, logDir: path.join(temp, 'logs'), report: row => rows.push(row),
      runner(cmd, args, options) {
        calls.push({ cmd, args, cwd: options.cwd });
        return { status: failure?.(cmd, args) ? 7 : 0, stdout: cmd === 'git' && args[0] === 'rev-parse' ? 'abc123\n' : '', stderr: '' };
      } });
    for (const row of rows) {
      const log = fs.readFileSync(row.slice(row.indexOf(temp)), 'utf8');
      assert.match(log, /^HEAD=abc123\n/);
      assert.match(log, /EXIT=(0|7)\n$/);
    }
    return { code, calls, rows };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
test('gates run in documented order, then three fresh installs with doctor and tests', () => {
  const { code, calls, rows } = run(false);
  assert.equal(code, 0);
  assert.deepEqual(rows.map(row => row.split(' ')[1]), [...gateList(root).map(g => g[0]), 'install-generic', 'install-acme-mobile', 'install-profile-dir']);
  const installs = calls.filter(c => c.args[0]?.endsWith('/bin/tbs-init'));
  assert.equal(installs.length, 3);
  assert.deepEqual(installs[0].args.slice(1), ['generic', '--ci']);
  assert.deepEqual(installs[1].args.slice(1), ['acme-mobile']);
  assert.equal(installs[2].args[1], '--profile-dir');
  for (const install of installs) {
    const commands = calls.filter(c => c.cwd === install.cwd);
    assert.deepEqual(commands.map(c => c.args[0]), ['init', install.args[0], 'scripts/tbs/doctor.mjs', '--test']);
    assert.ok(commands[3].args.slice(1).every(a => a.startsWith('scripts/tbs/') && a.endsWith('.test.mjs')));
  }
});
test('--quick runs all repository gates and skips only fresh installs', () => {
  const { code, calls, rows } = run(true);
  assert.equal(code, 0);
  assert.equal(rows.length, gateList(root).length);
  assert.ok(!calls.some(c => c.args[0] === 'init'));
});
test('a failed gate produces a nonzero exit and later gates still run', () => {
  const { code, rows } = run(false, cmd => cmd === 'bash');
  assert.equal(code, 1);
  assert.match(rows[3], /^FAIL merge-gate-smoke /);
  assert.match(rows.at(-1), /^PASS install-profile-dir /);
});
test('a failed install stops that install but attempts the next profile', () => {
  const { code, calls, rows } = run(false, (cmd, args) => args.includes('generic'));
  assert.equal(code, 1);
  assert.match(rows.at(-3), /^FAIL install-generic /);
  assert.match(rows.at(-2), /^PASS install-acme-mobile /);
  assert.equal(calls.filter(c => c.args[0] === 'scripts/tbs/doctor.mjs').length, 2);
});
