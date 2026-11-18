#!/usr/bin/env node
// Canonical metadata: Claude manifest. Canonical hook spec: hooks/hooks.json.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = 'plugins/trust-before-scale';
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const source = read(`${plugin}/.claude-plugin/plugin.json`);
const hooks = read(`${plugin}/hooks/hooks.json`).hooks;
const spec = hooks.PreToolUse[0].hooks[0];
const sessionStart = (variable, host, timeoutScale = 1) => hooks.SessionStart.map(group => ({
  ...group,
  hooks: group.hooks.map(hook => ({
    ...hook,
    command: hook.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', variable) + ' ' + host,
    timeout: hook.timeout * timeoutScale,
  })),
}));
const metadata = Object.fromEntries(['name', 'version', 'description', 'author', 'license', 'homepage', 'repository', 'keywords'].map(key => [key, source[key]]));
metadata.description = metadata.description.replace('.claude/trust-before-scale.json', '.agents/trust-before-scale.json or legacy .claude/trust-before-scale.json');
const command = (variable) => spec.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', variable);
const outputs = {
  [`${plugin}/.codex-plugin/plugin.json`]: { ...metadata, skills: './skills', hooks: './hooks/codex.json' },
  [`${plugin}/.cursor-plugin/plugin.json`]: { ...metadata, skills: './skills', rules: './rules', hooks: './hooks/cursor.json' },
  [`${plugin}/hooks/codex.json`]: { hooks: { SessionStart: sessionStart('${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT}}', 'codex'), PreToolUse: [{ matcher: 'Bash', hooks: [{ ...spec, command: command('${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT}}') }] }] } },
  [`${plugin}/hooks/cursor.json`]: { version: 1, hooks: { beforeShellExecution: [{ command: command('${CURSOR_PLUGIN_ROOT}') + ' --cursor', timeout: spec.timeout, failClosed: true }] } },
};
const market = read('.claude-plugin/marketplace.json');
outputs['.agents/plugins/marketplace.json'] = { ...market, plugins: market.plugins.map(entry => ({ ...entry, source: { source: 'local', path: entry.source }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } })) };
outputs['.cursor-plugin/marketplace.json'] = market;
// Gemini discovers hooks and skills only at fixed extension-root paths. Generate an installable
// standalone tree outside the Claude plugin; --gemini-dir exports it for a git-root branch.
const gemini = 'dist/gemini';
outputs[`${gemini}/gemini-extension.json`] = { name: source.name, version: source.version, description: metadata.description, contextFileName: 'GEMINI.md' };
const geminiSessionStart = sessionStart('${extensionPath}', 'gemini', 1000)
  .flatMap(group => group.matcher.split('|').map(matcher => ({ ...group, matcher })));
outputs[`${gemini}/hooks/hooks.json`] = { hooks: {
  SessionStart: geminiSessionStart,
  BeforeTool: [{ matcher: 'run_shell_command', hooks: [{ ...spec, command: command('${extensionPath}'), timeout: spec.timeout * 1000 }] }],
} };
const files = new Map(Object.entries(outputs).map(([path, data]) => [path, JSON.stringify(data, null, 2) + '\n']));
files.set(`${gemini}/hooks/merge-gate.py`, readFileSync(join(root, plugin, 'hooks/merge-gate.py'), 'utf8'));
files.set(`${gemini}/hooks/update-notice.mjs`, readFileSync(join(root, plugin, 'hooks/update-notice.mjs'), 'utf8'));
files.set(`${gemini}/GEMINI.md`, readFileSync(join(root, 'GEMINI.md'), 'utf8'));
for (const entry of readdirSync(join(root, plugin, 'skills'))) files.set(`${gemini}/skills/${entry}/SKILL.md`, readFileSync(join(root, plugin, 'skills', entry, 'SKILL.md'), 'utf8'));
// Include setup payload so the standalone extension can also run the setup skill.
function bundle(path) {
  for (const entry of readdirSync(join(root, plugin, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) bundle(child);
    else files.set(`${gemini}/${child}`, readFileSync(join(root, plugin, child), 'utf8'));
  }
}
bundle('templates');
bundle('profiles');
bundle('schema');
files.set(`${gemini}/bin/tbs-init`, readFileSync(join(root, plugin, 'bin/tbs-init'), 'utf8'));
files.set(`${gemini}/.claude-plugin/plugin.json`, JSON.stringify(source, null, 2) + '\n');
let stale = false;
for (const [path, text] of files) {
  const full = join(root, path);
  if (process.argv.includes('--check')) {
    if (!existsSync(full) || readFileSync(full, 'utf8') !== text) { console.error(`stale: ${path}`); stale = true; }
  } else {
    if (path === '.agents/plugins/marketplace.json' && process.argv.includes('--skip-agents-marketplace')) continue;
    try { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); }
    catch (error) { console.error(`cannot generate ${path}: ${error.code}`); process.exitCode = 1; }
  }
}
if (stale) process.exitCode = 1;
const index = process.argv.indexOf('--gemini-dir');
if (index !== -1) {
  if (!process.argv[index + 1] || process.argv.includes('--check')) throw new Error('--gemini-dir needs a destination and cannot combine with --check');
  cpSync(join(root, gemini), resolve(process.argv[index + 1]), { recursive: true });
}
