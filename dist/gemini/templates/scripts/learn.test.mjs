import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { add, outcomes, journal, main } from './learn.mjs';
import { validateConfig } from './config.mjs';
import { laneAllowance } from './lanes.mjs';
const entry = { class:'review-miss', where:'example.js', source:'review-finding', evidence:'abc #1 finding' };
function fixture(t) { const root=mkdtempSync(join(tmpdir(),'learn-')); t.after(()=>rmSync(root,{recursive:true,force:true})); return root; }
function ship(root, date) { mkdirSync(join(root,'docs/trust-before-scale'),{recursive:true}); writeFileSync(join(root,'docs/trust-before-scale/enforcers.md'), `| review-miss | test-one | ${date} | shipped |\n`); }
test('append only, due newest first, shipped suppression and recurrence', t=>{
 const root=fixture(t), config={}; const a=add(entry,{root,config}); const before=readFileSync(journal(root,config),'utf8');
 add(entry,{root,config}); assert.ok(readFileSync(journal(root,config),'utf8').startsWith(before));
 assert.equal(outcomes({root,config}).due.length,1);
 ship(root,'2999-01-01T00:00:00Z'); assert.equal(outcomes({root,config}).due.length,0);
 ship(root,'2000-01-01T00:00:00Z'); const result=outcomes({root,config}); assert.equal(result.recurred.length,1); assert.equal(result.due.length,1); assert.equal(result.recent.length,1); assert.ok(a.id);
});
test('validation, level guard, malformed evidence fail closed',t=>{
 const root=fixture(t); assert.throws(()=>add({...entry,class:'Bad class'},{root,config:{}}));
 for(const file of ['../escape','/tmp/escape','C:\\escape']) assert.throws(()=>validateConfig({learn:{file}}));
 for(const learn of [{window:0},{maxDue:-1},{maxDue:1.5}]) assert.throws(()=>validateConfig({learn}));
 const logs=[]; assert.equal(main(['add'],{root,config:{level:2},log:s=>logs.push(s)}),0); assert.match(logs[0],/not adopted/);
 writeFileSync(join(root,'broken'),'bad\n'); assert.throws(()=>outcomes({root,config:{learn:{file:'broken'}}}));
});
test('lanes use outcomes at level 3+, legacy defaults to 4',t=>{
 const root=fixture(t); add(entry,{root,config:{}}); add(entry,{root,config:{}});
 const opts={root,evalCheck:()=>0,owedCheck:()=>0,mapCheck:()=>0};
 for(const level of [undefined,3,4]) {
  const result=laneAllowance({...opts,config:{...(level ? {level}:{}),learn:{maxDue:0},autopilot:{maxLanes:4},evals:{suites:[{name:'test',skills:[]}]}}});
  assert.equal(result.allowed,1); assert.ok(result.reasons.some(s=>s.includes('due classes')));
 }
 assert.ok(!laneAllowance({...opts,config:{level:2,learn:{maxDue:0}}}).reasons.some(s=>s.includes('due classes')));
});
test('concurrent writers from worktrees share intact bounded JSON lines',async t=>{
 const root=fixture(t); execFileSync('git',['init','-q',root]); execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','init']);
 const other=join(root,'other'); execFileSync('git',['-C',root,'worktree','add','-qb','other',other]);
 assert.equal(journal(root,{}),journal(other,{}));
 await Promise.all(Array.from({length:8},(_,i)=>new Promise((resolve,reject)=>{
  const code=`import {add} from ${JSON.stringify(new URL('./learn.mjs',import.meta.url).href)}; for(let i=0;i<25;i++) add(${JSON.stringify(entry)},{root:${JSON.stringify(i%2?root:other)},config:{}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'pipe'}); let err=''; child.stderr.on('data',d=>err+=d); child.on('error',reject); child.on('exit',c=>c===0?resolve():reject(new Error(err)));
 })));
 const lines=readFileSync(journal(root,{}),'utf8').trim().split('\n').map(JSON.parse); assert.equal(lines.length,200); assert.equal(new Set(lines.map(e=>e.id)).size,200);
});
test('sync shares both worktrees once in date then id order, preserving committed bytes', t=>{
 const root=fixture(t); execFileSync('git',['init','-q',root]); execFileSync('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','init']);
 const other=join(root,'other'); execFileSync('git',['-C',root,'worktree','add','-qb','other',other]);
 const config={learn:{file:'shared/lessons.jsonl'}};
 const a=add(entry,{root,config}), b=add(entry,{root:other,config});
 // Equal timestamps exercise the id tie-breaker; a duplicate journal id is copied once.
 a.date=b.date; writeFileSync(journal(root,config),[b,a,a].map(x=>JSON.stringify(x)).join('\n')+'\n');
 mkdirSync(join(other,'shared'),{recursive:true});
 const old={...a,id:'old'}; const prefix=JSON.stringify(old)+'\n'; writeFileSync(join(other,config.learn.file),prefix);
 const logs=[]; assert.equal(main(['sync'],{root:other,config,log:x=>logs.push(x)}),0);
 const bytes=readFileSync(join(other,config.learn.file),'utf8'); assert.ok(bytes.startsWith(prefix));
 const records=bytes.trim().split('\n').map(JSON.parse); assert.deepEqual(records.slice(1).map(x=>x.id),[a.id,b.id].sort());
 assert.equal(logs.filter(x=>x.startsWith('Added ')).length,2);
 assert.equal(outcomes({root:other,config}).due[0].evidence.length,3);
 assert.equal(main(['sync'],{root:other,config,log:x=>logs.push(x)}),0);
 assert.equal(logs.at(-1),'Synced 0 lesson(s)'); assert.equal(readFileSync(join(other,config.learn.file),'utf8'),bytes);
});
test('sync outside git leaves the existing lesson file unchanged',t=>{
 const root=fixture(t); add(entry,{root,config:{}}); const before=readFileSync(journal(root,{}),'utf8');
 assert.equal(main(['sync'],{root,config:{},log:()=>{}}),0); assert.equal(readFileSync(journal(root,{}),'utf8'),before);
});
