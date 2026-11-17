import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWorkflow, expandMatrix, actionKind, formatLog, summary, resolveNode, runJob } from './ci-local.mjs';

const source = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
test('parses workflow steps, names, shell and literal block', () => {
  const workflow = parseWorkflow(source);
  const steps = workflow.jobs.linux.steps;
  assert.equal(steps[0].uses, 'actions/checkout@v4');
  const fresh = steps.find(s => s.name === 'Fresh install');
  assert.equal(fresh.shell, 'bash');
  assert.match(fresh.run, /kit="\$PWD"\n/);
  assert.match(fresh.run, /node --test scripts\/tbs\/\*\.test\.mjs\n$/);
  assert.ok(steps.some(s => s.run === 'node scripts/leak-check.mjs'));
});
test('rejects unsupported constructs instead of skipping checks', () => {
  for (const addition of ['    needs: other\n', '    timeout-minutes: 10\n']) {
    assert.throws(() => parseWorkflow(source.replace('    steps:', `${addition}    steps:`)), /Unsupported/);
  }
  assert.throws(() => parseWorkflow(source.replace('run: |', 'run: >')), /Unsupported/);
  assert.throws(() => parseWorkflow(source.replace('shell: bash', 'shell: pwsh')), /Unsupported shell/);
});
test('expands all matrix entries and explicitly reports other OS as NOT RUN', () => {
  for (const platform of ['darwin', 'linux']) {
    const entries = expandMatrix(parseWorkflow(source), platform, true);
    assert.equal(entries.length, 4);
    assert.deepEqual(entries.filter(e => e.run).map(e => e.node), ['20', '22']);
    const table = summary(entries.map(e => ({ id: e.id, result: e.run ? 'PASS' : 'NOT RUN' })));
    assert.equal((table.match(/NOT RUN/g) || []).length, 2);
  }
});
test('job conditions are NOT RUN unless all jobs are forced, still respecting OS', () => {
  const workflow = parseWorkflow(source);
  assert.deepEqual(workflow.jobs.linux.steps, workflow.jobs.macos.steps);
  assert.equal(workflow.concurrency['cancel-in-progress'], 'true');
  assert.equal(workflow.concurrency.group, '${{ github.workflow }}-${{ github.ref }}');
  assert.deepEqual(workflow.on.push.branches, ['main', 'develop']);
  assert.equal(workflow.on.push.tags, undefined);
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'));
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.equal(workflow.jobs.macos.if, "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main')");
  assert.ok(expandMatrix(workflow, 'darwin').every(e => !e.run));
  assert.deepEqual(expandMatrix(workflow, 'linux').filter(e => e.run).map(e => e.id),
    ['linux/ubuntu-latest/node20', 'linux/ubuntu-latest/node22']);
  assert.deepEqual(expandMatrix(workflow, 'darwin', true).filter(e => e.run).map(e => e.id),
    ['macos/macos-latest/node20', 'macos/macos-latest/node22']);
  // Even a false scalar condition must not accidentally run without the override.
  workflow.jobs.linux.if = 'false';
  assert.ok(expandMatrix(workflow, 'linux').every(e => !e.run));
  assert.equal(expandMatrix(workflow, 'linux', true).filter(e => e.run).length, 2);
});
test('maps only known actions and supported options', () => {
  for (const [uses, options, expected] of [
    ['actions/checkout@v4', {}, 'checkout'],
    ['actions/setup-node@v4', { 'node-version': '${{ matrix.node }}' }, 'setup-node'],
    ['actions/setup-python@v5', { 'python-version': '3.x' }, 'setup-python'],
  ]) assert.equal(actionKind({ uses, with: options }), expected);
  assert.throws(() => actionKind({ uses: 'other/action@v1' }), /Unsupported action/);
  assert.throws(() => actionKind({ uses: 'actions/checkout@v4', with: { repository: 'elsewhere' } }), /Unsupported action option/);
});
test('Node selection uses stubs without network or gh', () => {
  const probe = (exe, args) => {
    assert.equal(exe, '/stub/node22');
    return args[0] === '--version' ? 'v22.1.0' : '/stub/node22';
  };
  assert.deepEqual(resolveNode('22', { TBS_CI_NODE22: '/stub/node22' }, probe, () => false), { bin: '/stub', version: 'v22.1.0' });
  assert.throws(() => resolveNode('20', {}, () => { throw Error('missing'); }, () => false), /curl -fL https:\/\/nodejs.org/);
});
test('logs prove merge, PR head, Node, commands, output and final exit', () => {
  assert.equal(formatLog('merge', 'head', 'v22.1', '$ check\nok\n', 0), 'HEAD=merge PR_HEAD=head NODE=v22.1\n$ check\nok\nEXIT=0\n');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-local-test-'));
  try {
    const log = path.join(temp, 'job.log');
    const entry = { node: '22', job: { steps: [{ run: 'printf "%s\\n" "$NPM_CONFIG_PREFIX"; printf ok' }, { run: 'exit 7' }, { run: 'printf unreachable' }] } };
    assert.equal(runJob(entry, { tree: temp, temp, merge: 'merge', head: 'head', log }), 7);
    const text = fs.readFileSync(log, 'utf8');
    assert.match(text, /^HEAD=merge PR_HEAD=head NODE=requested-22\n/);
    assert.ok(text.includes(path.join(temp, 'npm-global')));
    assert.match(text, /\$ exit 7/);
    assert.doesNotMatch(text, /unreachable/);
    assert.match(text, /EXIT=7\n$/);
    assert.equal(runJob({ node: '22', job: { steps: [{ uses: 'unknown/action@v1' }] } }, { tree: temp, temp, merge: 'm', head: 'h', log }), 1);
    assert.match(fs.readFileSync(log, 'utf8'), /Unsupported action/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
