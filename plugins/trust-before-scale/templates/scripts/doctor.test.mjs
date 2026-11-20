import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './doctor.mjs';
import { gateCommandFor } from './codex-hook.mjs';
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
    assert.match(check()[0], /gate script is missing/);
    mkdirSync(join(root, 'kit dir/hooks'), { recursive: true });
    writeFileSync(join(root, 'kit dir/hooks/merge-gate.py'), '');
    hookFile(join(root, 'kit dir/hooks/merge-gate.py'));
    assert.deepEqual(check(), []);
    const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const lookalike = `if f="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/tbs/merge-gate.py" && [ -f "$f" ]; then exec python3 -I -c 'x' "$f" "${emptyDigest}" "note"; fi`;
    const command = gateCommandFor(emptyDigest);
    mkdirSync(join(root, 'scripts/tbs'), { recursive: true });
    writeFileSync(join(root, 'scripts/tbs/merge-gate.py'), '');
    writeFileSync(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: lookalike }] }] } }));
    assert.match(check()[0], /--update --codex-hook/);
    rmSync(join(root, 'scripts/tbs/merge-gate.py'));
    writeFileSync(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } }));
    assert.match(check()[0], /--update --codex-hook/);
    mkdirSync(join(root, 'scripts/tbs'), { recursive: true });
    writeFileSync(join(root, 'scripts/tbs/merge-gate.py'), '');
    assert.deepEqual(check(), []);
    writeFileSync(join(root, 'scripts/tbs/merge-gate.py'), '# edited on a branch\n');
    assert.match(check()[0], /missing or changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('doctor reports the missing level and accepts a project-kept feature map at level 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'tbs-doctor-map-'));
  try {
    const run = (config) => { const logs = []; const code = main([], { root, config: { project: 'test', mergeGate: {}, evals: { suites: [] }, ...config }, probe: () => '', log: line => logs.push(line) }); return { code, logs }; };
    mkdirSync(join(root, '.claude'));
    const configPath = join(root, '.claude', 'trust-before-scale.json');
    writeFileSync(configPath, JSON.stringify({ project: 'test', mergeGate: {} }));
    const logs = [];
    const code = main([], { root, probe: () => '', log: line => logs.push(line) });
    assert.ok(logs.includes(`NOTE level not set: treated as level 1 (scripts and autopilot). Set "level": <1-4> in ${configPath} to opt in to more.`), logs.join('\n'));
    assert.ok(logs.includes('PASS config (level 1)'));
    assert.equal(code, 0, logs.join('\n'));
    assert.ok(!logs.some(l => /FAIL.*feature map configured/.test(l)), logs.join('\n'));
    // Owner decision 19 Nov 2026: a project may keep its own feature map, as lanes.mjs accepts.
    const explicit = run({ level: 2 });
    assert.equal(explicit.code, 0, explicit.logs.join('\n'));
    assert.ok(explicit.logs.includes("NOTE feature map not configured in the kit: not checked (the project may keep its own). To use the kit's: add featureMap.sources"), explicit.logs.join('\n'));
    // A configured kit map is still checked.
    const configured = run({ level: 2, featureMap: { file: 'docs/feature-map.json', sources: [{ dir: 'missing-src', ext: '.tsx', item: 'x', id: '{item}' }] } });
    assert.equal(configured.code, 1, configured.logs.join('\n'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('doctor reports the vendored version and warns when the installed plugin is newer', () => {
  const root = mkdtempSync(join(tmpdir(), 'tbs-doctor-version-'));
  try {
    mkdirSync(join(root, 'scripts/tbs'), { recursive: true });
    const plugin = join(root, 'kit');
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    writeFileSync(join(plugin, '.claude-plugin/plugin.json'), '{"version":"1.10.0"}');
    const check = (version, pluginPath = plugin) => {
      writeFileSync(join(root, 'scripts/tbs/VERSION'), version + '\n');
      const logs = [];
      assert.equal(main([], { root, plugin: pluginPath, config: { project: 'test', level: 1, mergeGate: {} },
        probe: () => '', log: line => logs.push(line) }), 0);
      return logs;
    };
    const behind = check('1.9.0');
    assert.ok(behind.includes('NOTE kit 1.9.0'));
    assert.ok(behind.includes('WARN project kit 1.9.0 is older than installed plugin 1.10.0. Next: node "$TBS_PLUGIN/bin/tbs-init" --update'));
    const ahead = check('1.11.0');
    assert.ok(ahead.includes('NOTE kit 1.11.0'));
    assert.ok(ahead.includes('NOTE installed kit plugin 1.10.0'));
    assert.ok(!ahead.some(line => line.startsWith('WARN project kit')));
    assert.ok(!check('1.9.0', '').some(line => line.includes('installed plugin')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
