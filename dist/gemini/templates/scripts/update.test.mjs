import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { gateCommandFor } from './codex-hook.mjs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const name = 'trust-before-scale';
const versionPath = 'scripts/tbs/VERSION';
const updateBranch = 'chore/tbs-kit-1.10.0';

function fixture(t) {
  const temp = mkdtempSync(join(realpathSync(tmpdir()), 'tbs-update-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'project');
  const home = join(temp, 'home');
  const claude = join(temp, 'claude config');
  mkdirSync(root);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claude };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'TBS_PLUGIN') delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (path, data) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  put(versionPath, '1.9.0\n');
  put('scripts/tbs/doctor.mjs', 'console.log("doctor ran");\n');
  put('scripts/tbs/update.mjs', '');
  copyFileSync(new URL('./update.mjs', import.meta.url), join(root, 'scripts/tbs/update.mjs'));
  git('init', '-q', '-b', 'main');
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Kit Test', '-c', 'user.email=kit@example.invalid', 'commit', '-qm', 'fixture');
  };
  commit();
  const addOrigin = () => {
    git('clone', '--bare', '.', '../origin.git');
    git('remote', 'add', 'origin', '../origin.git');
  };
  const install = (dir, version, { gemini = false } = {}) => {
    const path = join(temp, dir);
    const manifest = gemini ? 'gemini-extension.json' : '.claude-plugin/plugin.json';
    put(join('..', dir, manifest), JSON.stringify({ version }));
    put(join('..', dir, 'bin/tbs-init'), `if (process.argv.includes('--list-targets')) {
      console.log(JSON.stringify(['scripts/tbs/VERSION', 'scripts/tbs/new.mjs', 'docs/trust-before-scale/brief-template.md',
        ...(process.argv.includes('--codex-hook') ? ['.codex/hooks.json'] : [])]));
      process.exit(0);
    }
    require('node:fs').writeFileSync('installer.json', JSON.stringify({
      installer: __filename, args: process.argv.slice(2)
    }));\n`);
    return path;
  };
  const cache = (version, slot = version) => install(`claude config/plugins/cache/market '/${name}/${slot}`, version);
  const run = (args = [], options = {}) => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/tbs/update.mjs'), ...args], {
      cwd: options.cwd ?? root, env: { ...env, ...options.env }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    return result;
  };
  const installed = () => JSON.parse(readFileSync(join(root, 'installer.json'), 'utf8'));
  const untouched = () => assert.ok(!existsSync(join(root, 'installer.json')));
  return { root, git, put, commit, install, cache, run, installed, untouched, addOrigin };
}

test('selects the newest numeric version across hosts and skips broken copies', t => {
  const { root, git, put, install, cache, run, installed } = fixture(t);
  cache('1.9.9');
  const winner = cache('1.10.0');
  cache('not a version', 'bad-version');
  rmSync(join(cache('3.0.0'), 'bin/tbs-init'));
  put(`../claude config/plugins/cache/market '/${name}/4.0.0/.claude-plugin/plugin.json`, '{broken');
  install(`claude config/plugins/marketplaces/example/plugins/${name}`, '1.9.20');
  install(`home/.gemini/extensions/${name}`, '1.9.40', { gemini: true });
  install(`home/.codex/plugins/cache/example/${name}/local`, '1.9.60');
  git('switch', '-c', 'feature/example');
  const result = run([], { cwd: join(root, 'scripts'), env: { GIT_DIR: '/nonexistent', GIT_WORK_TREE: '/nonexistent' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /doctor ran/);
  assert.deepEqual(installed(), { installer: join(winner, 'bin/tbs-init'), args: ['--update'] });
  assert.equal(git('branch', '--show-current'), 'feature/example');
});

test('discovers marketplace, Gemini, and Codex copies independently', t => {
  const { install, run, addOrigin } = fixture(t);
  addOrigin();
  for (const [dir, version, gemini] of [
    [`claude config/plugins/marketplaces/example/plugins/${name}`, '1.10.0', false],
    [`home/.gemini/extensions/${name}`, '1.11.0', true],
    [`home/.codex/plugins/cache/example/${name}/local`, '1.12.0', false],
  ]) {
    const path = install(dir, version, { gemini });
    const result = run(['--branch', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(path), result.stdout);
  }
});

test('TBS_PLUGIN takes precedence and an invalid explicit path fails closed', t => {
  const { cache, install, run, installed, addOrigin } = fixture(t);
  addOrigin();
  cache('2.0.0');
  const chosen = install('explicit kit', '1.10.0');
  const invalid = run(['--branch'], { env: { TBS_PLUGIN: join(chosen, 'missing') } });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /TBS_PLUGIN does not point/);
  const result = run(['--branch'], { env: { TBS_PLUGIN: chosen } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /via TBS_PLUGIN/);
  assert.equal(installed().installer, join(chosen, 'bin/tbs-init'));
});

test('current project and missing installs produce the expected status and guidance', t => {
  const { cache, run, untouched } = fixture(t);
  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /claude plugin update trust-before-scale@trust-before-scale-kit/);
  assert.match(missing.stderr, /gemini extensions update trust-before-scale/);
  assert.match(missing.stderr, /Codex:.*\/plugins/);
  for (const version of ['1.8.0', '1.9.0']) {
    cache(version);
    const current = run();
    assert.equal(current.status, 0, current.stderr);
    assert.equal(current.stdout.trim(), `Already on 1.9.0 (newest installed: ${version}).`);
  }
  untouched();
});

test('refuses staged and unstaged tracked changes before creating a branch', t => {
  const { cache, git, put, run, untouched } = fixture(t);
  cache('1.10.0');
  put(versionPath, '1.8.0\n');
  for (const staged of [false, true]) {
    if (staged) git('add', versionPath);
    const result = run(['--branch']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Tracked changes detected/);
    untouched();
    assert.equal(git('branch', '--show-current'), 'main');
  }
});

test('guards main, master, develop, and detached HEAD with the exact branch fix', t => {
  const { cache, git, run, untouched, addOrigin } = fixture(t);
  addOrigin();
  cache('1.10.0');
  for (const branch of ['main', 'master', 'develop', 'HEAD']) {
    if (branch === 'HEAD') git('switch', '--detach');
    else if (branch !== 'main') git('switch', '-c', branch);
    const result = run();
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`node scripts/tbs/update.mjs --branch (creates ${updateBranch})`), result.stderr);
    untouched();
  }
  git('switch', 'main');
  git('tag', 'main');
  assert.match(run().stderr, /update\.mjs --branch \(creates chore\/tbs-kit-1\.10\.0\)/);
  git('switch', '--detach');
  const head = git('rev-parse', 'HEAD');
  const result = run(['--branch']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('branch', '--show-current'), updateBranch);
  assert.equal(git('rev-parse', 'HEAD'), head);
});

test('passes --codex-hook on request or when the existing Bash hook belongs to the kit', t => {
  const { cache, put, git, run, installed } = fixture(t);
  cache('1.10.0');
  git('switch', '-c', 'feature/example');
  for (const [command, args, expected] of [
    ['echo unrelated', [], ['--update']],
    ['echo unrelated', ['--codex-hook'], ['--update', '--codex-hook']],
    ['python3 "/old kit/hooks/merge-gate.py"', [], ['--update', '--codex-hook']],
    ['if f="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/tbs/merge-gate.py" && [ -f "$f" ]; then exec python3 "$f"; fi', [], ['--update']],
    [gateCommandFor('a'.repeat(64)), [], ['--update', '--codex-hook']],
  ]) {
    put('.codex/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{
      matcher: 'Bash', hooks: [{ type: 'command', command }],
    }] } }));
    git('add', '.codex/hooks.json');
    if (git('diff', '--cached', '--name-only')) git('-c', 'user.name=Kit Test', '-c', 'user.email=kit@example.invalid', 'commit', '-qm', 'hook');
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(installed().args, expected);
  }
});

// Needs the plugin tree around it (bin/tbs-init); a project's vendored scripts/tbs copy has none.
const pluginRoot = new URL('../../', import.meta.url);
test('update migrates a legacy Codex hook and refreshes the vendored gate', { skip: !existsSync(new URL('bin/tbs-init', pluginRoot)) && 'runs only inside the plugin tree' }, t => {
  const { root, cache, put, git, commit, run } = fixture(t);
  const source = cache('1.10.0');
  cpSync(pluginRoot, source, { recursive: true });
  writeFileSync(join(source, '.claude-plugin/plugin.json'), JSON.stringify({ version: '1.10.0' }));
  const unrelated = { type: 'command', command: 'echo keep' };
  put('.codex/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
    unrelated, { type: 'command', command: 'python3 "/old kit/hooks/merge-gate.py"' },
  ] }] } }));
  const gate = 'scripts/tbs/merge-gate.py';
  put(gate, '# stale\n');
  put('.agents/trust-before-scale.json', JSON.stringify({ project: 'test', mergeGate: {} }));
  git('switch', '-c', 'feature/example');
  commit();
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const commands = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'))
    .hooks.PreToolUse.flatMap(entry => entry.hooks.map(hook => hook.command));
  assert.equal(commands.length, 2);
  assert.equal(commands[0], unrelated.command);
  assert.match(commands[1], /scripts\/tbs\/merge-gate\.py/);
  assert.deepEqual(readFileSync(join(root, gate)), readFileSync(join(source, 'hooks/merge-gate.py')));
});

test('dry run shows the selection and branch action without changing files, refs or the index', t => {
  const { root, git, put, cache, run, untouched, addOrigin } = fixture(t);
  addOrigin();
  const selected = cache('1.10.0');
  put('untracked.txt', 'allowed');
  const before = git('status', '--porcelain');
  const refs = git('show-ref');
  const index = readFileSync(join(root, '.git/index'));
  const result = run(['--branch', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(selected));
  assert.ok(result.stdout.includes(`1.9.0 → 1.10.0; create ${updateBranch}`));
  assert.doesNotMatch(result.stdout, /doctor ran/);
  untouched();
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(git('show-ref'), refs);
  assert.equal(git('status', '--porcelain'), before);
});

test('shows doctor output and propagates its failure', t => {
  const { git, put, commit, cache, run, addOrigin } = fixture(t);
  addOrigin();
  cache('1.10.0');
  put('scripts/tbs/doctor.mjs', 'console.log("FAIL example"); process.exitCode = 7;\n');
  commit();
  git('push', 'origin', 'main');
  const result = run(['--branch']);
  assert.equal(result.status, 7, result.stderr);
  assert.match(result.stdout, /FAIL example/);
  assert.match(result.stderr, /Doctor failed/);
  assert.equal(git('branch', '--show-current'), updateBranch);
});

test('refuses all existing untracked installer targets, including ignored files', t => {
  const { cache, git, put, run, untouched } = fixture(t);
  cache('1.10.0');
  git('switch', '-c', 'feature/example');
  put('scripts/tbs/new.mjs', 'local script');
  put('docs/trust-before-scale/brief-template.md', 'local brief');
  put('.git/info/exclude', 'scripts/tbs/new.mjs\n');
  const result = run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /scripts\/tbs\/new\.mjs/);
  assert.match(result.stderr, /docs\/trust-before-scale\/brief-template\.md/);
  untouched();
});

test('branches from freshly fetched git-flow integration with the configured prefix or override', t => {
  for (const override of [undefined, 'custom/update']) {
    const { cache, git, put, commit, run } = fixture(t);
    cache('1.10.0');
    git('clone', '--bare', '.', '../origin.git');
    git('remote', 'add', 'origin', '../origin.git');
    git('config', 'gitflow.prefix.feature', 'feature/');
    git('config', 'gitflow.branch.develop', 'integration');
    git('switch', '-c', 'integration');
    put('integration.txt', 'new remote head');
    commit();
    const expected = git('rev-parse', 'HEAD');
    git('push', 'origin', 'integration');
    git('update-ref', '-d', 'refs/remotes/origin/integration');
    git('switch', '--detach', 'main');
    const result = run(['--branch', ...(override ? ['--branch-name', override] : [])]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('branch', '--show-current'), override ?? 'feature/tbs-kit-1.10.0');
    assert.equal(git('rev-parse', 'HEAD'), expected);
  }
});

test('refuses an update branch when origin is missing or cannot be fetched', t => {
  const { cache, git, run, untouched } = fixture(t);
  cache('1.10.0');
  assert.match(run(['--branch']).stderr, /no origin remote/i);
  git('remote', 'add', 'origin', '../missing.git');
  assert.match(run(['--branch']).stderr, /fetch origin/i);
  untouched();
});

test('explicit branch mode creates a new branch even from a feature branch', t => {
  const { cache, git, run } = fixture(t);
  cache('1.10.0');
  git('clone', '--bare', '.', '../origin.git');
  git('remote', 'add', 'origin', '../origin.git');
  git('switch', '-c', 'feature/current');
  const result = run(['--branch']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('branch', '--show-current'), updateBranch);
});

test('an older installer cannot write project files while being queried for targets', t => {
  const { install, git, put, run, untouched } = fixture(t);
  const selected = install('old installer', '1.10.0');
  put('../old installer/bin/tbs-init', "require('node:fs').writeFileSync('installer.json', '{}');\n");
  git('switch', '-c', 'feature/example');
  const result = run([], { env: { TBS_PLUGIN: selected } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /update targets/);
  untouched();
});
