#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runCommand(cmd, args, options) {
  return new Promise(resolve => {
    const child = execFile(cmd, args, options, (error, stdout, stderr) => {
      const exited = Number.isInteger(error?.code);
      resolve({ status: error ? (exited ? error.code : 1) : 0, stdout, stderr, error: exited ? undefined : error });
    });
    child.stdin?.end(); // Like spawnSync: a gate that reads stdin sees end-of-input instead of hanging.
  });
}

const tests = dir => fs.readdirSync(dir).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(dir, name));
export function gateList(root) {
  const plugin = 'plugins/trust-before-scale';
  return [
    ['scripts-tests', 'node', ['--test', ...tests(path.join(root, 'scripts'))]],
    ['vendored-tests', 'node', ['--test', ...tests(path.join(root, plugin, 'templates/scripts'))]],
    ['plugin-tests', 'node', ['--test', ...tests(path.join(root, plugin, 'tests'))]],
    ['merge-gate-smoke', 'bash', [`${plugin}/tests/merge-gate-smoke.sh`]],
    ['harness-check', 'node', ['scripts/build-harness.mjs', '--check']],
    ['marketplace-validate', 'claude', ['plugin', 'validate', '.', '--strict']],
    ['plugin-validate', 'claude', ['plugin', 'validate', plugin, '--profile', 'directory']],
    ['leak-check', 'node', ['scripts/leak-check.mjs', '--require']],
  ];
}
export async function runGates({ root, logDir, temp, quick = false, runner = runCommand, report = console.log }) {
  fs.mkdirSync(logDir, { recursive: true });
  const head = await runner('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (head.error || head.status !== 0) throw new Error('Cannot resolve HEAD');
  async function gate([id, steps]) {
    let body = '', code = 0;
    try {
      for (const [cmd, args, cwd = root] of steps()) {
        body += `$ ${JSON.stringify([cmd, ...args])}\n`;
        const r = await runner(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        body += (r.stdout || '') + (r.stderr || '');
        if (!body.endsWith('\n')) body += '\n';
        if (r.error || r.status !== 0) { code = r.status || 1; body += `${r.error?.message || ''}\n`; break; }
      }
    } catch (error) { code = 1; body += `${error.message}\n`; }
    const log = path.join(logDir, `${id}.log`);
    fs.writeFileSync(log, `HEAD=${head.stdout.trim()}\n${body}EXIT=${code}\n`);
    return code;
  }
  const gates = gateList(root).map(([id, cmd, args]) => [id, () => [[cmd, args]]]);
  if (!quick) {
    // git-env reruns the other vendored tests and is covered by vendored-tests.
    const vendored = tests(path.join(root, 'plugins/trust-before-scale/templates/scripts'))
      .map(file => path.basename(file))
      .filter(file => file !== 'git-env.test.mjs')
      .map(file => path.join('scripts/tbs', file));
    for (const profile of ['generic', 'acme-mobile', 'profile-dir']) {
      gates.push([`install-${profile}`, () => {
        const tree = path.join(temp, profile);
        fs.mkdirSync(tree);
        let args = [profile];
        if (profile === 'generic') args.push('--ci');
        if (profile === 'profile-dir') {
          const copy = path.join(temp, 'copied-profile');
          fs.cpSync(path.join(root, 'plugins/trust-before-scale/profiles/generic'), copy, { recursive: true });
          args = ['--profile-dir', copy];
        }
        return [
          ['git', ['init', '-q'], tree],
          ['node', [path.join(root, 'plugins/trust-before-scale/bin/tbs-init'), ...args], tree],
          ['node', ['scripts/tbs/doctor.mjs'], tree],
          ['node', ['--test', ...vendored], tree],
        ];
      }]);
    }
  }

  // Wait for every gate before reporting or allowing main to remove the install trees.
  let failed = false;
  const results = await Promise.allSettled(gates.map(gate));
  for (const [index, result] of results.entries()) {
    const [id] = gates[index];
    const log = path.join(logDir, `${id}.log`);
    const code = result.status === 'fulfilled' ? result.value : 1;
    if (result.status === 'rejected') console.error(result.reason.message);
    report(`${code === 0 ? 'PASS' : code === 78 ? 'NOT RUN' : 'FAIL'} ${id} ${log}`);
    failed ||= code !== 0;
  }
  return failed ? 1 : 0;
}
export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--quick') || args.length > 1) throw new Error('Usage: node scripts/gates.mjs [--quick]');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-gates-logs-'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-gates-'));
  try { return await runGates({ root, logDir, temp, quick: args.includes('--quick') }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
