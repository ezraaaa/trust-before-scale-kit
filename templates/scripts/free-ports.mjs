#!/usr/bin/env node
// Trust before scale: Firebase emulators on FREE ports, so a test or walk never takes the default
// ports another session or project is using, and never needs to ask first.
//
//   node scripts/tbs/free-ports.mjs [--only auth,firestore] [--config firebase.json] -- <command ...>
//
// It copies the firebase config beside the original (relative rules paths keep working), moves every
// emulator to a free port, turns the UI off, and runs <command> inside `firebase emulators:exec`.
// The command sees the usual SDK variables for this boot (FIRESTORE_EMULATOR_HOST,
// FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST, PUBSUB_EMULATOR_HOST) plus
// TBS_PORTS={"auth":…,"firestore":…} and one free spare port in TBS_SPARE_PORT (for a dev server).
// A port taken between choosing and binding is retried on fresh ports, three times.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { ROOT, isMain } from "./config.mjs";
import { loadConfig } from "./config.mjs";

export const PORT_TAKEN = /port taken|is not open|EADDRINUSE|Could not start .+ Emulator/i;
const ENV_NAMES = { auth: "FIREBASE_AUTH_EMULATOR_HOST", firestore: "FIRESTORE_EMULATOR_HOST", storage: "FIREBASE_STORAGE_EMULATOR_HOST", pubsub: "PUBSUB_EMULATOR_HOST", database: "FIREBASE_DATABASE_EMULATOR_HOST" };
const KNOWN = ["auth", "firestore", "functions", "storage", "pubsub", "database", "hosting", "eventarc", "tasks", "dataconnect"];

export const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
    const { port } = server.address(); server.close(() => resolvePort(port));
  });
});

/** Rewrite an emulators block: every named emulator plus hub, logging and websocket moved; UI off. */
export function isolate(emulators, only, ports) {
  const next = { ...emulators, ui: { enabled: false } };
  let index = 0;
  const take = () => ports[index++];
  for (const name of only) next[name] = { ...(emulators[name] ?? {}), port: take() };
  if (only.includes("firestore")) next.firestore.websocketPort = take();
  next.hub = { port: take() }; next.logging = { port: take() };
  for (const name of ["eventarc", "tasks"]) if (only.includes("functions") && !only.includes(name)) next[name] = { port: take() };
  return next;
}
export function portsNeeded(only) {
  return only.length + (only.includes("firestore") ? 1 : 0) + 2 + (only.includes("functions") ? ["eventarc", "tasks"].filter((n) => !only.includes(n)).length : 0) + 1;
}
export function bootEnv(emulators, only, spare) {
  const env = { TBS_SPARE_PORT: String(spare), TBS_PORTS: JSON.stringify(Object.fromEntries(only.map((name) => [name, emulators[name].port]))) };
  for (const name of only) if (ENV_NAMES[name]) env[ENV_NAMES[name]] = `127.0.0.1:${emulators[name].port}`;
  return env;
}

export async function main(argv, { root = ROOT, project } = {}) {
  const split = argv.indexOf("--");
  if (split < 0 || split === argv.length - 1) throw new Error("Usage: free-ports.mjs [--only a,b] [--config firebase.json] -- <command ...>");
  const options = argv.slice(0, split); const command = argv.slice(split + 1);
  const opt = (name) => { const i = options.indexOf(name); return i >= 0 ? options[i + 1] : undefined; };
  const hasConfig = [".agents", ".claude"].some((dir) => existsSync(join(root, dir, "trust-before-scale.json")));
  const settings = hasConfig ? loadConfig(root).emulators ?? {} : {};
  if (!settings.config && !opt("--config")) throw new Error("Firebase helper is opt-in: configure emulators.config or pass --config firebase.json");
  const configPath = resolve(root, opt("--config") ?? settings.config ?? "firebase.json");
  const firebase = JSON.parse(readFileSync(configPath, "utf8"));
  const only = (opt("--only") ?? settings.only ?? Object.keys(firebase.emulators ?? {}).filter((n) => KNOWN.includes(n)).join(",")).split(",").filter(Boolean);
  const projectId = project ?? opt("--project") ?? settings.project ?? "demo-tbs";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ports = []; for (let i = 0; i < portsNeeded(only); i++) ports.push(await freePort());
    const emulators = isolate(firebase.emulators ?? {}, only, ports);
    const spare = ports.at(-1);
    const temp = join(dirname(configPath), `.${basename(configPath, ".json")}.tbs-${process.pid}-${ports[0]}.json`);
    writeFileSync(temp, JSON.stringify({ ...firebase, emulators }, null, 2));
    console.log(`[free-ports] ${only.map((name) => `${name}:${emulators[name].port}`).join(" ")} spare:${spare} (attempt ${attempt})`);
    try {
      const quoted = command.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ");
      const local = join(root, "node_modules", ".bin", "firebase");
      const firebaseBin = existsSync(local) ? local : "firebase";
      const result = spawnSync(firebaseBin, ["emulators:exec", "--config", temp, "--only", only.join(","), "--project", projectId, quoted],
        { cwd: root, encoding: "utf8", env: { ...process.env, ...bootEnv(emulators, only, spare) }, stdio: ["inherit", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
      process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
      const output = `${result.stdout}\n${result.stderr}`;
      if (result.status === 0 || !PORT_TAKEN.test(output) || attempt === 3) return result.status ?? 1;
      console.warn("[free-ports] a port was taken before the emulator bound it; retrying on fresh ports");
    } finally { rmSync(temp, { force: true }); }
  }
  return 1;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; })
    .catch((error) => { console.error(`[free-ports] ${error.message}`); process.exitCode = 1; });
}
