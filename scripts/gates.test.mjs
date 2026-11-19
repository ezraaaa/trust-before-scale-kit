import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { gateList, runGates } from './gates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function run(quick, failure, beforeResult) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-gates-test-'));
  const calls = [], rows = [];
  try {
    const code = await runGates({ root, temp, quick, logDir: path.join(temp, 'logs'), report: row => rows.push(row),
      runner(cmd, args, options) {
        calls.push({ cmd, args, cwd: options.cwd });
        const result = { status: failure?.(cmd, args) ? 7 : 0, stdout: cmd === 'git' && args[0] === 'rev-parse' ? 'abc123\n' : '', stderr: '' };
        const pending = beforeResult?.(cmd, args, options.cwd);
        return pending ? pending.then(() => result) : result;
      } });
    for (const row of rows) {
      const log = fs.readFileSync(row.slice(row.indexOf(temp)), 'utf8');
      assert.match(log, /^HEAD=abc123\n/);
      assert.match(log, /EXIT=(0|1|7)\n$/);
    }
    return { code, calls, rows };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
test('gates run in documented order, then three fresh installs with doctor and tests', async () => {
  const { code, calls, rows } = await run(false);
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
test('--quick runs all repository gates and skips only fresh installs', async () => {
  const { code, calls, rows } = await run(true);
  assert.equal(code, 0);
  assert.equal(rows.length, gateList(root).length);
  assert.ok(!calls.some(c => c.args[0] === 'init'));
});
test('a failed gate produces a nonzero exit and later gates still run', async () => {
  const { code, rows } = await run(false, cmd => cmd === 'bash');
  assert.equal(code, 1);
  assert.match(rows[3], /^FAIL merge-gate-smoke /);
  assert.match(rows.at(-1), /^PASS install-profile-dir /);
});
test('a failed install stops that install but attempts the next profile', async () => {
  const { code, calls, rows } = await run(false, (cmd, args) => args.includes('generic'));
  assert.equal(code, 1);
  assert.match(rows.at(-3), /^FAIL install-generic /);
  assert.match(rows.at(-2), /^PASS install-acme-mobile /);
  assert.equal(calls.filter(c => c.args[0] === 'scripts/tbs/doctor.mjs').length, 2);
});

test('concurrent gates overlap and report once in fixed order after an out-of-order failure', async () => {
  const gates = gateList(root);
  const ids = [...gates.map(([id]) => id), 'install-generic', 'install-acme-mobile', 'install-profile-dir'];
  const events = [];
  const { code, rows } = await run(false, cmd => cmd === 'bash', (cmd, args, cwd) => {
    if (cmd !== 'bash' && !(cmd === 'git' && args[0] === 'init')) return;
    const id = cmd === 'bash' ? 'merge-gate-smoke' : `install-${path.basename(cwd)}`;
    events.push(`start ${id}`);
    return delay(cmd === 'bash' ? 30 : 10).then(() => events.push(`finish ${id}`));
  });
  assert.equal(code, 1);
  assert.deepEqual(rows.map(row => row.split(' ').slice(0, 2)), ids.map(id => [
    id === 'merge-gate-smoke' ? 'FAIL' : 'PASS', id,
  ]));
  assert.deepEqual(events.slice(0, 4), [
    'start merge-gate-smoke', 'start install-generic', 'start install-acme-mobile', 'start install-profile-dir',
  ]);
  assert.equal(events.at(-1), 'finish merge-gate-smoke');
});

test('only fresh installs omit git-env from the vendored test list', async () => {
  const { calls } = await run(false);
  const vendoredDir = path.join(root, 'plugins/trust-before-scale/templates/scripts');
  const expected = fs.readdirSync(vendoredDir).filter(file => file.endsWith('.test.mjs')).sort();
  assert.ok(expected.includes('git-env.test.mjs'));
  const vendored = calls.find(({ args }) => args[0] === '--test' && args[1].startsWith(vendoredDir));
  assert.deepEqual(vendored.args.slice(1), expected.map(file => path.join(vendoredDir, file)));
  const installs = calls.filter(({ args }) => args[0] === '--test' && args[1].startsWith('scripts/tbs/'));
  assert.equal(installs.length, 3);
  for (const { args } of installs) {
    assert.deepEqual(args.slice(1), expected.filter(file => file !== 'git-env.test.mjs').map(file => path.join('scripts/tbs', file)));
  }
});
