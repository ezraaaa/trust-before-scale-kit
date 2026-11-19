#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filename = '.leakcheck.local';
export const missingLeakFileMessage = 'NOT RUN: no .leakcheck.local in this worktree or the main checkout; private-name check did not run.';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

export function findLeakFile(cwd) {
  let top, common;
  try {
    top = git(cwd, 'rev-parse', '--show-toplevel').trimEnd();
    const local = path.join(top, filename);
    if (existsSync(local)) return local;
    common = git(cwd, 'rev-parse', '--git-common-dir').trimEnd();
  } catch { return null; }
  const main = path.join(path.dirname(path.resolve(cwd, common)), filename);
  return existsSync(main) ? main : null;
}

function main(cwd, args) {
  const file = findLeakFile(cwd);
  if (!file) {
    console.log(missingLeakFileMessage);
    return args.includes('--require') ? 78 : 0;
  }
  const patterns = readFileSync(file, 'utf8').split(/\r?\n/).filter(s => s.trim() && !s.startsWith('#')).map(s => new RegExp(s.startsWith('(?i)') ? s.slice(4) : s, s.startsWith('(?i)') ? 'i' : ''));
  const root = git(cwd, 'rev-parse', '--show-toplevel').trimEnd();
  let count = 0;
  function check(text, location) { if (patterns.some(p => p.test(text))) { console.error(`Private-name match: ${location}`); count++; } }
  if (args.includes('--history')) {
    for (const commit of git(root, 'rev-list', '--all').trim().split('\n').filter(Boolean)) {
      check(git(root, 'show', '-s', '--format=%B', commit), `${commit}:message`);
      for (const name of git(root, 'ls-tree', '-r', '--name-only', '-z', commit).split('\0').filter(Boolean)) check(name + '\n' + git(root, 'show', `${commit}:${name}`), `${commit}:${name}`);
    }
  } else {
    for (const name of git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')) {
      if (!name || name === filename) continue;
      const target = path.join(root, name);
      if (existsSync(target) && !statSync(target).isDirectory()) check(name + '\n' + readFileSync(target, 'utf8'), name);
    }
  }
  console.log(count ? `${count} locations matched (contents withheld).` : 'Private-name check passed.');
  return count ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.cwd(), process.argv.slice(2));
}
