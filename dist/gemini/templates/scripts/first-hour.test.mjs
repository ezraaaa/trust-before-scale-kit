import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema, validateConfig, loadConfig } from './config.mjs';
import { main as doctor } from './doctor.mjs';
import { laneAllowance, main as lanes } from './lanes.mjs';
import { discover, discoverIn, main as featureMap } from './feature-map.mjs';
import { main as firebase } from './free-ports.mjs';
const scripts = dirname(fileURLToPath(import.meta.url));
function temporary(fn) {
  const root = mkdtempSync(join(tmpdir(), 'tbs-first-hour-'));
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  try { return fn(root, put); } finally { rmSync(root, { recursive: true, force: true }); }
}
test('schema copy matches canonical schema and profiles validate', () => {
  const plugin = resolve(scripts, '../..');
  // The canonical schema and profiles are not vendored into installed projects.
  if (!existsSync(join(plugin, 'schema/config.schema.json'))) return;
  assert.deepEqual(schema, JSON.parse(readFileSync(join(plugin, 'schema/config.schema.json'))));
  for (const profile of ['generic', 'acme-mobile', 'acme-flutter']) {
    const config = JSON.parse(readFileSync(join(plugin, 'profiles', profile, 'trust-before-scale.json')));
    validateConfig(config); assert.equal(config.level, 1); assert.ok(config.$schema.endsWith('/schema/config.schema.json'));
    if (profile === 'generic') { assert.equal(config.emulators, undefined); assert.ok(!config.selfMerge.block.some(x => /firebase|firebaserc|functions/.test(x))); }
  }
});
test('issue 5: path segments and nonempty schedules', () => {
  for (const handoff of ['notes/a..b.md', 'notes/..ok.md']) validateConfig({ autopilot: { maxLanes: 2, handoff } });
  for (const handoff of ['../a', 'a/../b', 'a/..', '/a', 'C:/a', 'a\\b']) assert.throws(() => validateConfig({ autopilot: { maxLanes: 2, handoff } }));
  for (const times of [[], ['25:00']]) assert.throws(() => validateConfig({ autopilot: { maxLanes: 2, checkIns: { timeZone: 'UTC', times } } }));
  assert.throws(() => validateConfig({ autopilot: { maxLanes: 1, checkIns: { timeZone: 'invalid', times: ['12:00'] } } }));
  for (const level of [0, 5, 1.5, '1']) assert.throws(() => validateConfig({ level }));
});
test('neutral config wins and malformed neutral config never falls back', () => temporary((root, put) => {
  put('.claude/trust-before-scale.json', '{"level":1}'); assert.equal(loadConfig(root).level, 1);
  put('.agents/trust-before-scale.json', '{"level":2}'); assert.equal(loadConfig(root).level, 2);
  put('.agents/trust-before-scale.json', '{'); assert.throws(() => loadConfig(root));
}));
test('levels skip feature map and cap lanes without invoking higher level dependencies', () => {
  const output = [];
  assert.equal(featureMap([], { config: { level: 1 }, log: x => output.push(x) }), 0);
  assert.match(output[0], /not adopted \(level 2\)/);
  for (const level of [1, 2, 3]) {
    const config = { level, autopilot: { maxLanes: 5 } };
    assert.equal(laneAllowance({ config, ghRun: () => { throw Error('must not run'); } }).allowed, 1);
    assert.equal(lanes(['--require', '2'], { config, log: () => {} }), 1);
  }
  const result = laneAllowance({ config: { level: 4, autopilot: { maxLanes: 5 } }, owedCheck: () => {}, mapCheck: () => 0 });
  assert.equal(result.allowed, 1); assert.match(result.reasons.join(' '), /no eval suite/);
});
test('all five presets discover representative routes and preserve custom regex', () => temporary((root, put) => {
  assert.deepEqual(discoverIn('enum AppRoute: Hashable {\ncase home, detail(id: Int)\n}', { preset: 'swift-routes' }), ['AppRoute.home', 'AppRoute.detail']);
  assert.deepEqual(discoverIn('data object Home : AppRoute', { preset: 'kotlin-routes' }), ['Home']);
  assert.deepEqual(discoverIn('<Route path="/home" />\n{ path: "/other" }', { preset: 'react-router' }), ['/home', '/other']);
  assert.deepEqual(discoverIn("GoRoute(path: '/home', builder: x)", { preset: 'flutter-go-router' }), ['/home']);
  put('app/page.tsx', ''); put('app/settings/page.tsx', '');
  assert.deepEqual([...discover(root, [{ dir: 'app', preset: 'nextjs-app' }]).keys()], ['/', '/settings']);
  assert.deepEqual(discoverIn('SCREEN home', { item: 'SCREEN (\\w+)' }), ['home']);
  assert.throws(() => discoverIn('', { preset: 'unknown' }), /Unknown/);
}));
test('doctor checks configured runners, missing pieces, and actionable failures', () => temporary((root, put) => {
  put('evals/routine/cases/example.json', '{}'); put('skills/review.md', 'review');
  const config = { level: 3, mergeGate: {}, featureMap: { sources: [{ dir: 'src', preset: 'react-router' }] }, evals: { suites: [{ name: 'routine', skills: ['skills/review.md'], reviewer: 'cursor-agent', judge: 'gemini' }] } };
  put('src/app.tsx', ''); put('docs/feature-map.json', '{}');
  const commands = [], output = [];
  assert.equal(doctor([], { root, config, probe: command => commands.push(command), log: x => output.push(x) }), 0);
  assert.ok(commands.includes('cursor-agent')); assert.ok(commands.includes('gemini')); assert.ok(!commands.includes('claude'));
  assert.equal(doctor([], { root, config, probe: () => { throw Error('absent'); }, log: x => output.push(x) }), 1);
  assert.ok(output.some(x => /FAIL.*Next:/.test(x)));
  config.evals.suites[0].judge = 'cursor-agent';
  assert.equal(doctor([], { root, config, probe: () => {}, log: () => {} }), 1);
  config.evals.suites[0].allowSameJudge = true;
  assert.equal(doctor([], { root, config, probe: () => {}, log: () => {} }), 0);
}));
test('fresh generic level 1 doctor and level 4 no-evals lane CLI, real processes', () => temporary((root, put) => {
  const installer = resolve(scripts, '../../bin/tbs-init');
  if (!existsSync(installer)) return;
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync(process.execPath, [installer, 'generic'], { cwd: root });
  const doctorResult = spawnSync(process.execPath, ['scripts/tbs/doctor.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(doctorResult.status, 0, doctorResult.stdout + doctorResult.stderr);
  const file = join(root, '.agents/trust-before-scale.json');
  const config = JSON.parse(readFileSync(file)); config.level = 4; config.evals = { suites: [] }; delete config.featureMap;
  writeFileSync(file, JSON.stringify(config));
  const result = spawnSync(process.execPath, ['scripts/tbs/lanes.mjs', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).allowed, 1);
  assert.match(result.stdout, /no eval suite/);
  put('.agents/trust-before-scale.json', JSON.stringify({ ...config, level: 1 }));
  assert.equal(spawnSync(process.execPath, ['scripts/tbs/doctor.mjs'], { cwd: root }).status, 0);
}));
test('Firebase helper requires explicit opt in', async () => {
  await temporary(async (root, put) => {
    put('.agents/trust-before-scale.json', '{"level":1}');
    await assert.rejects(firebase(['--', 'true'], { root }), /Firebase helper is opt-in/);
  });
});

test('release workflow extracts only matching version notes and rejects missing or empty sections', () => temporary((root, put) => {
  const workflow = resolve(scripts, '../../../../.github/workflows/release.yml');
  if (!existsSync(workflow)) return;
  const content = readFileSync(workflow, 'utf8');
  const script = content.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)[1].replace(/^          /gm, '');
  const run = tag => spawnSync(process.execPath, ['--input-type=module'], { cwd: root, input: script, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag } });
  put('CHANGELOG.md', '# Changes\n## 1.4.0\n\nNew release.\n\n## 1.3.0\nOld release.\n');
  assert.equal(run('v1.4.0').status, 0);
  assert.equal(readFileSync(join(root, 'release-notes.md'), 'utf8'), 'New release.\n');
  assert.notEqual(run('v9.0.0').status, 0);
  put('CHANGELOG.md', '## 1.4.0\n\n## 1.3.0\nOld release.');
  assert.notEqual(run('v1.4.0').status, 0);
}));

test('doctor reports due and recurred classes at level 3+, CI excludes local journal', () => temporary((root, put) => {
  execFileSync('git', ['init', '-q', root]);
  const config = { level: 3, learn: { file: 'lessons.jsonl' } };
  const record = (id, kind, date) => JSON.stringify({ id, class: kind, date });
  put('lessons.jsonl', record('1', 'shared-miss', '2026-01-01') + '\n' + record('2', 'shared-miss', '2026-01-02') + '\n');
  put('docs/trust-before-scale/enforcers.md', '| local-miss | test | 2026-01-01 | shipped |\n');
  put('.git/tbs-learn/lessons.jsonl', record('3', 'local-miss', '2026-01-03') + '\n');
  const run = (argv, level = 3) => {
    const lines = []; doctor(argv, { root, config: { ...config, level }, probe: () => {}, log: x => lines.push(x) }); return lines.join('\n');
  };
  assert.match(run([]), /2 due classes, 1 recurred classes\. Next: node scripts\/tbs\/learn.mjs --due/);
  assert.match(run(['--ci']), /1 due classes, 0 recurred classes/);
  assert.doesNotMatch(run([], 2), /NOTE lessons/);
}));
