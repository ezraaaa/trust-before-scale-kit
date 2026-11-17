#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    ['leak-check', 'node', ['scripts/leak-check.mjs']],
  ];
}
export function runGates({ root, logDir, temp, quick = false, runner = spawnSync, report = console.log }) {
  fs.mkdirSync(logDir, { recursive: true });
  const head = runner('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (head.error || head.status !== 0) throw new Error('Cannot resolve HEAD');
  let failed = false;
  function gate(id, steps) {
    let body = '', code = 0;
    try {
      for (const [cmd, args, cwd = root] of steps()) {
        body += `$ ${JSON.stringify([cmd, ...args])}\n`;
        const r = runner(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        body += (r.stdout || '') + (r.stderr || '');
        if (r.error || r.status !== 0) { code = r.status || 1; body += `${r.error?.message || ''}\n`; break; }
      }
    } catch (error) { code = 1; body += `${error.message}\n`; }
    const log = path.join(logDir, `${id}.log`);
    fs.writeFileSync(log, `HEAD=${head.stdout.trim()}\n${body}EXIT=${code}\n`);
    report(`${code === 0 ? 'PASS' : 'FAIL'} ${id} ${log}`);
    failed ||= code !== 0;
  }
  for (const [id, cmd, args] of gateList(root)) gate(id, () => [[cmd, args]]);
  if (!quick) {
    for (const profile of ['generic', 'acme-mobile', 'profile-dir']) {
      gate(`install-${profile}`, () => {
        const tree = path.join(temp, profile);
        fs.mkdirSync(tree);
        let args = [profile];
        if (profile === 'generic') args.push('--ci');
        if (profile === 'profile-dir') {
          const copy = path.join(temp, 'copied-profile');
          fs.cpSync(path.join(root, 'plugins/trust-before-scale/profiles/generic'), copy, { recursive: true });
          args = ['--profile-dir', copy];
        }
        // Explicit test paths avoid shell globbing; the installer vendors this set.
        const vendored = tests(path.join(root, 'plugins/trust-before-scale/templates/scripts')).map(file => path.join('scripts/tbs', path.basename(file)));
        return [
          ['git', ['init', '-q'], tree],
          ['node', [path.join(root, 'plugins/trust-before-scale/bin/tbs-init'), ...args], tree],
          ['node', ['scripts/tbs/doctor.mjs'], tree],
          ['node', ['--test', ...vendored], tree],
        ];
      });
    }
  }
  return failed ? 1 : 0;
}
export function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--quick') || args.length > 1) throw new Error('Usage: node scripts/gates.mjs [--quick]');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-gates-logs-'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-gates-'));
  try { return runGates({ root, logDir, temp, quick: args.includes('--quick') }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
