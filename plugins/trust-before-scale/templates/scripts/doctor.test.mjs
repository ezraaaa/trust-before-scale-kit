import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './doctor.mjs';
test('Codex hook warning is advisory and gives the installer command', () => {
  const root = mkdtempSync(join(tmpdir(), 'tbs-doctor-'));
  try {
    const check = () => {
      const logs = [];
      const code = main([], { root, config: { project: 'test', level: 1, mergeGate: {} }, probe: () => '', log: line => logs.push(line) });
      assert.equal(code, 0, logs.join('\n'));
      return logs.filter(line => line.startsWith('WARN'));
    };
    assert.deepEqual(check(), []);
    mkdirSync(join(root, '.codex'));
    assert.match(check()[0], /--update --codex-hook/);
    for (const contents of ['invalid', '{}', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }] } })]) {
      writeFileSync(join(root, '.codex/hooks.json'), contents); assert.equal(check().length, 1);
    }
    const hookFile = (script) => writeFileSync(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `python3 "${script}"` }] }] } }));
    hookFile('/moved kit/hooks/merge-gate.py');
    assert.match(check()[0], /moved plugin/);
    mkdirSync(join(root, 'kit dir/hooks'), { recursive: true });
    writeFileSync(join(root, 'kit dir/hooks/merge-gate.py'), '');
    hookFile(join(root, 'kit dir/hooks/merge-gate.py'));
    assert.deepEqual(check(), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a legacy config without level may keep its own feature map; an explicit level must configure one', () => {
  const root = mkdtempSync(join(tmpdir(), 'tbs-doctor-map-'));
  try {
    const run = (config) => { const logs = []; const code = main([], { root, config: { project: 'test', mergeGate: {}, evals: { suites: [] }, ...config }, probe: () => '', log: line => logs.push(line) }); return { code, logs }; };
    const legacy = run({});
    assert.ok(legacy.logs.some(l => l.startsWith('NOTE feature map not configured in the kit')), legacy.logs.join('\n'));
    assert.ok(!legacy.logs.some(l => /FAIL.*feature map configured/.test(l)), legacy.logs.join('\n'));
    const explicit = run({ level: 2 });
    assert.equal(explicit.code, 1);
    assert.ok(explicit.logs.some(l => /feature map configured/.test(l) && !l.startsWith('PASS')), explicit.logs.join('\n'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
