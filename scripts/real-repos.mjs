#!/usr/bin/env node
// Runs dist/index.js over stdio against the public repositories pinned in
// real-repos.json and checks, for each one:
//   - a call with only `path` succeeds, writes nothing, and returns a stamped
//     SKILL.md whose sdks match the SDKs the repository declares;
//   - a call with `output_path` writes exactly that SKILL.md, and a second
//     call replaces it;
//   - a repository with no agent SDK gets an error that says so.
// "expect" in real-repos.json lists every supported SDK declared in any
// dependency manifest of the repository, root or subfolder, read by parsing
// the manifests rather than by this server. "expectAtRoot" is the subset
// declared in the root manifests.
//
//   node scripts/real-repos.mjs [--dir <clone cache>] [--only owner/name,...] [--json <results file>]
//
// Needs git and network for the first run. Clones are shallow, pinned to the
// listed commit, and reused on later runs. Nothing in a clone is executed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, stampedSdks, text } from "./mcp-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "..", "dist", "index.js");
const OUTPUT_PATH = ".claude/skills/trustabl-pre-coding/SKILL.md";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const dir = path.resolve(arg("--dir") ?? path.join(os.tmpdir(), "agent-reliability-skills-real-repos"));
const only = arg("--only")?.split(",");
const jsonOut = arg("--json");
const repos = JSON.parse(fs.readFileSync(path.join(here, "real-repos.json"), "utf8"))
  .filter((r) => !only || only.includes(r.repo));

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "advice.detachedHead=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function checkout({ repo, commit }) {
  const target = path.join(dir, repo.replace("/", "__"));
  if (fs.existsSync(path.join(target, ".git"))) {
    if (git(target, "rev-parse", "HEAD") === commit) return target;
  } else {
    fs.mkdirSync(target, { recursive: true });
    git(target, "init", "-q");
  }
  git(target, "fetch", "-q", "--depth", "1", `https://github.com/${repo}`, commit);
  git(target, "checkout", "-q", "FETCH_HEAD");
  return target;
}

// Removes the written SKILL.md and any of its folders this run created.
function removeWritten(target, created) {
  fs.rmSync(path.join(target, OUTPUT_PATH), { force: true });
  for (const d of created) fs.rmSync(path.join(target, d), { recursive: true, force: true });
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const list = (a) => (a.length ? a.join(", ") : "-");

// A home of its own, kept between runs, so the analyzer binary and rules are
// downloaded once rather than on every run.
const home = path.join(dir, ".home");
fs.mkdirSync(home, { recursive: true });
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
};
delete env.TRUSTABL_BIN;

const client = new Client({ serverPath, env, echoStderr: false });
await client.initialize("agent-reliability-skills-real-repos");

const results = [];
for (const entry of repos) {
  const row = { repo: entry.repo, commit: entry.commit, layout: entry.layout, expect: entry.expect, problems: [] };
  results.push(row);
  try {
    const target = checkout(entry);

    const started = Date.now();
    const res = await client.call({ path: target });
    row.seconds = (Date.now() - started) / 1000;
    if (git(target, "status", "--porcelain")) row.problems.push("a call without output_path changed the repository");

    if (entry.expect.length === 0) {
      row.detected = [];
      row.message = text(res);
      if (!res.isError) row.problems.push("expected an error for a repository with no agent SDK");
      else if (!/sdk/i.test(row.message)) row.problems.push(`error does not mention the SDK: ${row.message}`);
      continue;
    }
    if (res.isError) {
      row.detected = [];
      row.message = text(res);
      row.problems.push(`call failed: ${row.message}`);
      continue;
    }
    const skill = res.content[1]?.text;
    row.detected = stampedSdks(skill) ?? [];
    if (!stampedSdks(skill)) row.problems.push("SKILL.md has no stamp");
    row.missing = entry.expect.filter((s) => !row.detected.includes(s));
    row.extra = row.detected.filter((s) => !entry.expect.includes(s));
    if (!sameSet(row.detected, entry.expect)) row.problems.push("detected SDKs differ from the declared ones");

    // The opt-in write, then a second write that must replace the first.
    const created = [".claude", ".claude/skills", ".claude/skills/trustabl-pre-coding"]
      .filter((d) => !fs.existsSync(path.join(target, d)));
    if (fs.existsSync(path.join(target, OUTPUT_PATH))) {
      row.write = "skipped (file already in the repository)";
      continue;
    }
    try {
      for (const attempt of ["write", "replace"]) {
        const w = await client.call({ path: target, output_path: OUTPUT_PATH });
        const file = path.join(target, OUTPUT_PATH);
        if (w.isError) row.problems.push(`${attempt} failed: ${text(w)}`);
        else if (!fs.existsSync(file)) row.problems.push(`${attempt} reported success but wrote no file`);
        else if (fs.readFileSync(file, "utf8") !== w.content[1]?.text) row.problems.push(`${attempt}: file differs from the returned SKILL.md`);
      }
      row.write = row.problems.some((p) => /^(write|replace)/.test(p)) ? "failed" : "ok";
    } finally {
      removeWritten(target, created);
    }
  } catch (err) {
    row.problems.push(err.message);
  } finally {
    row.pass = row.problems.length === 0;
    process.stderr.write(`${row.pass ? "pass" : "FAIL"} ${entry.repo}${row.pass ? "" : ` - ${row.problems.join("; ")}`}\n`);
  }
}
client.close();

console.log("| Repository | Layout | Declared SDKs | Detected | Missing | Extra | Seconds | Write | Result |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  console.log(
    `| ${r.repo} | ${r.layout} | ${list(r.expect)} | ${list(r.detected ?? [])} | ${list(r.missing ?? [])} | ` +
      `${list(r.extra ?? [])} | ${r.seconds?.toFixed(1) ?? "-"} | ${r.write ?? "-"} | ${r.pass ? "pass" : "FAIL"} |`,
  );
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed} of ${results.length} repositories passed.`);
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(results, null, 2)}\n`);
process.exitCode = passed === results.length ? 0 : 1;
