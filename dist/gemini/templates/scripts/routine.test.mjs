import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan, main, ORDER } from './routine.mjs';
import { validateConfig } from './config.mjs';
import { main as doctor } from './doctor.mjs';

const config = () => ({ level: 1, baseBranch: 'main', mergeGate: {}, routine: {
  rows: [
    { name: 'prose', paths: ['^docs/notes/'], passes: [], reason: 'Informational' },
    { name: 'tests-tooling', paths: ['^tools/'], passes: ['correctness', 'cross-review'], gates: true, reason: 'Executable tooling' },
    { name: 'ui', paths: ['^src/'], passes: [...ORDER], gates: true, reason: 'User visible' },
    { name: 'new', paths: ['^src/'], addedOnly: true, passes: ['design-audit','user-roles'], before: ['user-roles','design-audit'], reason: 'New surface' },
    { name: 'backend', paths: ['^server/'], passes: ['security','correctness'], reason: 'Access boundary' },
  ],
  passes: Object.fromEntries(ORDER.map(step => [step, { fallback: `kit ${step}` }])),
  ruleSources: [], designSystem: [], coreFlows: [], personas: [],
} });
const change = (path, status = 'M') => ({ path, status });
const temp = fn => { const root = mkdtempSync(join(tmpdir(),'tbs-routine-test-')); try { return fn(root); } finally { rmSync(root,{recursive:true,force:true}); } };
function repo(root) {
  const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  const put = (path, text = 'initial\n') => { mkdirSync(join(root,path,'..'),{recursive:true}); writeFileSync(join(root,path),text); };
  git('init','-q'); git('config','user.email','acme@example.invalid'); git('config','user.name','Acme');
  put('src/existing.js'); put('server/access.js'); git('add','.'); git('commit','-qm','Acme baseline');
  git('branch','-M','main'); git('update-ref','refs/remotes/origin/main','HEAD');
  return {git,put};
}
function jsonPlan(root, args = []) { let output; assert.equal(main(['plan', ...args, '--json'],{root,config:config(),log:s=>output=s}),0); return JSON.parse(output); }

test('union includes every matching row and preserves fixed order with reasons', () => {
  const result = plan(config(),[change('tools/check.js'),change('src/page.js','A'),change('server/read.js')]);
  assert.deepEqual(result.rows.map(r=>r.name),['tests-tooling','ui','new','backend']);
  assert.deepEqual(result.passes.map(p=>p.step),ORDER);
  assert.equal(result.passes[1].reasons.length,3);
  assert.deepEqual(result.before,['user-roles','design-audit']);
  assert.equal(result.level,'xhigh'); assert.equal(result.gates,true);
});
test('informational prose has neither passes nor gates', () => {
  const result=plan(config(),[change('docs/notes/acme.md')]); assert.deepEqual(result.passes,[]); assert.equal(result.gates,false);
});
test('tooling uses medium correctness and emits configured host commands', () => {
  const c=config(); c.routine.passes.correctness.codex='codex review --base {base}';
  const result=plan(c,[change('tools/check.js')]); assert.equal(result.level,'medium');
  assert.equal(result.passes[0].commands.codex,'codex review --base {base}');
});
test('new-surface preflight applies only to added files', () => {
  assert.deepEqual(plan(config(),[change('src/old.js')]).before,[]);
  assert.deepEqual(plan(config(),[change('src/new.js','A')]).before,['user-roles','design-audit']);
});
test('unmatched paths fail closed and an empty diff is an empty plan', () => {
  assert.throws(()=>plan(config(),[change('unknown/file')]),/Unclassified/);
  assert.deepEqual(plan(config(),[]).passes,[]);
  assert.throws(()=>plan({},[]),/not configured/);
});
test('doctor validates routine keys via shared loader without new CLI dependencies', () => {
  const lines=[]; assert.equal(doctor(['--ci'],{config:config(),probe:()=>'',log:s=>lines.push(s)}),0);
  const bad=config(); bad.routine.personas=[{role:'Acme staff',pressure:'busy',tasks:[]}];
  assert.equal(doctor(['--ci'],{config:bad,probe:()=>'',log:s=>lines.push(s)}),1);
  assert.match(lines.join('\n'),/routine.personas/);
});
for (const [name,mutate,pattern] of [
  ['unknown key', c=>c.routine.surprise=true,/unknown key/],
  ['bad regex', c=>c.routine.rows[0].paths=['['],/invalid path regex/],
  ['duplicate row', c=>c.routine.rows.push(c.routine.rows[0]),/duplicate name/],
  ['missing mapping', c=>delete c.routine.passes.security,/missing command mapping/],
  ['invalid pass', c=>c.routine.rows[0].passes=['merge'],/missing command mapping|unknown value/],
  ['missing fallback', c=>c.routine.passes.security={},/fallback: required/],
  ['before without after', c=>c.routine.rows[0].before=['design-audit'],/must also run after/],
  ['empty rows', c=>c.routine.rows=[],/must not be empty/],
  ['unknown host', c=>c.routine.passes.security.other='command',/unknown key/],
]) test(`config rejects ${name}`,()=>{const c=config();mutate(c);assert.throws(()=>validateConfig(c),pattern);});
for (const key of ['extension','ruleSources','designSystem','coreFlows']) test(`config rejects escaping routine.${key}`,()=>{
  const c=config(); c.routine[key]=key==='extension'?'../outside':['../outside'];assert.throws(()=>validateConfig(c),/invalid value/);
});
test('planner sees committed, staged, unstaged and untracked changes without writing',()=>temp(root=>{
  const {git,put}=repo(root); put('src/committed.js');git('add','.');git('commit','-qm','Acme page');
  put('tools/staged.js');git('add','tools/staged.js');put('src/existing.js','changed\n');put('src/new page\nname.js');
  const before=git('status','--porcelain'); const result=jsonPlan(root);
  const paths=new Set(result.rows.flatMap(r=>r.files));
  for(const path of ['src/committed.js','tools/staged.js','src/existing.js','src/new page\nname.js'])assert.ok(paths.has(path),path);
  assert.equal(result.head,git('rev-parse','HEAD')); assert.equal(result.dirty,true);
  assert.equal(git('status','--porcelain'),before);
}));
test('host JSON keeps plan metadata and lists each row reason once', () => temp(root => {
  const { git, put } = repo(root);
  put('src/new.js');
  const settings = config();
  const hosts = ['claude', 'codex', 'cursor-agent', 'gemini'];
  for (const host of hosts) settings.routine.passes.correctness[host] = `review with ${host}`;
  const base = 'origin/main';
  const legacy = { ...plan(settings, [change('src/new.js', 'A')], {
    base, head: git('rev-parse', 'HEAD'), range: `${base}...HEAD`,
  }), dirty: true };
  const output = (...args) => {
    let json;
    assert.equal(main(['plan', '--json', ...args], { root, config: settings, log: line => json = line }), 0);
    return json;
  };
  assert.equal(output(), JSON.stringify(legacy, null, 2));
  const before = git('status', '--porcelain');
  for (const host of hosts) {
    const compact = output('--host', host);
    const expected = {
      ...legacy,
      rows: [
        { name: 'ui', reason: 'User visible', files: ['src/new.js'] },
        { name: 'new', reason: 'New surface', files: ['src/new.js'] },
      ],
      passes: ORDER.map(step => ({
        step,
        rows: legacy.rows.filter(row => row.passes.includes(step)).map(row => row.name),
        commands: step === 'correctness'
          ? { [host]: `review with ${host}`, fallback: 'kit correctness' }
          : { fallback: `kit ${step}` },
      })),
    };
    assert.deepEqual(JSON.parse(compact), expected);
    for (const { reason } of expected.rows) assert.equal(compact.split(reason).length, 2);
  }
  assert.equal(git('status', '--porcelain'), before);
}));

test('CLI rejects an unknown host with exit 1', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./routine.mjs', import.meta.url)),
    'plan', '--json', '--host', 'other'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown host.*other/i);
  assert.equal(result.stdout, '');
});

test('moves retain old security surface and new UI requirements',()=>temp(root=>{
  const {git}=repo(root);git('mv','server/access.js','src/access.js');
  const result=jsonPlan(root,['--base','origin/main']);assert.ok(result.rows.some(r=>r.name==='backend'));
  assert.ok(result.rows.some(r=>r.name==='new'));assert.equal(result.level,'xhigh');
}));
test('merge-base excludes unrelated commits on the base',()=>temp(root=>{
  const {git,put}=repo(root);git('checkout','-qb','feature');put('tools/check.js');git('add','.');git('commit','-qm','Acme tool');
  git('checkout','main');put('unclassified-base-only');git('add','.');git('commit','-qm','Acme base change');git('checkout','feature');
  const result=jsonPlan(root,['--base','main']);assert.deepEqual(result.rows.map(r=>r.name),['tests-tooling']);assert.equal(result.dirty,false);
}));
test('bad refs and incomplete/unknown options fail without mutation',()=>temp(root=>{
  const {git}=repo(root);const before=git('rev-parse','HEAD');
  assert.throws(()=>jsonPlan(root,['--base','missing-ref']));
  for(const args of [[],['plan','--base'],['plan','--base','--json'],['plan','--execute']])assert.throws(()=>main(args,{root,config:config()}));
  assert.equal(git('rev-parse','HEAD'),before);
}));
test('CLI reads preferred config, supports legacy and rejects broken preferred config',()=>temp(root=>{
  const {put}=repo(root);put('.gitignore','.agents/\n.claude/\n');
  // Ignore config locations so they do not themselves create unclassified local paths.
  execFileSync('git',['add','.gitignore'],{cwd:root});execFileSync('git',['commit','-qm','Acme ignores'],{cwd:root});
  execFileSync('git',['update-ref','refs/remotes/origin/main','HEAD'],{cwd:root});
  put('.claude/trust-before-scale.json',JSON.stringify(config()));
  assert.equal(main(['plan'],{root,log:()=>{}}),0);
  put('.agents/trust-before-scale.json','broken');assert.throws(()=>main(['plan'],{root,log:()=>{}}),/not valid JSON/);
  put('.agents/trust-before-scale.json',JSON.stringify(config()));assert.equal(main(['plan'],{root,log:()=>{}}),0);
}));
