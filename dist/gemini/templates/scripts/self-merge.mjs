#!/usr/bin/env node
// Trust before scale, d4: the self-merging low-risk lane.
//
// A PR whose files are ALL low-risk merges once every gate log and the Codex review log prove
// green ON ITS EXACT HEAD. It is labelled before the merge, so `--owed` always finds it, and Claude
// reviews it afterwards. Everything else keeps the project's normal path.
//
//   node scripts/tbs/self-merge.mjs <pr> --gate <log> [--gate <log> ...] --review <log> [--dry-run]
//   node scripts/tbs/self-merge.mjs --owed
//   node scripts/tbs/self-merge.mjs --ack-skips
//
// Write each log so it proves its own head and result:
//   { echo "HEAD=$(git rev-parse HEAD)"; <gate command>; } > gate.log 2>&1; echo "EXIT=$?" >> gate.log
//   { echo "HEAD=$(git rev-parse HEAD)"; scripts/codex-review.sh <branch>; } > review.log 2>&1; echo "EXIT=$?" >> review.log
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, adoptionLevel, evidenceFor, isMain, loadConfig } from "./config.mjs";

const SHA = /^[0-9a-f]{40}$/;

/** @param {{path: string, status: string}[]} files @param {object} lane config.selfMerge */
export function eligibility(files, lane) {
  const allow = (lane.allow ?? []).map((source) => new RegExp(source));
  const block = (lane.block ?? []).map((source) => new RegExp(source));
  const reasons = [];
  if (!files.length) reasons.push("no changed files");
  for (const { path, status } of files) {
    if (/^evals\//.test(path) && !/^(added|A)$/.test(status)) {
      reasons.push(`${path}: changing an existing eval case loosens a gate`);
      continue;
    }
    if (/^(removed|D)$/.test(status) && (lane.testFile ? new RegExp(lane.testFile).test(path) : false)) {
      reasons.push(`${path}: deleting a test is not low-risk`);
      continue;
    }
    const blocked = block.find((pattern) => pattern.test(path));
    if (blocked) { reasons.push(`${path}: blocked by ${blocked.source}`); continue; }
    if (!allow.some((pattern) => pattern.test(path))) reasons.push(`${path}: outside the low-risk paths`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function reviewClean(log, head, review) {
  const { sameHead, passed } = evidenceFor(log, head, review.exitMarker);
  const ran = new RegExp(review.ranPattern).test(log);
  const findings = new RegExp(review.findingPattern).test(log);
  return { ok: sameHead && passed && ran && !findings, sameHead, passed, ran, findings };
}

export function decide({ info, files, gateLogs, reviewLog, config }) {
  const lane = config.selfMerge ?? {};
  const reasons = [];
  if (adoptionLevel(config) < 4) reasons.push("not adopted (level 4)");
  if (!lane.enabled) reasons.push("the self-merge lane is off in .claude/trust-before-scale.json (selfMerge.enabled)");
  if (info.baseRefName !== (config.baseBranch ?? "develop")) reasons.push(`base must be ${config.baseBranch ?? "develop"}`);
  if (info.state !== "OPEN" || info.isDraft) reasons.push("PR must be open and not a draft");
  if (!SHA.test(info.headRefOid ?? "")) reasons.push("PR head is not a full sha");
  // Another agent's lane (a bot fleet's external/* branches, its review label) is the owner's to review, never ours to merge.
  const foreignHead = new RegExp(lane.excludeHeads ?? "^external/");
  if (foreignHead.test(info.headRefName ?? "")) reasons.push(`${info.headRefName}: another agent's lane; the owner reviews it`);
  for (const label of info.labels ?? []) if ((lane.excludeLabels ?? ["external-agent"]).includes(label.name)) reasons.push(`label ${label.name}: another agent's lane; the owner reviews it`);
  reasons.push(...eligibility(files, lane).reasons);
  for (const required of lane.requiredComments ?? []) {
    const pattern = new RegExp(required.pattern, "m");
    const matched = (info.comments ?? []).some(({ body = "" }) => body.split(/\r?\n/).some((line) =>
      pattern.test(line) && [...line.matchAll(/\bhead[ \t]+([0-9a-f]{7,40})\b/g)]
        .some(([, sha]) => info.headRefOid?.startsWith(sha))));
    if (!matched) reasons.push(`missing required PR comment: ${required.name} on this head`);
  }
  if (!gateLogs.length) reasons.push("no gate log given (--gate)");
  // HEAD= and EXIT=0 alone prove nothing ran: an empty shell block prints both. The gate's own
  // output must show it ran (selfMerge.gateRanPattern), or the log is not evidence.
  const gateRan = lane.gateRanPattern ? new RegExp(lane.gateRanPattern, "m") : undefined;
  if (!gateRan) reasons.push("selfMerge.gateRanPattern is not set: no way to tell a gate log from an empty one");
  for (const { name, text } of gateLogs) {
    if (gateRan && !gateRan.test(text)) reasons.push(`${name}: no sign the gate ran (needs ${lane.gateRanPattern})`);
    const { sameHead, passed } = evidenceFor(text, info.headRefOid, config.mergeGate?.exitMarker ?? "EXIT=0");
    if (!sameHead) reasons.push(`${name}: not run on this head (needs one HEAD=${info.headRefOid} line)`);
    if (!passed) reasons.push(`${name}: last line is not ${config.mergeGate?.exitMarker ?? "EXIT=0"}`);
  }
  if (!reviewLog) reasons.push("no review log given (--review)");
  else {
    const review = reviewClean(reviewLog.text, info.headRefOid, { exitMarker: config.mergeGate?.exitMarker ?? "EXIT=0", ...lane.review });
    if (!review.sameHead) reasons.push("review: not run on this head");
    if (!review.passed) reasons.push("review: did not exit cleanly");
    if (!review.ran) reasons.push("review: no sign the review ran");
    if (review.findings) reasons.push("review: has findings");
  }
  return reasons;
}

function gh(args) { return execFileSync("gh", args, { encoding: "utf8" }).trim(); }

// Import legacy worktree logs once; markers preserve their audit trail.
function skipPaths(root) {
  const common = resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim());
  const file = resolve(common, "tbs-skips.log");
  const dirs = existsSync(resolve(common, "worktrees")) ? readdirSync(resolve(common, "worktrees")).map(name => resolve(common, "worktrees", name)) : [];
  for (const dir of dirs) {
    const old = resolve(dir, "tbs-skips.log"), marker = old + ".imported";
    if (!existsSync(old) || existsSync(marker)) continue;
    const lines = new Set((existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter(Boolean));
    for (const line of readFileSync(old, "utf8").split("\n").filter(Boolean)) lines.add(line);
    writeFileSync(file, [...lines].sort().join("\n") + "\n");
    writeFileSync(marker, new Date().toISOString() + "\n");
  }
  return { file, stamp: resolve(common, "tbs-skips.reviewed") };
}

export function run(argv, { root = ROOT, config = loadConfig(root), ghRun = gh, read = (path) => readFileSync(path, "utf8"), log = console.log } = {}) {
  const lane = config.selfMerge ?? {};
  const label = lane.label ?? "self-merged";
  const reviewedLabel = lane.reviewedLabel ?? "reviewed-after-merge";
  if (argv[0] === "--ack-skips") {
    const { file, stamp } = skipPaths(root);
    const at = new Date().toISOString();
    let previous = NaN;
    try { previous = Date.parse(read(stamp).split("\n")[0]); } catch {}
    if (existsSync(file)) for (const line of read(file).split("\n").filter(Boolean)) {
      const time = Date.parse(line.split("\t")[0]);
      if (!Number.isFinite(previous) || !Number.isFinite(time) || time > previous) log(`ACK HOOK SKIP\t${line}`);
    }
    // A machine with no git identity (CI runners) still records who acknowledged.
    let who;
    try { who = execFileSync("git", ["var", "GIT_AUTHOR_IDENT"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { who = `${process.env.USER || process.env.USERNAME || "unknown"} (no git identity)`; }
    writeFileSync(stamp, `${at}\n`);
    writeFileSync(stamp + ".audit", `${existsSync(stamp + ".audit") ? readFileSync(stamp + ".audit", "utf8") : ""}${at}\t${who}\n`);
    log(`hook skips acknowledged by ${who} at ${at}`);
    return 0;
  }
  if (argv[0] === "--owed") {
    const repo = ghRun(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
    const query = `repo:${repo} is:pr is:merged label:${JSON.stringify(label)} -label:${JSON.stringify(reviewedLabel)}`;
    const pages = JSON.parse(ghRun(["api", "-X", "GET", "search/issues", "-f", `q=${query}`, "-f", "per_page=100", "--paginate", "--slurp"]));
    const hits = pages.flatMap(page => page.items);
    const total = Math.max(0, ...pages.map(page => page.total_count));
    if (pages.some(page => page.incomplete_results) || total > hits.length) {
      throw new Error(`Cannot check owed reviews completely: GitHub search returned ${hits.length} of ${total} results (search is capped at 1000). Narrow the backlog and retry.`);
    }
    // Search omits merge SHA/time. Read each matching PR before printing any output.
    const owed = hits.map(hit => {
      const row = JSON.parse(ghRun(["api", `repos/{owner}/{repo}/pulls/${hit.number}`]));
      return { ...hit, mergedAt: row.merged_at, mergeCommit: { oid: row.merge_commit_sha } };
    });
    for (const row of owed) log(`#${row.number}\t${row.title}\t${row.mergeCommit?.oid ?? ""}`);
    if (!owed.length) log("nothing owed");
    // Git resolves both ordinary checkouts and worktrees; the hook writes to that same directory.
    let skips = "";
    let reviewed = NaN;
    try {
      const { file, stamp } = skipPaths(root);
      skips = read(file);
      try { reviewed = Date.parse(read(stamp).split("\n")[0]); }
      catch { /* No acknowledgement yet: preserve the existing cutoff. */ }
    } catch { /* No checkout or no skips yet. */ }
    const oldest = owed.length ? Math.min(...owed.map((row) => Date.parse(row.mergedAt))) : -Infinity;
    for (const line of skips.split("\n").filter(Boolean)) {
      const time = Date.parse(line.split("\t")[0]);
      // Unparseable skip times remain visible: acknowledgement cannot prove they are older.
      if (!Number.isFinite(time) ||
        ((!Number.isFinite(reviewed) || time > reviewed) && (!Number.isFinite(oldest) || time >= oldest))) {
        log(`HOOK SKIP\t${line}`);
      }
    }
    return 0;
  }
  if (adoptionLevel(config) < 4) { log("REFUSED: not adopted (level 4)"); return 1; }
  const pr = argv[0];
  if (!/^\d+$/.test(pr ?? "")) throw new Error("Usage: self-merge.mjs <pr> --gate <log> [--gate <log>] --review <log> [--dry-run] | --owed | --ack-skips");
  const gates = []; let review; let dryRun = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--gate" && argv[i + 1]) gates.push(argv[++i]);
    else if (argv[i] === "--review" && argv[i + 1]) review = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  const view = () => JSON.parse(ghRun(["pr", "view", pr, "--json", "headRefOid,headRefName,baseRefName,state,isDraft,labels,comments"]));
  const info = view();
  const files = JSON.parse(ghRun(["api", `repos/{owner}/{repo}/pulls/${pr}/files?per_page=100`, "--paginate", "--slurp"])).flat()
    .flatMap((file) => [{ path: file.filename, status: file.status },
      ...(file.previous_filename ? [{ path: file.previous_filename, status: "removed" }] : [])]);
  let reviewLog;
  const linkReasons = [];
  if (review) {
    reviewLog = { name: review, text: read(review) };
    // A review wrapper may print only `log=<path>` and keep the findings in that file: read it too,
    // or a review with findings would pass for clean.
    const finding = new RegExp(lane.review?.findingPattern ?? "\\[P[0-3]\\]");
    for (const [, linked] of reviewLog.text.matchAll(/^log=(.+)$/gm)) {
      let text;
      try { text = read(linked.trim()); }
      catch { linkReasons.push(`review: cannot read the linked review log ${linked.trim()}`); continue; }
      if (finding.test(text)) linkReasons.push(`review: the linked review log ${linked.trim()} has findings`);
    }
  }
  const reasons = decide({
    info, files, config,
    gateLogs: gates.map((path) => ({ name: path, text: read(path) })),
    reviewLog,
  });
  reasons.push(...linkReasons);
  // A PR that moved while we read the evidence must not borrow another head's proof.
  if (JSON.stringify(view()) !== JSON.stringify(info)) reasons.push("the PR changed while checking; run again");
  log(reasons.length ? `REFUSED #${pr}` : `ELIGIBLE #${pr} at ${info.headRefOid}`);
  for (const reason of reasons) log(`- ${reason}`);
  if (reasons.length) return 1;
  if (dryRun) return 0;
  // Label and comment FIRST: if the merge then half-fails, --owed still finds the PR. Never remove the
  // label afterwards; --owed lists merged PRs only, so a label left on an unmerged PR does no harm.
  ghRun(["label", "create", label, "--description", "Self-merged low-risk PR; review owed", "--force"]);
  ghRun(["pr", "edit", pr, "--add-label", label]);
  ghRun(["pr", "comment", pr, "--body", `Self-merged under the low-risk lane (gates and Codex review green on ${info.headRefOid.slice(0, 8)}). Review owed: label \`${reviewedLabel}\` once read.`]);
  // This runs gh from Node, where a Bash hook cannot see it, so the head and exit checks above are the gate.
  ghRun(["pr", "merge", pr, "--merge", "--match-head-commit", info.headRefOid]);
  log(`MERGED #${pr}`);
  return 0;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
