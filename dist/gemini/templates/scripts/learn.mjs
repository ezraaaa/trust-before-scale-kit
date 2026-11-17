// Shared append-only outcomes. One O_APPEND write per JSON line, across worktrees.
import { appendFileSync, mkdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ROOT, loadConfig, adoptionLevel, isMain } from './config.mjs';

export const lessonFile = config => config.learn?.file ?? 'docs/trust-before-scale/lessons.jsonl';
export function journal(root, config) {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'], timeout: 1000 }).trim();
    return join(realpathSync(resolve(root, common)), 'tbs-learn', lessonFile(config));
  } catch { return join(root, lessonFile(config)); }
}
const sources = ['review-finding','gate-red-after-merge','revert','owner-correction','hook-block'];
export function add(entry, { root = ROOT, config = loadConfig(root) } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.class ?? '') || !sources.includes(entry.source) ||
      typeof entry.where !== 'string' || !entry.where.trim() || typeof entry.evidence !== 'string' || !entry.evidence.trim() ||
      (entry.enforcer !== undefined && (typeof entry.enforcer !== 'string' || !entry.enforcer.trim()))) throw new Error('add needs --class <kebab-case> --where <area> --source <kind> --evidence <sha, PR or log> [--enforcer <id>]');
  const record = { ...entry, id: randomUUID(), date: new Date().toISOString() };
  const path = journal(root, config);
  mkdirSync(dirname(path), { recursive: true });
  const line = Buffer.from(JSON.stringify(record) + '\n');
  if (line.length > 4096) throw new Error('lesson exceeds 4096 bytes; use a short evidence reference');
  appendFileSync(path, line, { flag: 'a' });
  return record;
}
function readEntries(paths) {
  const entries = [];
  const ids = new Set();
  for (const path of new Set(paths)) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
      const entry = JSON.parse(line);
      if (!entry.class || !Number.isFinite(Date.parse(entry.date))) throw new Error(`invalid lesson in ${path}`);
      if (!entry.id || !ids.has(entry.id)) entries.push(entry);
      if (entry.id) ids.add(entry.id);
    }
  }
  return entries;
}
export function sync({ root = ROOT, config = loadConfig(root) } = {}) {
  const file = join(root, lessonFile(config));
  const target = journal(root, config);
  if (target === file) return [];
  const ids = new Set(readEntries([file]).map(entry => entry.id));
  const added = readEntries([target]).filter(entry => {
    if (typeof entry.id !== 'string' || !entry.id) throw new Error(`lesson missing id in ${target}`);
    return !ids.has(entry.id);
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (added.length) {
    mkdirSync(dirname(file), { recursive: true });
    const separator = existsSync(file) && readFileSync(file, 'utf8').length && !readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '';
    appendFileSync(file, separator + added.map(entry => JSON.stringify(entry) + '\n').join(''), { flag: 'a' });
  }
  return added;
}
export function outcomes({ root = ROOT, config = loadConfig(root), now = Date.now(), committedOnly = false } = {}) {
  const file = join(root, lessonFile(config));
  const entries = readEntries(committedOnly ? [file] : [file, journal(root, config)]);
  let table = '';
  try { table = readFileSync(join(root, 'docs/trust-before-scale/enforcers.md'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Explicit machine-readable shipped rows; draft rows never suppress a due class.
  const shipped = new Map();
  for (const line of table.split('\n')) {
    const cells = line.split('|').slice(1,-1).map(s => s.trim());
    if (cells.length === 4 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cells[0]) && cells[1] && Number.isFinite(Date.parse(cells[2])) && cells[3] === 'shipped') shipped.set(cells[0], { id: cells[1], date: cells[2] });
  }
  const classes = [...new Set(entries.map(e => e.class))].map(kind => {
    const evidence = entries.filter(e => e.class === kind).sort((a,b) => Date.parse(b.date)-Date.parse(a.date));
    const enforcer = shipped.get(kind);
    const recurrences = enforcer ? evidence.filter(e => Date.parse(e.date) > Date.parse(enforcer.date)) : [];
    return { class: kind, evidence, enforcer, recurrences, due: recurrences.length > 0 || (!enforcer && evidence.length >= 2) };
  }).sort((a,b) => Date.parse(b.evidence[0].date)-Date.parse(a.evidence[0].date));
  return { due: classes.filter(c => c.due), recurred: classes.filter(c => c.recurrences.length), recent: classes.filter(c => c.recurrences.some(e => Date.parse(e.date) <= now && Date.parse(e.date) >= now-(config.learn?.window ?? 14)*86400000)) };
}
export function main(argv, { root = ROOT, config = loadConfig(root), log = console.log } = {}) {
  if (adoptionLevel(config) < 3) { log('not adopted (level 3)'); return 0; }
  if (argv.length === 1 && argv[0] === 'sync') {
    const added = sync({ root, config });
    for (const entry of added) log(`Added ${JSON.stringify(entry)}`);
    log(`Synced ${added.length} lesson(s)`);
    return 0;
  }
  if (argv[0] === 'add') {
    const entry = {};
    for (let i=1;i<argv.length;i+=2) {
      if (!['--class','--where','--source','--evidence','--enforcer'].includes(argv[i]) || !argv[i+1] || entry[argv[i].slice(2)] !== undefined) throw new Error('invalid add arguments');
      entry[argv[i].slice(2)] = argv[i+1];
    }
    log(JSON.stringify(add(entry, { root, config }))); return 0;
  }
  if (argv.length !== 1 || !['--due','--recurred'].includes(argv[0])) throw new Error('Usage: learn.mjs add ... | sync | --due | --recurred');
  const result = outcomes({ root, config });
  for (const item of result[argv[0].slice(2)]) log(`${item.class}\t${item.recurrences.length ? 'check did not hold' : 'no enforcer'}\t${JSON.stringify(item.evidence)}`);
  return 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
