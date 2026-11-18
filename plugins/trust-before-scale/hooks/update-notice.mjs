#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const plugin = resolve(dirname(script), '..');
const repository = 'ezraaaa/trust-before-scale-kit';
const day = 24 * 60 * 60 * 1000;
const gitVariables = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX',
  'GIT_NAMESPACE', 'GIT_QUARANTINE_PATH',
];
function readText(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Expected a regular file');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}
const readJson = path => JSON.parse(readText(path));
const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
function older(left, right) {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  const difference = a.findIndex((part, index) => part !== b[index]);
  return difference !== -1 && a[difference] < b[difference];
}

const releaseCommands = {
  claude: 'Run claude plugin marketplace update trust-before-scale-kit, then claude plugin update trust-before-scale@trust-before-scale-kit.',
  codex: 'For a Git marketplace, run codex plugin marketplace upgrade trust-before-scale-kit. For a local marketplace, update its checkout. Then refresh the kit in /plugins.',
  gemini: 'Run gemini extensions update trust-before-scale.',
};

function latestRelease(commonDir, env, runGh, now) {
  const cache = join(commonDir, 'tbs-latest-release.json');
  const lock = cache + '.lock';
  const recent = () => {
    try {
      const entry = readJson(cache);
      if (Number.isFinite(entry.checkedAt) && now - entry.checkedAt < day) return entry;
    } catch { /* An absent or unreadable cache is a miss. */ }
  };
  try {
    const cached = recent();
    if (cached) return cached.latest;
    const fd = openSync(lock, 'wx', 0o600);
    try {
      const claimed = recent();
      if (claimed) return claimed.latest;
      // Claim the attempt before running gh, even if gh is missing or offline.
      writeFileSync(cache, JSON.stringify({ checkedAt: now }), { mode: 0o600 });
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
    const { tagName } = JSON.parse(runGh('gh', ['release', 'view', '--repo', repository, '--json', 'tagName'], {
      env: { ...env, GH_PROMPT_DISABLED: '1' }, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
    }));
    const latest = typeof tagName === 'string' ? tagName.replace(/^v/, '') : '';
    if (!version(latest)) return;
    const pending = cache + '.' + process.pid;
    try {
      writeFileSync(pending, JSON.stringify({ checkedAt: now, latest }), { mode: 0o600, flag: 'wx' });
      renameSync(pending, cache);
    } finally {
      rmSync(pending, { force: true });
    }
    return latest;
  } catch { /* Release checks are advisory, including concurrent attempts. */ }
}

function hasCodexHook(root) {
  const path = join(root, '.codex/hooks.json');
  if (!existsSync(path)) return false;
  const entries = readJson(path).hooks?.PreToolUse ?? [];
  return entries.some(entry => entry.matcher === 'Bash' && entry.hooks?.some(hook =>
    hook.type === 'command' && /hooks\/merge-gate\.py(?=["'\s]|$)/.test(hook.command ?? '')));
}

export function notice(input, { host = 'claude', runGh = execFileSync, now = Date.now(), deadline = performance.now() + 900 } = {}) {
  try {
    const payload = JSON.parse(input);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const cwd = payload.cwd ?? process.cwd();
    const env = { ...process.env };
    for (const name of gitVariables) delete env[name];
    const git = (directory, ...args) => execFileSync('git', ['rev-parse', ...args], {
      cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: Math.max(1, Math.floor(deadline - performance.now())),
      killSignal: 'SIGKILL',
    }).trim();
    const root = git(cwd, '--show-toplevel');
    const configPath = ['.agents', '.claude'].map(dir => join(root, dir, 'trust-before-scale.json')).find(existsSync);
    if (!configPath) return;
    const config = readJson(configPath);
    if (!config || typeof config !== 'object' || Array.isArray(config)) return;
    const project = readText(join(root, 'scripts/tbs/VERSION')).trim();
    const installed = readJson(join(plugin, '.claude-plugin/plugin.json')).version;
    if (!version(project) || !version(installed)) return;

    const messages = [];
    if (older(project, installed)) {
      let instructions;
      if (existsSync(join(root, 'scripts/tbs/update.mjs'))) {
        const skill = host === 'claude'
          ? 'run /trust-before-scale:update in Claude Code (or ask your agent to use the update skill)'
          : 'ask your agent to use the update skill';
        instructions = `To update, ${skill}, or in a terminal: node scripts/tbs/update.mjs --branch`;
      } else {
        const path = join(plugin, 'bin/tbs-init').replace(/[\\"$`]/g, '\\$&');
        const flag = hasCodexHook(root) ? ' --codex-hook' : '';
        instructions = `To update, on a new branch:\nFrom the repo root, run:\nnode "${path}" --update${flag}\n` +
          "Then run node scripts/tbs/doctor.mjs and the project's gates, and open a PR.\n" +
          'After this update, future updates are just node scripts/tbs/update.mjs.';
      }
      messages.push(`Trust before scale ${installed} is installed; this project uses ${project}. ${instructions}\n` +
        `Release notes: https://github.com/${repository}/releases/tag/v${installed}`);
    }
    if (config.updateCheck?.latestRelease === true) {
      const commonDir = git(root, '--path-format=absolute', '--git-common-dir');
      const latest = latestRelease(commonDir, env, runGh, now);
      if (version(latest) && older(installed, latest)) {
        messages.push(`Trust before scale ${latest} is available; the installed plugin is ${installed}. ${releaseCommands[host]}`);
      }
    }
    if (!messages.length) return;
    const systemMessage = messages.join('\n\n');
    const additionalContext = systemMessage + "\nOffer to do this; do not update without the user's go-ahead.";
    const hookSpecificOutput = host === 'gemini' ? { additionalContext } : { hookEventName: 'SessionStart', additionalContext };
    return { systemMessage, hookSpecificOutput };
  } catch { /* Startup continues silently if any local check fails. */ }
}

function isMain() {
  try { return realpathSync(process.argv[1]) === script; }
  catch { return false; }
}

if (isMain()) {
  const deadline = performance.now() + 900;
  const timer = setTimeout(() => process.stdin.destroy(), 900);
  try {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 64 * 1024) break;
    }
    if (input.length <= 64 * 1024 && performance.now() < deadline) {
      const result = notice(input, { host: process.argv[2] ?? 'claude', deadline });
      if (result) console.log(JSON.stringify(result));
    }
  } catch { /* A hook input or output error is advisory. */ }
  finally { clearTimeout(timer); }
}
