#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fail = message => { throw new Error(message); };
// Deliberately small YAML subset. Reject syntax rather than silently omit CI work.
export function parseWorkflow(source) {
  const lines = source.split('\n');
  let i = 0;
  function scalar(s) {
    if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map(x => scalar(x.trim()));
    if (/^["']/.test(s)) {
      if (s.at(-1) !== s[0]) fail(`Unsupported YAML scalar: ${s}`);
      return s.slice(1, -1);
    }
    if (!s || /^[&*!>{]/.test(s) || /\s+#/.test(s)) fail(`Unsupported YAML scalar: ${s}`);
    return s;
  }
  function block(indent) {
    const result = lines[i]?.trimStart().startsWith('- ') ? [] : {};
    while (i < lines.length) {
      if (!lines[i].trim() || lines[i].trimStart().startsWith('#')) { i++; continue; }
      const line = lines[i];
      if (line.includes('\t')) fail(`Unsupported YAML tabs at line ${i + 1}`);
      const n = line.search(/\S/);
      if (n < indent) break;
      if (n !== indent) fail(`Unsupported YAML indentation at line ${i + 1}`);
      let text = line.slice(indent), target = result;
      if (Array.isArray(result)) {
        if (!text.startsWith('- ')) fail('Unsupported YAML sequence');
        target = {}; result.push(target); text = text.slice(2);
      }
      function entry(t, level) {
        const m = /^([\w-]+):(?: (.*))?$/.exec(t);
        if (!m || Object.hasOwn(target, m[1])) fail(`Unsupported or duplicate YAML entry: ${t}`);
        i++;
        if (m[2] === '|') {
          const chunks = [];
          while (i < lines.length && (!lines[i].trim() || lines[i].search(/\S/) > level)) {
            if (lines[i].trim() && lines[i].search(/\S/) < level + 2) fail('Unsupported block indentation');
            chunks.push(lines[i].slice(level + 2)); i++;
          }
          target[m[1]] = chunks.join('\n') + '\n';
        } else target[m[1]] = m[2] === undefined ? block(level + 2) : scalar(m[2]);
      }
      entry(text, Array.isArray(result) ? indent + 2 : indent);
      if (Array.isArray(result)) {
        while (i < lines.length && lines[i].search(/\S/) === indent + 2) entry(lines[i].trim(), indent + 2);
      }
    }
    return result;
  }
  const workflow = block(0);
  const keys = (obj, allowed) => { for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`Unsupported workflow field: ${k}`); };
  keys(workflow, ['name', 'on', 'concurrency', 'jobs']);
  if (!workflow.jobs || Array.isArray(workflow.jobs)) fail('Workflow requires jobs');
  for (const job of Object.values(workflow.jobs)) {
    keys(job, ['if', 'strategy', 'runs-on', 'steps']);
    if (job.strategy) {
      keys(job.strategy, ['fail-fast', 'matrix']);
      keys(job.strategy.matrix, ['os', 'node']);
      for (const values of Object.values(job.strategy.matrix)) if (!Array.isArray(values) || !values.length) fail('Unsupported matrix');
    }
    if (!Array.isArray(job.steps)) fail('Job requires steps');
    for (const step of job.steps) {
      keys(step, ['name', 'run', 'shell', 'uses', 'with']);
      if (!!step.run === !!step.uses) fail('Step requires exactly one of run or uses');
      if (step.shell && step.shell !== 'bash') fail(`Unsupported shell: ${step.shell}`);
      if (step.run?.includes('${{')) fail('Unsupported expression in run step');
      if (step.run && step.with) fail('Unsupported with on run step');
    }
  }
  return workflow;
}
// Conditions require GitHub event context; conservatively skip them unless forced.
export function expandMatrix(workflow, platform = process.platform, allJobs = false) {
  const local = { darwin: 'macos-latest', linux: 'ubuntu-latest' }[platform];
  if (!local) fail(`Unsupported platform: ${platform}`);
  return Object.entries(workflow.jobs).flatMap(([id, job]) => {
    const matrix = job.strategy?.matrix || {};
    return (matrix.os || [job['runs-on']]).flatMap(osName => (matrix.node || ['']).map(node => {
      if (job['runs-on'] !== '${{ matrix.os }}' && job['runs-on'] !== osName) fail('Unsupported runs-on');
      return { id: `${id}/${osName}/node${node}`, job, os: osName, node: String(node), run: osName === local && (!Object.hasOwn(job, 'if') || allJobs) };
    }));
  });
}
export function actionKind(step) {
  const match = /^(actions\/(?:checkout|setup-node|setup-python))@v\d+$/.exec(step.uses);
  if (!match) fail(`Unsupported action: ${step.uses}`);
  const allowed = { 'actions/checkout': [], 'actions/setup-node': ['node-version'], 'actions/setup-python': ['python-version'] }[match[1]];
  for (const key of Object.keys(step.with || {})) if (!allowed.includes(key)) fail(`Unsupported action option: ${key}`);
  if (match[1] === 'actions/setup-node' && step.with?.['node-version'] !== '${{ matrix.node }}') fail('setup-node requires matrix.node');
  if (match[1] === 'actions/setup-python' && step.with?.['python-version'] !== '3.x') fail('Unsupported Python version');
  return match[1].split('/')[1];
}
export function formatLog(merge, head, node, body, code) {
  return `HEAD=${merge} PR_HEAD=${head} NODE=${node}\n${body}${body.endsWith('\n') ? '' : '\n'}EXIT=${code}\n`;
}
export function summary(rows) {
  return ['job\tresult\tlog path', ...rows.map(r => `${r.id}\t${r.result}\t${r.log || '-'}`)].join('\n');
}
function command(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (r.error || r.status !== 0) fail(`${cmd} failed: ${r.error?.message || r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function nodeInstallCommand(platform, arch, major) {
  const target = { darwin: 'darwin', linux: 'linux' }[platform];
  const cpu = { arm64: 'arm64', x64: 'x64' }[arch];
  if (!target || !cpu) fail('Unsupported Node download platform');
  const version = major === '22' ? '22.14.0' : '20.20.0';
  return `mkdir -p ~/.cache/tbs-kit-ci/node${major} && curl -fL https://nodejs.org/dist/v${version}/node-v${version}-${target}-${cpu}.tar.gz | tar -xz --strip-components=1 -C ~/.cache/tbs-kit-ci/node${major}`;
}
function legacyNodeCaches() {
  const cache = path.join(os.homedir(), '.cache');
  try {
    return fs.readdirSync(cache).filter(name => name.endsWith('-ci') && name !== 'tbs-kit-ci')
      .sort().map(name => path.join(cache, name, 'node20/bin'));
  } catch { return []; }
}
export function resolveNode(major, env, probe = command, exists = fs.existsSync) {
  const candidates = major === '22' ? [env.TBS_CI_NODE22, 'node'] : major === '20' ? [env.TBS_CI_NODE20, path.join(os.homedir(), '.cache/tbs-kit-ci/node20/bin'), ...legacyNodeCaches()] : [];
  for (let candidate of candidates.filter(Boolean)) {
    if (candidate !== 'node' && exists(candidate) && fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, 'node');
    try {
      const version = probe(candidate, ['--version'], { env });
      if (!version.startsWith(`v${major}.`)) continue;
      const binary = probe(candidate, ['-p', 'process.execPath'], { env });
      return { bin: path.dirname(binary), version };
    } catch { /* Try the next configured location. */ }
  }
  fail(`Missing Node ${major}. Install Node ${major} with:\n${nodeInstallCommand(process.platform, process.arch, major)}${major === '22' ? '\nFor Node 22, set TBS_CI_NODE22=~/.cache/tbs-kit-ci/node22/bin after installing.' : ''}`);
}
export function runJob(entry, { tree, temp, merge, head, log, env = process.env }) {
  let body = '', code = 0, version = `requested-${entry.node}`;
  const prefix = path.join(temp, 'npm-global');
  let stepEnv = { ...env, NPM_CONFIG_PREFIX: prefix, PATH: `${prefix}/bin${path.delimiter}${env.PATH}` };
  try {
    for (const step of entry.job.steps) {
      body += `\n$ ${step.run || step.uses}\n`;
      if (step.uses) {
        const kind = actionKind(step);
        if (kind === 'setup-node') {
          const node = resolveNode(entry.node, env);
          version = node.version;
          stepEnv.PATH = `${prefix}/bin${path.delimiter}${node.bin}${path.delimiter}${env.PATH}`;
          body += `Using Node ${version}\n`;
        } else if (kind === 'setup-python') {
          const v = command('python3', ['-c', 'import sys; assert sys.version_info.major >= 3; print(sys.version)'], { cwd: tree, env: stepEnv });
          body += `${v}\n`;
        } else body += `Checkout: ${merge}\n`;
      } else {
        const r = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], { cwd: tree, env: stepEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        body += (r.stdout || '') + (r.stderr || '');
        if (r.error || r.status !== 0) { code = r.status || 1; body += `${r.error?.message || ''}\n`; break; }
      }
    }
  } catch (error) { body += `${error.message}\n`; code = 1; }
  fs.writeFileSync(log, formatLog(merge, head, version, body, code));
  return code;
}
export function main(args = process.argv.slice(2)) {
  const prIndex = args.indexOf('--pr');
  if (prIndex < 0 || !/^\d+$/.test(args[prIndex + 1] || '') || args.some((a, i) => i !== prIndex + 1 && !['--pr', '--post', '--keep', '--all-jobs'].includes(a)) || args.filter(a => a === '--pr').length !== 1) fail('Usage: node scripts/ci-local.mjs --pr <N> [--post] [--keep] [--all-jobs]');
  const pr = args[prIndex + 1];
  const root = command('git', ['rev-parse', '--show-toplevel']);
  const common = path.resolve(root, command('git', ['rev-parse', '--git-common-dir']));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-ci-local-'));
  const tree = path.join(temp, 'tree');
  let added = false, head, rows = [], failure;
  try {
    const info = JSON.parse(command('gh', ['pr', 'view', pr, '--json', 'headRefOid,baseRefName']));
    head = info.headRefOid;
    if (!/^[a-f0-9]{40}$/.test(head) || !info.baseRefName || info.baseRefName.startsWith('-')) fail('Invalid PR refs');
    // Fetch the PR head into its own ref: FETCH_HEAD would name whichever refspec came first.
    const prRef = `refs/tbs-ci-local/pr-${pr}`;
    command('git', ['fetch', 'origin', `+refs/heads/${info.baseRefName}:refs/remotes/origin/${info.baseRefName}`, `+refs/pull/${pr}/head:${prRef}`]);
    if (command('git', ['rev-parse', prRef]) !== head) fail('PR head changed during fetch; retry');
    command('git', ['worktree', 'add', '--detach', tree, `origin/${info.baseRefName}`]); added = true;
    command('git', ['-c', 'user.name=Local CI', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', 'merge', '--no-ff', '--no-edit', head], { cwd: tree });
    const merge = command('git', ['rev-parse', 'HEAD'], { cwd: tree });
    const privateFile = path.join(root, '.leakcheck.local');
    if (fs.existsSync(privateFile)) fs.copyFileSync(privateFile, path.join(tree, '.leakcheck.local'));
    const workflow = parseWorkflow(fs.readFileSync(path.join(tree, '.github/workflows/ci.yml'), 'utf8'));
    const dir = path.join(common, 'tbs-ci-local', `${pr}-${merge.slice(0, 12)}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [index, entry] of expandMatrix(workflow, process.platform, args.includes('--all-jobs')).entries()) {
      if (!entry.run) { rows.push({ id: entry.id, result: 'NOT RUN' }); continue; }
      command('git', ['reset', '--hard', merge], { cwd: tree });
      command('git', ['clean', '-fdx'], { cwd: tree });
      if (fs.existsSync(privateFile)) fs.copyFileSync(privateFile, path.join(tree, '.leakcheck.local'));
      const log = path.join(dir, `job-${index}.log`);
      const jobTemp = path.join(temp, `job-${index}`); fs.mkdirSync(jobTemp);
      const code = runJob(entry, { tree, temp: jobTemp, merge, head, log });
      rows.push({ id: entry.id, result: code === 0 ? 'PASS' : 'FAIL', log });
    }
  } catch (error) { failure = error; rows.push({ id: 'runner', result: 'FAIL' }); }
  finally {
    if (args.includes('--keep')) console.log(`Kept run directory: ${temp}`);
    else {
      if (added) command('git', ['worktree', 'remove', '--force', tree]);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  console.log(summary(rows));
  if (failure) console.error(failure.message);
  const passed = !failure && rows.some(r => r.result === 'PASS') && !rows.some(r => r.result === 'FAIL');
  if (args.includes('--post') && head) {
    const repo = JSON.parse(command('gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    const groups = new Map();
    for (const row of rows) {
      const key = row.result;
      groups.set(key, [...(groups.get(key) || []), row.id.replace('-latest', '')]);
    }
    const description = [...groups].map(([result, jobs]) => `${result}: ${jobs.join(',')}`).join('; ');
    if (description.length > 140) fail('Status description exceeds 140 characters; status not posted');
    command('gh', ['api', '-X', 'POST', `repos/${repo}/statuses/${head}`, '-f', 'context=ci-local', '-f', `state=${passed ? 'success' : 'failure'}`, '-f', `description=${description}`]);
  }
  return passed ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
