#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';

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

// The kit's Codex hook command, copied from codex-hook.mjs: update.mjs stays self-contained because it
// may run beside stale scripts. update.test.mjs fails if the two copies differ.
const gateTarget = "scripts/tbs/merge-gate.py";
const gateNote = (digest) => `trust-before-scale: merge gate at ${gateTarget} is missing or differs from sha256 ${digest}; command not checked. Run the kit update with --codex-hook, then trust the hook again.`;
function gateCommandFor(digest) {
  const runner = `python3 -I -c 'import hashlib,sys;p=sys.argv[1];d=open(p,"rb").read().replace(b"\\r\\n",b"\\n");hashlib.sha256(d).hexdigest()!=sys.argv[2] and (print(sys.argv[3],file=sys.stderr),sys.exit(0));sys.argv=[p];exec(compile(d,p,"exec"),{"__name__":"__main__","__file__":p})' "$f" "${digest}" "${gateNote(digest)}"`;
  return `if f="$(git rev-parse --show-toplevel 2>/dev/null)/${gateTarget}" && [ -f "$f" ]; then exec ${runner}; fi; echo "${gateNote(digest)}" >&2`;
}
const gateParts = gateCommandFor('DIGEST').split('DIGEST').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const kitGateCommand = new RegExp(`^${gateParts[0]}[0-9a-f]{64}${gateParts.slice(1).join('[0-9a-f]{64}')}$`);

function hasCodexHook(root) {
  let entries;
  try { entries = readJson(join(root, '.codex/hooks.json')).hooks?.PreToolUse ?? []; }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  // Match the kit entry even when it points to a previous plugin location.
  return entries.some(entry => entry.matcher === 'Bash' && entry.hooks?.some(hook =>
    hook.type === 'command' && (/^python3\s+["']?(?:[A-Za-z]:)?[\\/][\s\S]*[\\/]hooks[\\/]+merge-gate\.py["']?$/.test(hook.command ?? '') ||
      kitGateCommand.test(hook.command ?? ''))));
}

function main(args) {
  let branchName;
  const flags = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--branch-name' && !branchName && args[index + 1] && !args[index + 1].startsWith('-')) {
      branchName = args[++index];
    } else if (['--branch', '--codex-hook', '--dry-run'].includes(arg)) {
      flags.add(arg);
    } else {
      throw new Error('Usage: node scripts/tbs/update.mjs [--branch [--branch-name <name>]] [--codex-hook] [--dry-run]');
    }
  }
  const createBranch = flags.has('--branch');
  if (branchName && !createBranch) throw new Error('--branch-name requires --branch.');
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
  // Branch mode decides on the fetched base's version, so this checkout's own version is optional there.
  let current;
  try { current = readFileSync(join(root, 'scripts/tbs/VERSION'), 'utf8').trim(); }
  catch (error) { if (error.code !== 'ENOENT' || !createBranch) throw error; }
  if (!createBranch && !validVersion(current)) throw new Error('Expected a numeric version in scripts/tbs/VERSION.');
  const selected = findInstalled();
  if (!selected) {
    if (process.env.TBS_PLUGIN) console.error('TBS_PLUGIN does not point to an installed kit with a readable version.');
    console.error('Install or update the Trust before scale plugin, then retry.');
    console.error('Claude Code: claude plugin update trust-before-scale@trust-before-scale-kit');
    console.error('Gemini CLI: gemini extensions update trust-before-scale');
    console.error('Codex: install or refresh Trust before scale in /plugins.');
    return 1;
  }

  const dryRun = flags.has('--dry-run');
  const updatable = !validVersion(current) || newer(selected.version, current);
  if (dryRun || process.env.TBS_PLUGIN) {
    if (dryRun) console.log(`Project kit version: ${current ?? 'not installed in this checkout'}.`);
    console.log(`Selected ${selected.dir} (${selected.version})${process.env.TBS_PLUGIN ? ' via TBS_PLUGIN' : ''}.`);
  }
  // Branch mode starts from the fetched base, so the base's version decides there, after the fetch.
  if (!updatable && !createBranch) {
    console.log(`Already on ${current} (newest installed: ${selected.version}).`);
    if (dryRun) console.log('Dry run: no branch action or update needed.');
    return 0;
  }

  if (git(root, 'status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=untracked')) {
    throw new Error('Tracked changes detected. Commit or stash them before updating.');
  }
  const optionalGit = (...argv) => {
    const result = spawnSync('git', argv, { cwd: root, env, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status === 1) return undefined;
    if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(' ')} failed`);
    return result.stdout.trim();
  };
  const branch = git(root, 'branch', '--show-current');
  const develop = optionalGit('config', '--get', 'gitflow.branch.develop');
  const production = optionalGit('config', '--get', 'gitflow.branch.master');
  // Without git-flow config, a repository with a develop branch still works git-flow style: use feature/.
  const hasDevelopRef = () => ['refs/heads/develop', 'refs/remotes/origin/develop']
    .some(ref => optionalGit('show-ref', '--verify', '--quiet', ref) !== undefined);
  const branchFor = () => branchName ??
    `${optionalGit('config', '--get', 'gitflow.prefix.feature') ?? (develop || hasDevelopRef() ? 'feature/' : 'chore/')}tbs-kit-${selected.version}`;
  let nextBranch = branchFor();
  if (!createBranch && ['', 'main', 'master', 'develop', develop, production].includes(branch)) {
    const hint = `node scripts/tbs/update.mjs --branch${flags.has('--codex-hook') ? ' --codex-hook' : ''}`;
    throw new Error(`Cannot update on ${branch || 'detached HEAD'}. Run: ${hint} (creates ${nextBranch})`);
  }

  const checkTargets = () => {
    const installerArgs = ['--update'];
    if (flags.has('--codex-hook') || hasCodexHook(root)) installerArgs.push('--codex-hook');
    // Earlier installers ignore unknown flags and would install in the current directory.
    const scratch = mkdtempSync(join(realpathSync(tmpdir()), 'tbs-targets-'));
    let targets;
    try {
      const result = spawnSync(process.execPath, [selected.installer, ...installerArgs, '--list-targets'],
        { cwd: scratch, env: { ...env, GIT_CEILING_DIRECTORIES: dirname(scratch) }, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
      targets = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`Could not list installed tbs-init update targets: ${error.message}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    if (!Array.isArray(targets) || !targets.length || targets.some(path => typeof path !== 'string' ||
        !path || posix.isAbsolute(path) || path.split('/').some(part => ['.', '..', ''].includes(part)))) {
      throw new Error('Installed tbs-init did not provide valid update targets.');
    }
    const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, env, encoding: 'utf8' }).split('\0'));
    const conflicts = new Set();
    for (const target of targets) {
      for (let path = target; path !== '.'; path = dirname(path)) {
        let stat;
        try { stat = lstatSync(join(root, path)); }
        catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
          throw error;
        }
        if (stat.isSymbolicLink() || (path === target ? !tracked.has(path) || !stat.isFile() : !stat.isDirectory())) {
          conflicts.add(path);
        }
      }
    }
    if (conflicts.size) throw new Error(`Cannot update over untracked or unsafe installer paths:\n${[...conflicts].map(path => `- ${path}`).join('\n')}`);
    return installerArgs;
  };

  // A real branch run checks targets only once it knows the fetched base needs an update.
  let installerArgs = createBranch && !dryRun ? undefined : checkTargets();
  if (createBranch) {
    if (!optionalGit('config', '--get', 'remote.origin.url')) throw new Error('Cannot create an update branch: no origin remote.');
    git(root, 'check-ref-format', '--branch', nextBranch);
  }
  if (dryRun) {
    console.log(createBranch
      ? `Dry run: after fetching origin, create ${nextBranch} (name provisional until the fetch) from the integration branch and update it to ${selected.version} if its kit is older.`
      : `Dry run: update ${current} → ${selected.version}; stay on ${branch}.`);
    console.log(`Would run tbs-init ${installerArgs.join(' ')} and node scripts/tbs/doctor.mjs.`);
    return 0;
  }

  if (createBranch) {
    const fetched = spawnSync('git', ['fetch', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*'],
      { cwd: root, env, encoding: 'utf8' });
    if (fetched.status !== 0) throw new Error(`Cannot fetch origin: ${fetched.error?.message ?? fetched.stderr.trim()}`);
    const hasDevelop = optionalGit('show-ref', '--verify', '--quiet', 'refs/remotes/origin/develop') !== undefined;
    const integration = develop || (hasDevelop ? 'develop' : undefined) ||
      git(root, 'ls-remote', '--symref', 'origin', 'HEAD').match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
    if (!integration) throw new Error('Cannot determine the default branch on origin.');
    const baseRef = `refs/remotes/origin/${integration}`;
    if (optionalGit('show-ref', '--verify', '--quiet', baseRef) === undefined) {
      throw new Error(`Integration branch origin/${integration} was not found after fetching origin.`);
    }
    // The branch starts from the fetched base, not this checkout: never update a base that already has
    // this kit version or a newer one (a downgrade), nor one whose version cannot be read. Pin the commit
    // once, so a concurrent fetch cannot move the branch point after the check.
    const baseCommit = git(root, 'rev-parse', '--verify', `${baseRef}^{commit}`);
    const baseFile = spawnSync('git', ['show', `${baseCommit}:scripts/tbs/VERSION`], { cwd: root, env, encoding: 'utf8' });
    const baseVersion = baseFile.status === 0 ? baseFile.stdout.trim() : undefined;
    if (!baseVersion || !validVersion(baseVersion)) {
      throw new Error(`origin/${integration} has no valid scripts/tbs/VERSION; cannot tell whether this would downgrade it. Update in place on a feature branch (omit --branch).`);
    }
    if (!newer(selected.version, baseVersion)) {
      console.log(`origin/${integration} already has ${baseVersion} (newest installed: ${selected.version}); no update branch created.`);
      return 0;
    }
    checkTargets();
    nextBranch = branchFor();
    git(root, 'check-ref-format', '--branch', nextBranch);
    git(root, 'switch', '--no-overwrite-ignore', '--no-track', '-c', nextBranch, baseCommit);
    installerArgs = checkTargets();
  }
  const installerStatus = runNode(root, selected.installer, ...installerArgs);
  if (installerStatus !== 0) return installerStatus;
  const doctorStatus = runNode(root, 'scripts/tbs/doctor.mjs');
  if (doctorStatus !== 0) console.error('Doctor failed. Resolve its findings before committing.');
  console.log("Review git diff, run the project's gates, commit, and open a PR.");
  return doctorStatus;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
