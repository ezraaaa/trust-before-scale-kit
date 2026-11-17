#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const file = '.leakcheck.local';
if (!existsSync(file)) { console.log('No .leakcheck.local; private-name check not configured.'); process.exit(0); }
const patterns = readFileSync(file, 'utf8').split(/\r?\n/).filter(s => s.trim() && !s.startsWith('#')).map(s => new RegExp(s.startsWith('(?i)') ? s.slice(4) : s, s.startsWith('(?i)') ? 'i' : ''));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
let count = 0;
function check(text, location) { if (patterns.some(p => p.test(text))) { console.error(`Private-name match: ${location}`); count++; } }
if (process.argv.includes('--history')) {
  for (const commit of git('rev-list', '--all').trim().split('\n').filter(Boolean)) {
    check(git('show', '-s', '--format=%B', commit), `${commit}:message`);
    for (const path of git('ls-tree', '-r', '--name-only', '-z', commit).split('\0').filter(Boolean)) check(path + '\n' + git('show', `${commit}:${path}`), `${commit}:${path}`);
  }
} else {
  for (const path of git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(p => p && p !== file && existsSync(p) && !statSync(p).isDirectory())) check(path + '\n' + readFileSync(path, 'utf8'), path);
}
console.log(count ? `${count} locations matched (contents withheld).` : 'Private-name check passed.');
process.exitCode = count ? 1 : 0;
