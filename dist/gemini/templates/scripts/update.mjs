#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
function newer(left, right) {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  const difference = a.findIndex((part, index) => part !== b[index]);
  return difference !== -1 && a[difference] > b[difference];
}

function children(dir) {
  try { return readdirSync(dir).sort().map(name => join(dir, name)); }
  catch { return []; }
}

function readJson(path) {
  if (!statSync(path).isFile()) throw new Error(`Expected a file at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function installedCopy(dir) {
  const installer = join(dir, 'bin/tbs-init');
  try {
    if (!statSync(installer).isFile()) return;
  } catch { return; }
  for (const manifest of ['.claude-plugin/plugin.json', 'gemini-extension.json']) {
    try {
      const { version } = readJson(join(dir, manifest));
      if (validVersion(version)) return { dir, installer, version };
    } catch { /* An unreadable manifest does not identify a version. */ }
  }
}

function findInstalled() {
  if (process.env.TBS_PLUGIN) return installedCopy(resolve(process.env.TBS_PLUGIN));

  const home = homedir();
  const claude = resolve(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'));
  const cache = dir => children(dir).flatMap(market => children(join(market, 'trust-before-scale')));
  const candidates = [
    ...cache(join(claude, 'plugins/cache')),
    ...children(join(claude, 'plugins/marketplaces')).map(dir => join(dir, 'plugins/trust-before-scale')),
    join(home, '.gemini/extensions/trust-before-scale'),
    ...cache(join(home, '.codex/plugins/cache')),
  ];
  let best;
  for (const dir of candidates) {
    const copy = installedCopy(dir);
    if (copy && (!best || newer(copy.version, best.version))) best = copy;
  }
  return best;
}

function hasCodexHook(root) {
  let entries;
  try { entries = readJson(join(root, '.codex/hooks.json')).hooks?.PreToolUse ?? []; }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  // Match the kit entry even when it points to a previous plugin location.
  return entries.some(entry => entry.matcher === 'Bash' && entry.hooks?.some(hook =>
    hook.type === 'command' && /hooks\/merge-gate\.py(?=["'\s]|$)/.test(hook.command ?? '')));
}

function main(args) {
  if (args.some(arg => !['--branch', '--codex-hook', '--dry-run'].includes(arg))) {
    throw new Error('Usage: node scripts/tbs/update.mjs [--branch] [--codex-hook] [--dry-run]');
  }
  // Clear inherited Git settings and keep status from refreshing the index during a dry run.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  env.GIT_OPTIONAL_LOCKS = '0';
  const git = (cwd, ...argv) => execFileSync('git', argv, { cwd, env, encoding: 'utf8' }).trim();
  const runNode = (cwd, ...argv) => {
    const result = spawnSync(process.execPath, argv, { cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
  };

  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const current = readFileSync(join(root, 'scripts/tbs/VERSION'), 'utf8').trim();
  if (!validVersion(current)) throw new Error('Expected a numeric version in scripts/tbs/VERSION.');
  const selected = findInstalled();
  if (!selected) {
    if (process.env.TBS_PLUGIN) console.error('TBS_PLUGIN does not point to an installed kit with a readable version.');
    console.error('Install or update the Trust before scale plugin, then retry.');
    console.error('Claude Code: claude plugin update trust-before-scale@trust-before-scale-kit');
    console.error('Gemini CLI: gemini extensions update trust-before-scale');
    console.error('Codex: install or refresh Trust before scale in /plugins.');
    return 1;
  }

  const dryRun = args.includes('--dry-run');
  const updatable = newer(selected.version, current);
  if (dryRun || process.env.TBS_PLUGIN) {
    if (dryRun) console.log(`Project kit version: ${current}.`);
    console.log(`Selected ${selected.dir} (${selected.version})${process.env.TBS_PLUGIN ? ' via TBS_PLUGIN' : ''}.`);
  }
  if (!updatable) {
    console.log(`Already on ${current} (newest installed: ${selected.version}).`);
    if (dryRun) console.log('Dry run: no branch action or update needed.');
    return 0;
  }

  if (git(root, 'status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=untracked')) {
    throw new Error('Tracked changes detected. Commit or stash them before updating.');
  }
  const branch = git(root, 'branch', '--show-current');
  const needsBranch = ['main', 'master', 'develop', ''].includes(branch);
  const nextBranch = `chore/tbs-kit-${selected.version}`;
  if (needsBranch && !args.includes('--branch')) {
    throw new Error(`Cannot update on ${branch || 'detached HEAD'}. Run: git switch -c ${nextBranch}`);
  }
  const installerArgs = ['--update'];
  if (args.includes('--codex-hook') || hasCodexHook(root)) installerArgs.push('--codex-hook');
  if (dryRun) {
    console.log(`Dry run: update ${current} → ${selected.version}; ${needsBranch ? `create ${nextBranch}` : `stay on ${branch}`}.`);
    console.log(`Would run tbs-init ${installerArgs.join(' ')} and node scripts/tbs/doctor.mjs.`);
    return 0;
  }

  if (needsBranch) git(root, 'switch', '-c', nextBranch);
  const installerStatus = runNode(root, selected.installer, ...installerArgs);
  if (installerStatus !== 0) return installerStatus;
  const doctorStatus = runNode(root, 'scripts/tbs/doctor.mjs');
  if (doctorStatus !== 0) console.error('Doctor failed. Resolve its findings before committing.');
  console.log("Review git diff, run the project's gates, commit, and open a PR.");
  return doctorStatus;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
