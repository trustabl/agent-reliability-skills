// Runs the guard steps of .github/workflows/release.yml, taken from the
// workflow itself, against throwaway checkouts: a tag must match package.json,
// and a release may not ship a README with unmeasured results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(ROOT, ".github/workflows/release.yml");

// The `run: |` block of the step with this name, with the YAML indent removed.
function stepScript(name) {
  const lines = fs.readFileSync(WORKFLOW, "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `release.yml has no step "${name}"`);
  const run = lines.findIndex((l, i) => i > at && l.trim() === "run: |");
  const runIndent = lines[run].match(/^ */)[0].length;
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && line.match(/^ */)[0].length <= runIndent) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return body.map((l) => l.slice(indent)).join("\n");
}

const bash = spawnSync("bash", ["--version"]).status === 0;

function guard(step, { tag, version = "0.1.0", readme = "# Agent Reliability Skill Generator\n" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-guard-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "agent-reliability-skill-generator", version }));
  fs.writeFileSync(path.join(dir, "README.md"), readme);
  const run = spawnSync("bash", ["-e", "-c", stepScript(step)], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: tag },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return run;
}

const TAG = "Tag must match package.json";
const README = "README has no unmeasured results";

test("a tag matching package.json passes", { skip: !bash }, () => {
  assert.equal(guard(TAG, { tag: "v0.1.0" }).status, 0);
  assert.equal(guard(TAG, { tag: "v0.1.0-rc.1", version: "0.1.0-rc.1" }).status, 0);
});

test("a tag that differs from package.json fails", { skip: !bash }, () => {
  const run = guard(TAG, { tag: "v0.1.1" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /tag v0\.1\.1 does not match package\.json version 0\.1\.0/);
});

test("a measured README passes for releases and pre-releases", { skip: !bash }, () => {
  const readme = "Roots: Cursor yes, Claude Code yes.\n";
  assert.equal(guard(README, { tag: "v0.1.0", readme }).status, 0);
  assert.equal(guard(README, { tag: "v0.1.0-rc.1", readme }).status, 0);
});

test("RESULT- markers block every tag", { skip: !bash }, () => {
  for (const tag of ["v0.1.0", "v0.1.0-rc.1"]) {
    const run = guard(README, { tag, readme: "Roots: RESULT-ROOTS\n" });
    assert.equal(run.status, 1, tag);
    assert.match(run.stdout, /still has RESULT- markers/, tag);
  }
});

test("pending markers block a release but not a pre-release", { skip: !bash }, () => {
  const readme = "Roots: pending\n";
  assert.equal(guard(README, { tag: "v0.1.0-rc.1", readme }).status, 0);
  const run = guard(README, { tag: "v0.1.0", readme });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /still has 'pending' markers/);
});
