import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync, realpathSync } from 'node:fs';
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
test('fresh hook write and repeated installs/updates are idempotent', () => fixture(root => {
  assert.match(install(root), /trust.*\/hooks/);
  const hooks = read(root);
  assert.deepEqual(hooks, { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `python3 "${join(plugin, 'hooks/merge-gate.py')}"`, timeout: 10 }] }] } });
  install(root); assert.deepEqual(read(root), hooks);
  install(root, ['--update', '--codex-hook']); assert.deepEqual(read(root), hooks);
}));
test('preserves unrelated hooks and metadata; replaces all old kit entries on update', () => fixture(root => {
  mkdirSync(join(root, '.codex'));
  writeFileSync(join(root, '.codex/hooks.json'), JSON.stringify({ extra: true, hooks: {
    Stop: [unrelated], PreToolUse: [unrelated, { matcher: 'Bash', extra: 1, hooks: [
      { type: 'command', command: 'python3 "/old kit/hooks/merge-gate.py"' },
      { type: 'command', command: 'echo shared' },
    ] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 /other/hooks/merge-gate.py' }] }],
  } }));
  install(root, ['--update', '--codex-hook']);
  const hooks = read(root);
  assert.equal(hooks.extra, true); assert.deepEqual(hooks.hooks.Stop, [unrelated]);
  assert.deepEqual(hooks.hooks.PreToolUse.slice(0, 2), [unrelated, { matcher: 'Bash', extra: 1, hooks: [{ type: 'command', command: 'echo shared' }] }]);
  assert.equal(hooks.hooks.PreToolUse.length, 3);
  install(root, ['--update', '--codex-hook']); assert.deepEqual(read(root), hooks);
}));
test('moving plugin path replaces the installed command and quotes shell metacharacters', () => fixture(root => {
  install(root);
  const moved = join(root, 'kit space $dollar `tick` "quote"');
  cpSync(plugin, moved, { recursive: true });
  install(root, ['--update', '--codex-hook'], moved);
  const entries = read(root).hooks.PreToolUse;
  assert.equal(entries.length, 1);
  const command = entries[0].hooks[0].command;
  // Replace python with printf to verify shell parsing without invoking the gate.
  assert.equal(execFileSync('/bin/sh', ['-c', command.replace(/^python3 /, "printf '%s' ")], { encoding: 'utf8' }), join(realpathSync(moved), 'hooks/merge-gate.py'));
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
