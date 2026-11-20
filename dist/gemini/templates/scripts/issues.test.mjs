import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { main as evaluate, judged, loadCases, casesHash, skillHash, settingsHash } from './skill-eval.mjs';
import { laneAllowance } from './lanes.mjs';
import { run } from './self-merge.mjs';
import { main as learn } from './learn.mjs';
import { adoptionLevel, loadConfig, validateConfig } from './config.mjs';
function temporary(fn) {
 const root = mkdtempSync(join(tmpdir(), 'tbs-issues-'));
 try { execFileSync('git', ['init', '-q', root]); execFileSync('git', ['config', 'user.name', 'Tester'], {cwd:root}); execFileSync('git', ['config', 'user.email', 'test@example.invalid'], {cwd:root}); fn(root); }
 finally { rmSync(root, {recursive:true, force:true}); }
}
for (const config of [{}, ...[null, 2.5, 0, 5, '4', true].map(level => ({ level }))]) {
 test(`adoption defaults to level 1 for ${JSON.stringify(config)}`, () => {
   if ('level' in config) assert.throws(() => validateConfig(config), /config.level/);
   assert.equal(adoptionLevel(config), 1);
 });
}
test('explicit adoption levels 1 through 4 are preserved', () => {
 for (const level of [1, 2, 3, 4]) assert.equal(adoptionLevel(validateConfig({ level })), level);
});
test('self-merge refuses when adoption level is missing', () => {
 const logs = [];
 assert.equal(run(['1'], {
   config: { selfMerge: { enabled: true } },
   ghRun: () => assert.fail('must not call gh'),
   log: line => logs.push(line),
 }), 1);
 assert.deepEqual(logs, ['REFUSED: not adopted (level 4)']);
});
for (const [name, main, argv] of [['skill-eval', evaluate, ['--check']], ['learn', learn, ['--due']]]) {
 test(`${name} is not adopted when level is missing`, () => temporary(root => {
   const logs = [];
   assert.equal(main(argv, { root, config: {}, log: line => logs.push(line) }), 0);
   assert.deepEqual(logs, ['not adopted (level 3)']);
 }));
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

function evalFixture(root, expect) {
 const put = (path, data) => {
   mkdirSync(dirname(join(root, path)), { recursive: true });
   writeFileSync(join(root, path), data);
 };
 put('src/x.ts', 'const count = 1;\n');
 put('skills/review/SKILL.md', 'Review the change.\n');
 execFileSync('git', ['add', '.'], { cwd: root });
 execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });
 const suite = { name: 'routine', base: 'HEAD', skills: ['skills/review'] };
 const item = { id: 'count', expect, rule: 'count stays one', mustName: ['COUNT', 'off-by-one'], file: 'src/x.ts' };
 if (expect === 'gate') item.gate = "if grep -q 'count = 2' src/x.ts; then printf 'src/x.ts incorrect\\n'; exit 1; fi";
 put('evals/routine/cases/count/case.json', JSON.stringify(item));
 put('evals/routine/cases/count/seed.patch', 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-const count = 1;\n+const count = 2;\n');
 return { suite, config: { level: 4, evals: { suites: [suite] } }, resultPath: join(root, 'evals/routine/result.json') };
}

test('check rejects records predating evidence rule 3', () => temporary(root => {
 const { suite, config, resultPath } = evalFixture(root, 'gate');
 for (const evidenceRule of [2, undefined]) {
   const strict = evidenceRule === 2;
   const repeats = strict ? 2 : 1;
   const record = {
     evidenceRule, date: new Date().toISOString(), skillHash: skillHash(root, suite),
     casesHash: casesHash(loadCases(root, 'routine')), settingsHash: settingsHash(suite, strict),
     cases: [{ id: 'count', pass: true, repeats, passes: repeats }],
   };
   writeFileSync(resultPath, JSON.stringify(record));
   const lines = [];
   const status = evaluate(['--check'], { root, config, log: line => lines.push(line) });
   assert.match(lines.join('\n'), /record predates evidence rule 3 \(quote-only matching\): run it again/);
   assert.equal(status, 1);
 }
}));

test('a gate that rewrites files on the clean base does not leak into the seeded run (#21)', () => temporary(root => {
 const { config, resultPath } = evalFixture(root, 'gate');
 const casePath = join(root, 'evals/routine/cases/count/case.json');
 const item = JSON.parse(readFileSync(casePath));
 item.gate = "if grep -q 'count = 2' src/x.ts; then printf 'src/x.ts incorrect\\n'; exit 1; fi; printf 'const count = 1; // formatted\\n' > src/x.ts; touch generated.txt";
 writeFileSync(casePath, JSON.stringify(item));
 assert.equal(evaluate(['routine'], { root, config, log: () => {} }), 0);
 const result = JSON.parse(readFileSync(resultPath)).cases[0];
 assert.equal(result.pass, true);
 assert.deepEqual(result.baseExit, [0, 0]);
 assert.deepEqual(result.seededExit, [1, 1]);
}));

test('ignored files the base run writes do not make the seeded run fail (#21)', () => temporary(root => {
 const { config, resultPath } = evalFixture(root, 'gate');
 writeFileSync(join(root, '.git/info/exclude'), 'cache.txt\n');
 const casePath = join(root, 'evals/routine/cases/count/case.json');
 const item = JSON.parse(readFileSync(casePath));
 item.gate = "if [ -f cache.txt ]; then printf 'src/x.ts incorrect\\n'; exit 1; fi; touch cache.txt";
 writeFileSync(casePath, JSON.stringify(item));
 evaluate(['routine'], { root, config, log: () => {} });
 const result = JSON.parse(readFileSync(resultPath)).cases[0];
 assert.equal(result.pass, false);
}));

test('a nested git repo the base run creates does not stop the seeded run (#21)', () => temporary(root => {
 const { config, resultPath } = evalFixture(root, 'gate');
 const casePath = join(root, 'evals/routine/cases/count/case.json');
 const item = JSON.parse(readFileSync(casePath));
 item.gate = "if grep -q 'count = 2' src/x.ts; then printf 'src/x.ts incorrect\\n'; exit 1; fi; git init -q fixture";
 writeFileSync(casePath, JSON.stringify(item));
 evaluate(['routine'], { root, config, log: () => {} });
 assert.equal(JSON.parse(readFileSync(resultPath)).cases[0].pass, true);
}));

test('both gate runs see the same branch (#21)', () => temporary(root => {
 const { config, resultPath } = evalFixture(root, 'gate');
 const casePath = join(root, 'evals/routine/cases/count/case.json');
 const item = JSON.parse(readFileSync(casePath));
 item.gate = "[ \"$(git rev-parse --abbrev-ref HEAD)\" != HEAD ] || exit 3; if grep -q 'count = 2' src/x.ts; then printf 'src/x.ts incorrect\\n'; exit 1; fi";
 writeFileSync(casePath, JSON.stringify(item));
 evaluate(['routine'], { root, config, log: () => {} });
 assert.equal(JSON.parse(readFileSync(resultPath)).cases[0].pass, true);
}));

test('a commit the base run makes does not reach the seeded run (#21)', () => temporary(root => {
 const { config, resultPath } = evalFixture(root, 'gate');
 const casePath = join(root, 'evals/routine/cases/count/case.json');
 const item = JSON.parse(readFileSync(casePath));
 item.gate = "if [ -f marker ]; then printf 'src/x.ts incorrect\\n'; exit 1; fi; touch marker; git add marker; git -c user.name=G -c user.email=g@example.invalid commit -qm marker";
 writeFileSync(casePath, JSON.stringify(item));
 evaluate(['routine'], { root, config, log: () => {} });
 assert.equal(JSON.parse(readFileSync(resultPath)).cases[0].pass, false);
}));

test('new eval records use rule 3 and default to two repeats', () => temporary(root => {
 const { config, resultPath } = evalFixture(root, 'gate');
 assert.equal(evaluate(['routine'], { root, config, log: () => {} }), 0);
 const record = JSON.parse(readFileSync(resultPath));
 assert.equal(record.evidenceRule, 3);
 assert.equal(record.cases[0].repeats, 2);
 assert.equal(evaluate(['--check'], { root, config, log: () => {} }), 0);
}));

function runReview(root, caught) {
 const { suite, config, resultPath } = evalFixture(root, 'review');
 Object.assign(suite, { reviewer: 'cursor-agent', judge: 'gemini', repeats: 1, reviewPrompt: 'Review {branch}' });
 const evidence = 'x.ts sets count to two.';
 const prompts = [];
 const run = (command, args, options) => {
   if (command === 'cursor-agent') return { status: 0, stdout: evidence };
   if (command === 'gemini') {
     prompts.push(args[1]);
     return { status: 0, stdout: JSON.stringify({ caught, evidence }) };
   }
   return spawnSync(command, args, { ...options, encoding: 'utf8' });
 };
 const status = evaluate(['routine'], { root, config, run, log: () => {} });
 return { status, prompts, result: JSON.parse(readFileSync(resultPath)).cases[0] };
}

test('judge prompt asks for at least one term and a basename plus one term passes', () => temporary(root => {
 const { status, prompts, result } = runReview(root, true);
 assert.equal(status, 0, result.evidence);
 assert.equal(result.pass, true);
 assert.equal(prompts.length, 1);
 assert.match(prompts[0], /at least one of the mustName terms/);
}));

test('failed review records a repo-relative path to the kept review', () => temporary(root => {
 const { status, prompts, result } = runReview(root, false);
 assert.equal(status, 1);
 assert.equal(prompts.length, 1, result.evidence);
 assert.ok(!result.evidence.includes(root), result.evidence);
 assert.match(result.evidence, /\(full review: \.git\/tbs-reviews\/[^)]+\)/);
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
 const config = { level: 4, autopilot: { maxLanes: 4 }, evals: { suites: [{ name: 'review', skills: [] }] } };
 assert.throws(() => run(['--owed'], { root, config, ghRun, log: x => output.push(x) }), /GitHub unavailable/);
 const allowance = laneAllowance({ root, config, ghRun, evalCheck: () => 0 });
 assert.equal(allowance.allowed, 1);
 assert.match(allowance.reasons.join(' '), /unreviewed hook skips.*offline reason/);
 assert.equal(allowance.reasons.join(' ').split('offline reason').length - 1, 1, 'each skip reported once');
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
