import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as evaluate, judged, loadCases, casesHash, skillHash, settingsHash } from './skill-eval.mjs';
import { laneAllowance } from './lanes.mjs';
import { run } from './self-merge.mjs';
import { loadConfig, validateConfig } from './config.mjs';
function temporary(fn) {
 const root = mkdtempSync(join(tmpdir(), 'tbs-issues-'));
 try { execFileSync('git', ['init', '-q', root]); execFileSync('git', ['config', 'user.name', 'Tester'], {cwd:root}); execFileSync('git', ['config', 'user.email', 'test@example.invalid'], {cwd:root}); fn(root); }
 finally { rmSync(root, {recursive:true, force:true}); }
}
test('one loader rejects invalid preferred config; level guards precede agent and merge calls', () => temporary(root => {
 mkdirSync(join(root,'.agents')); mkdirSync(join(root,'.claude'));
 writeFileSync(join(root,'.agents/trust-before-scale.json'), '{"level":0}');
 writeFileSync(join(root,'.claude/trust-before-scale.json'), '{}');
 assert.throws(() => loadConfig(root));
 assert.equal(evaluate(['--check'], {root, config:{level:1}, log:()=>{}}),0);
 assert.equal(run(['1'], {root,config:{level:3},ghRun:()=>{throw Error('must not call gh');},log:()=>{}}),1);
}));
test('owed searches configured labels across pages and fetches only matching PRs', () => temporary(root => {
 const rows = Array.from({length:251},(_,i)=>({number:i+1,title:'owed'}));
 const output=[], fetched=[];
 run(['--owed'], {root,config:{selfMerge:{label:'self merged',reviewedLabel:'owner reviewed'}},ghRun:args=>{
   if(args[0]==='repo') return 'acme/project';
   if(args.includes('search/issues')) {
     assert.deepEqual(args, ['api','-X','GET','search/issues','-f','q=repo:acme/project is:pr is:merged label:"self merged" -label:"owner reviewed"','-f','per_page=100','--paginate','--slurp']);
     return JSON.stringify([rows.slice(0,100),rows.slice(100,200),rows.slice(200)].map(items=>({total_count:251,items,incomplete_results:false})));
   }
   assert.equal(args[0],'api');
   const number=Number(args[1].split('/').pop()); fetched.push(number);
   assert.equal(args[1], `repos/{owner}/{repo}/pulls/${number}`);
   return JSON.stringify({merged_at:'2026-01-01T00:00:00Z',merge_commit_sha:`sha${number}`});
 },log:x=>output.push(x)});
 assert.deepEqual(fetched,rows.map(row=>row.number));
 assert.equal(output.length,251);
 assert.equal(output[250],"#251\towed\tsha251");
}));
test('owed fails closed on the search cap, missing pages, or incomplete results before printing', () => temporary(root => {
 for (const [total,count,incomplete] of [[1001,1000,false],[251,100,false],[1,1,true]]) {
   const output=[];
   assert.throws(()=>run(['--owed'],{root,config:{},ghRun:args=>{
     if(args[0]==='repo') return 'acme/project';
     assert.ok(args.includes('search/issues'), 'must reject before fetching PR details');
     return JSON.stringify([{total_count:total,items:Array.from({length:count},(_,i)=>({number:i+1})),incomplete_results:incomplete}]);
   },log:x=>output.push(x)}), /Cannot check owed reviews completely/);
   assert.deepEqual(output,[]);
 }
}));
test('judged evidence must name basename and a required concept',()=>{
 const item={file:'src/auth.js',mustName:['permission']};
 const answer=evidence=>JSON.stringify({caught:true,evidence});
 assert.equal(judged(answer('bad'),'bad',item).pass,false);
 assert.equal(judged(answer('auth.js permission missing'),'auth.js permission missing',item).pass,true);
});
test('worktrees share hook skips, migrate legacy logs once and audit acknowledgement offline',()=>temporary(root=>{
 execFileSync('git',['commit','--allow-empty','-qm','initial'],{cwd:root});
 const tree=join(root,'linked');
 execFileSync('git',['worktree','add','-qb','linked',tree],{cwd:root});
 const legacy=execFileSync('git',['rev-parse','--git-dir'],{cwd:tree,encoding:'utf8'}).trim();
 const line='2026-01-01T00:00:00Z\tlegacy reason\tcommand';
 writeFileSync(join(legacy,'tbs-skips.log'),line+'\n');
 const call=(cwd,argv)=>{const output=[];run(argv,{root:cwd,config:{},ghRun:args=>args[0]==='repo'?'acme/project':JSON.stringify([{total_count:0,items:[]}]),log:x=>output.push(x)});return output;};
 assert.ok(call(root,['--owed']).some(x=>x.includes('legacy reason')));
 assert.ok(call(tree,['--owed']).some(x=>x.includes('legacy reason')));
 assert.equal(readFileSync(join(root,'.git/tbs-skips.log'),'utf8'),line+'\n');
 assert.ok(call(tree,['--ack-skips']).some(x=>x.includes(line)));
 assert.ok(readFileSync(join(root,'.git/tbs-skips.reviewed.audit'),'utf8').includes('Tester'));
 assert.ok(!call(root,['--owed']).some(x=>x.startsWith('HOOK SKIP')));
}));

test('legacy eval records stay valid until rerun; new runs default to two repeats',()=>temporary(root=>{
 const put=(path,data)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),data);};
 put('src/x.ts','const count = 1;\n'); put('skills/review/SKILL.md','Review the change.\n');
 execFileSync('git',['add','.'],{cwd:root}); execFileSync('git',['commit','-qm','initial'],{cwd:root});
 const suite={name:'routine',base:'HEAD',skills:['skills/review']};
 put('evals/routine/cases/count/case.json',JSON.stringify({id:'count',expect:'gate',rule:'count stays one',mustName:['count'],file:'src/x.ts',gate:"printf 'src/x.ts incorrect\\n'; exit 1"}));
 put('evals/routine/cases/count/seed.patch','diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-const count = 1;\n+const count = 2;\n');
 const record={date:new Date().toISOString(),skillHash:skillHash(root,suite),casesHash:casesHash(loadCases(root,'routine')),settingsHash:settingsHash(suite),cases:[{id:'count',pass:true}]};
 put('evals/routine/result.json',JSON.stringify(record));
 const config={evals:{suites:[suite]}}, lines=[];
 assert.equal(evaluate(['--check'],{root,config,log:x=>lines.push(x)}),0);
 assert.ok(lines.some(x=>x.includes('predates stricter')));
 assert.equal(evaluate(['routine'],{root,config,log:()=>{}}),0);
 const next=JSON.parse(readFileSync(join(root,'evals/routine/result.json')));
 assert.equal(next.evidenceRule,2);assert.equal(next.cases[0].repeats,2);
 assert.equal(evaluate(['--check'],{root,config,log:()=>{}}),0);
}));

test('metadata is accepted at every object depth while typos and required fields fail',()=>{
 const decorate = value => {
  if (Array.isArray(value)) return value.map(decorate);
  if (!value || typeof value !== 'object') return value;
  return {...Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decorate(v)])), _why_off:{arbitrary:true}, $schema:'metadata'};
 };
 const config={evals:{suites:[{name:'review',skills:[]}]},featureMap:{sources:[{dir:'src',preset:'react-router'}]},selfMerge:{review:{reviewer:'codex'},requiredComments:[{name:'review',pattern:'ok'}]},autopilot:{maxLanes:1,checkIns:{timeZone:'UTC',times:['12:00']}}};
 assert.doesNotThrow(()=>validateConfig(decorate(config)));
 assert.throws(()=>validateConfig({typo:true}),/unknown key/);
 assert.throws(()=>validateConfig({selfMerge:{review:{typo:true}}}),/unknown key/);
 assert.throws(()=>validateConfig({evals:{suites:[{name:'missing skills'}]}}),/skills: required/);
});

test('owed lists local skips when GitHub search fails and lanes stay capped', () => temporary(root => {
 const line = '2026-01-01T00:00:00Z\toffline reason\tcommand';
 writeFileSync(join(root, '.git/tbs-skips.log'), line + '\n');
 const output = [];
 const ghRun = args => {
   if (args[0] === 'repo') return 'acme/project';
   throw new Error('GitHub unavailable');
 };
 const config = { autopilot: { maxLanes: 4 }, evals: { suites: [{ name: 'review', skills: [] }] } };
 assert.throws(() => run(['--owed'], { root, config, ghRun, log: x => output.push(x) }), /GitHub unavailable/);
 const allowance = laneAllowance({ root, config, ghRun, evalCheck: () => 0 });
 assert.equal(allowance.allowed, 1);
 assert.match(allowance.reasons.join(' '), /unreviewed hook skips.*offline reason/);
 assert.deepEqual(output, [`HOOK SKIP\t${line}`]);
}));

test('owed surfaces a skip-log migration failure', () => temporary(root => {
 mkdirSync(join(root, '.git/worktrees/linked/tbs-skips.log'), { recursive: true });
 const ghRun = args => args[0] === 'repo' ? 'acme/project' : JSON.stringify([{ total_count: 0, items: [] }]);
 assert.throws(() => run(['--owed'], { root, config: {}, ghRun, log: () => {} }), { code: 'EISDIR' });
}));

test('judged required terms must be in the quoted evidence', () => {
 const item = { file: 'src/auth.js', mustName: ['permission'] };
 const evidence = 'auth.js needs review';
 const review = evidence + '\nCheck the permission on that file.';
 assert.equal(judged(JSON.stringify({ caught: true, evidence }), review, item).pass, false);
});
