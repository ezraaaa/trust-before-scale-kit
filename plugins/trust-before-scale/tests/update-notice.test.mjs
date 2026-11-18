import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = fileURLToPath(new URL('../hooks/update-notice.mjs', import.meta.url));
const configPath = '.agents/trust-before-scale.json';
const versionPath = 'scripts/tbs/VERSION';
const hookPath = '.codex/hooks.json';
const day = 24 * 60 * 60 * 1000;

async function fixture(t) {
  const temp = mkdtempSync(join(realpathSync(tmpdir()), 'tbs-notice-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'project');
  mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const plugin = join(temp, 'installed kit');
  const script = join(plugin, 'hooks/update-notice.mjs');
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(source, script);
  const put = (path, contents) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  };
  put('../installed kit/.claude-plugin/plugin.json', '{"version":"1.10.0"}');
  const { notice } = await import(pathToFileURL(script).href);
  const check = options => notice(JSON.stringify({ cwd: root }), options);
  const run = (input, options = {}, host = 'claude') => {
    const result = spawnSync(process.execPath, [script, host], { cwd: root, input, encoding: 'utf8', timeout: 3000, ...options });
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    return result.stdout;
  };
  return { temp, root, plugin, put, check, run };
}

test('hook exits successfully and silently when the project cannot be checked or is current', async t => {
  const { temp, root, put, check, run } = await fixture(t);
  put(versionPath, '1.9.0');
  assert.equal(check(), undefined);
  put(configPath, '{}');
  assert.equal(run(JSON.stringify({ cwd: temp })), '');
  assert.equal(run('{malformed'), '');
  assert.equal(run('null'), '');
  put(configPath, '{malformed');
  assert.equal(check(), undefined);
  put(configPath, '{}');
  rmSync(join(root, versionPath));
  assert.equal(check(), undefined);
  for (const version of ['1.10.0', '1.11.0', '1.9beta']) {
    put(versionPath, version);
    assert.equal(check(), undefined, version);
  }
});

test('compares numeric components and gives the exact update command from the repo root', async t => {
  const { root, plugin, put, run } = await fixture(t);
  put('.claude/trust-before-scale.json', '{}');
  put(versionPath, '1.9.0\n');
  put('nested/file', '');
  const input = JSON.stringify({ cwd: join(root, 'nested') });
  const stdout = run(input, { env: { ...process.env, GIT_DIR: '/nonexistent' } });
  assert.ok(stdout, '1.9.0 should trigger a notice with 1.10.0 installed');
  const result = JSON.parse(stdout);
  assert.equal(result.systemMessage, `Trust before scale 1.10.0 is installed; this project uses 1.9.0. To update, on a new branch:\nFrom the repo root, run:\nnode "${plugin}/bin/tbs-init" --update\nThen run node scripts/tbs/doctor.mjs and the project's gates, and open a PR.\nRelease notes: https://github.com/ezraaaa/trust-before-scale-kit/releases/tag/v1.10.0`);
  assert.deepEqual(result.hookSpecificOutput, {
    hookEventName: 'SessionStart',
    additionalContext: result.systemMessage + "\nOffer to do this; do not update without the user's go-ahead.",
  });
  assert.deepEqual(JSON.parse(run('{}', {}, 'codex')), result);
  assert.deepEqual(JSON.parse(run('{}', {}, 'gemini')), {
    systemMessage: result.systemMessage,
    hookSpecificOutput: { additionalContext: result.hookSpecificOutput.additionalContext },
  });
});

test('adds --codex-hook only for an existing kit entry, including a moved kit', async t => {
  const { plugin, put, check } = await fixture(t);
  put(configPath, '{}');
  put(versionPath, '1.9.0');
  const configure = command => put(hookPath, JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] },
  }));
  configure('echo other');
  assert.ok(!check().systemMessage.includes('--codex-hook'));
  configure('python3 "/moved kit/hooks/merge-gate.py"');
  assert.ok(check().systemMessage.includes(`node "${plugin}/bin/tbs-init" --update --codex-hook\n`));
});

test('only an opted-in release check calls gh, shares the daily cache, and can stand alone', async t => {
  const { root, put, check } = await fixture(t);
  let calls = 0;
  const now = 2 * day;
  const runGh = (name, args, options) => {
    calls++;
    assert.equal(name, 'gh');
    assert.deepEqual(args, ['release', 'view', '--repo', 'ezraaaa/trust-before-scale-kit', '--json', 'tagName']);
    assert.equal(options.timeout, 2000);
    assert.equal(options.env.GH_PROMPT_DISABLED, '1');
    return '{"tagName":"v1.11.0"}';
  };
  put(versionPath, '1.10.0');
  for (const config of [{}, { updateCheck: { latestRelease: false } }]) {
    put(configPath, JSON.stringify(config));
    assert.equal(check({ runGh, now }), undefined);
  }
  assert.equal(calls, 0);
  put(configPath, '{"updateCheck":{"latestRelease":true}}');
  const result = check({ runGh, now });
  assert.match(result.systemMessage, /1\.11\.0 is available.*claude plugin marketplace update trust-before-scale-kit, then claude plugin update trust-before-scale@trust-before-scale-kit/);
  assert.deepEqual(check({ runGh, now: now + day - 1 }), result);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.git/tbs-latest-release.json'), 'utf8')),
    { checkedAt: now, latest: '1.11.0' });
  assert.equal(calls, 1);
  put(versionPath, '1.9.0');
  const both = check({ runGh, now: now + day, host: 'gemini' });
  assert.match(both.systemMessage, /1\.10\.0 is installed; this project uses 1\.9\.0/);
  assert.match(both.systemMessage, /1\.11\.0 is available.*gemini extensions update trust-before-scale/);
  assert.equal(calls, 2);
});

test('offline and missing gh checks stay quiet and count toward the daily limit', async t => {
  const { put, check } = await fixture(t);
  put(configPath, '{"updateCheck":{"latestRelease":true}}');
  put(versionPath, '1.10.0');
  let calls = 0;
  const runGh = () => {
    calls++;
    throw Object.assign(new Error('gh unavailable'), { code: calls === 1 ? 'ETIMEDOUT' : 'ENOENT' });
  };
  for (const now of [0, 1, day, day + 1]) assert.equal(check({ runGh, now }), undefined);
  assert.equal(calls, 2);
  put(versionPath, '1.9.0');
  assert.match(check({ runGh, now: day + 2 }).systemMessage, /this project uses 1\.9\.0/);
  assert.equal(calls, 2);
});

test('canonical and generated SessionStart hooks use the expected host command and timeout', () => {
  const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).hooks;
  const claude = read('../hooks/hooks.json');
  const codex = read('../hooks/codex.json');
  const cursor = read('../hooks/cursor.json');
  const gemini = read('../../../dist/gemini/hooks/hooks.json');
  const group = (matcher, root, suffix, timeout) => ({
    matcher, hooks: [{ type: 'command', command: `node "${root}/hooks/update-notice.mjs"${suffix}`, timeout }],
  });
  assert.deepEqual(claude.SessionStart, [group('startup|resume', '${CLAUDE_PLUGIN_ROOT}', '', 5)]);
  assert.deepEqual(codex.SessionStart, [group('startup|resume', '${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT}}', ' codex', 5)]);
  assert.deepEqual(gemini.SessionStart,
    ['startup', 'resume'].map(source => group(source, '${extensionPath}', ' gemini', 5000)));
  assert.equal(cursor.sessionStart, undefined);
});
