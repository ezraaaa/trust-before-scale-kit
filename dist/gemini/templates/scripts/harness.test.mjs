import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, validateConfig, REVIEW_RAN } from './config.mjs';
import { agentText, settingsHash } from './skill-eval.mjs';
const temporary = (fn) => { const root = mkdtempSync(join(tmpdir(), 'tbs-harness-')); try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };
test('config precedence and malformed config', () => temporary(root => {
  const put = (dir, text) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, 'trust-before-scale.json'), text); };
  put('.claude', '{"project":"legacy"}'); assert.equal(loadConfig(root).project, 'legacy');
  put('.agents', '{"project":"neutral"}'); assert.equal(loadConfig(root).project, 'neutral');
  put('.agents', '{'); assert.throws(() => loadConfig(root), /not valid JSON/);
}));
test('agent validation and self-merge defaults', () => {
  assert.doesNotThrow(() => validateConfig({evals:{suites:[{name:"review",skills:[]}]}}));
  for (const reviewer of Object.keys(REVIEW_RAN)) {
    assert.throws(() => validateConfig({evals:{suites:[{name:"review",skills:[],reviewer, judge:reviewer}]}}), /must differ/);
    assert.doesNotThrow(() => validateConfig({evals:{suites:[{name:"review",skills:[],reviewer, judge:reviewer, allowSameJudge:true}]}}));
    assert.equal(validateConfig({selfMerge:{review:{reviewer}}}).selfMerge.review.ranPattern, REVIEW_RAN[reviewer]);
  }
  assert.throws(() => validateConfig({evals:{suites:[{name:"review",skills:[],reviewer:'unknown'}]}}), /preset/);
  assert.notEqual(settingsHash({}), settingsHash({reviewer:'gemini'}));
});
test('preset dispatch and text extraction', () => temporary(root => {
  for (const agent of Object.keys(REVIEW_RAN)) {
    assert.equal(agentText(agent, 'Review this', 'feat/x', 'model-x', root, (command, args, options) => {
      assert.equal(command, agent); assert.ok(args.includes('model-x'));
      if (agent === 'codex') { assert.equal(options.input, 'Review this'); writeFileSync(args[args.indexOf('-o')+1], 'review'); }
      else assert.ok(args.includes('Review this'));
      return {status:0, stdout: agent === 'claude' ? '{"result":"review"}' : 'review'};
    }), 'review');
  }
}));
test('custom templates treat shell metacharacters as data', () => temporary(root => {
  const prompt = "a'b\n$(touch SHOULD-NOT-EXIST) {branch}";
  assert.equal(agentText("printf '%s' {prompt}", prompt, 'feat/x', undefined, root, (cmd,args,options) => spawnSync(cmd,args,{encoding:'utf8',...options})), prompt);
}));
