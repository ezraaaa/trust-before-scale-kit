import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../templates/scripts/config.mjs';
const plugin = fileURLToPath(new URL('../', import.meta.url));
for (const distribution of [plugin, resolve(plugin, "../../dist/gemini")])
for (const legacy of [false, true]) test(`fresh ${distribution === plugin ? "plugin" : "Gemini tree"} install with ${legacy ? 'legacy' : 'agents'} config`, () => {
  const root = mkdtempSync(join(tmpdir(), 'tbs-install-'));
  try {
    execFileSync('git', ['init', '-q'], {cwd:root});
    if (legacy) { mkdirSync(join(root,'.claude')); writeFileSync(join(root,'.claude/trust-before-scale.json'), '{"project":"keep"}'); }
    execFileSync(process.execPath, [resolve(distribution,'bin/tbs-init'),'generic'], {cwd:root});
    assert.ok(existsSync(join(root,legacy ? '.claude' : '.agents','trust-before-scale.json')));
    if (legacy) { assert.equal(loadConfig(root).project,'keep'); assert.ok(!existsSync(join(root,'.agents/trust-before-scale.json'))); }
    else assert.ok(loadConfig(root));
    execFileSync(process.execPath,['--test','scripts/tbs/tbs.test.mjs','scripts/tbs/harness.test.mjs'],{cwd:root,stdio:'pipe'});
    const result = spawnSync('python3',[resolve(distribution,'hooks/merge-gate.py')],{input:JSON.stringify({cwd:root,hook_event_name:'PreToolUse',tool_input:{command:'gh pr merge 1'}}),encoding:'utf8'});
    assert.equal(result.status,2); assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,'deny');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('Claude plugin contains no nested plugin distribution', () => {
  function visit(directory) {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      if (!entry.isDirectory()) continue;
      if (directory !== plugin) assert.ok(!['.claude-plugin', 'skills', 'profiles', 'templates'].includes(entry.name), resolve(directory, entry.name));
      visit(resolve(directory, entry.name));
    }
  }
  visit(plugin);
});
