import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../templates/scripts/config.mjs';
const plugin = fileURLToPath(new URL('../', import.meta.url));
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'tbs-codex-'));
  try { execFileSync('git', ['init', '-q'], { cwd: root }); run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
const install = (root, args = ['generic', '--codex-hook'], source = plugin) =>
  execFileSync(process.execPath, [join(source, 'bin/tbs-init'), ...args], { cwd: root, encoding: 'utf8' });
const read = root => JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
const unrelated = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep' }] };
const gate = 'scripts/tbs/merge-gate.py';
const runHook = (root, command) => spawnSync('/bin/sh', ['-c', read(root).hooks.PreToolUse[0].hooks[0].command], {
  cwd: join(root, 'scripts'), encoding: 'utf8', input: JSON.stringify({ cwd: root, tool_input: { command } }),
});
test('fresh hook write and repeated installs/updates are idempotent', () => fixture(root => {
  assert.match(install(root), /trust.*\/hooks/);
  const hooks = read(root);
  const { command, type, timeout } = hooks.hooks.PreToolUse[0].hooks[0];
  assert.equal(type, 'command'); assert.equal(timeout, 10);
  assert.match(command, /scripts\/tbs\/merge-gate\.py/);
  assert.doesNotMatch(command.replace('/dev/null', ''), /(?:^|[\s"'])\//);
  assert.deepEqual(readFileSync(join(root, gate)), readFileSync(join(plugin, 'hooks/merge-gate.py')));
  assert.ok(JSON.parse(install(root, ['--update', '--list-targets'])).includes(gate));
  install(root); assert.deepEqual(read(root), hooks);
  install(root, ['--update', '--codex-hook']); assert.deepEqual(read(root), hooks);
}));
test('preserves unrelated hooks and metadata; replaces all old kit entries on update', () => fixture(root => {
  mkdirSync(join(root, '.codex'));
  writeFileSync(join(root, '.codex/hooks.json'), JSON.stringify({ extra: true, hooks: {
    Stop: [unrelated], PreToolUse: [unrelated, { matcher: 'Bash', extra: 1, hooks: [
      { type: 'command', command: 'python3 "/old kit/hooks/merge-gate.py"' },
      { type: 'command', command: 'echo shared' },
    ] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 /other/hooks/merge-gate.py' }] },
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 "C:\\\\Users\\\\me\\\\kit\\\\hooks\\\\merge-gate.py"' }] }],
  } }));
  install(root);
  const hooks = read(root);
  assert.equal(hooks.extra, true); assert.deepEqual(hooks.hooks.Stop, [unrelated]);
  assert.deepEqual(hooks.hooks.PreToolUse.slice(0, 2), [unrelated, { matcher: 'Bash', extra: 1, hooks: [{ type: 'command', command: 'echo shared' }] }]);
  assert.equal(hooks.hooks.PreToolUse.length, 3);
  assert.match(hooks.hooks.PreToolUse[2].hooks[0].command, /scripts\/tbs\/merge-gate\.py/);
  install(root, ['--update', '--codex-hook']); assert.deepEqual(read(root), hooks);
}));
test('preserves unrelated commands that mention the old gate path', () => fixture(root => {
  const report = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "/old kit/hooks/merge-gate.py"' }] };
  mkdirSync(join(root, '.codex'));
  writeFileSync(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [report] } }));
  install(root);
  assert.deepEqual(read(root).hooks.PreToolUse[0], report);
}));
test('moving the plugin leaves the vendored gate enforcing merges', () => fixture(root => {
  const project = join(root, 'project space $dollar');
  mkdirSync(project);
  execFileSync('git', ['init', '-q'], { cwd: project });
  const source = join(root, 'kit');
  cpSync(plugin, source, { recursive: true });
  install(project, ['generic', '--codex-hook'], source);
  renameSync(source, join(root, 'moved kit'));
  const harmless = runHook(project, 'ls');
  assert.equal(harmless.status, 0, harmless.stderr);
  const merge = runHook(project, 'gh pr merge 1 --squash');
  assert.equal(merge.status, 2, merge.stderr);
  assert.match(merge.stderr, /--match-head-commit/);
}));
test('missing vendored gate allows the command and prints a note', () => fixture(root => {
  install(root);
  rmSync(join(root, gate), { force: true });
  const result = runHook(root, 'gh pr merge 1 --squash');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /merge gate not found at scripts\/tbs\/merge-gate\.py.*command not checked/);
}));
test('malformed JSON and invalid hook structure stop without overwriting or installing files', () => fixture(root => {
  mkdirSync(join(root, '.codex'));
  for (const data of ['{broken', '{"hooks":{"PreToolUse":{}}}']) {
    writeFileSync(join(root, '.codex/hooks.json'), data);
    const result = spawnSync(process.execPath, [join(plugin, 'bin/tbs-init'), 'generic', '--codex-hook'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /Cannot update .codex\/hooks.json/);
    assert.equal(readFileSync(join(root, '.codex/hooks.json'), 'utf8'), data);
    assert.equal(existsSync(join(root, 'scripts')), false);
  }
}));
test('hook installation is opt in', () => fixture(root => {
  install(root, ['generic']); assert.equal(existsSync(join(root, '.codex')), false);
}));
