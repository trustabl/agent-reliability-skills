// Runs check-install-paths.mjs against throwaway repositories: it passes only
// when README.md and mcp.json both point at this version's release file and
// neither installs from the repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-install-paths.mjs");
const URL_010 = "https://github.com/trustabl/agent-reliability-skill-generator/releases/download/v0.1.0/agent-reliability-skill-generator-0.1.0.tgz";

function check({ version = "0.1.0", readme, mcp }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-paths-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "agent-reliability-skill-generator", version }));
  fs.writeFileSync(path.join(dir, "README.md"), readme);
  fs.writeFileSync(path.join(dir, "mcp.json"), mcp);
  const run = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return run;
}

const mcpFor = (pkg) => JSON.stringify({ mcpServers: { "agent-reliability-skill-generator": { command: "npx", args: ["-y", pkg] } } });
const good = { readme: `Install: \`npx -y ${URL_010}\`\n`, mcp: mcpFor(URL_010) };

test("passes when both files install the release file", () => {
  const run = check(good);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /install paths point at/);
});

test("links to the repository's pages are not installs", () => {
  const readme = `${good.readme}Report bugs at https://github.com/trustabl/agent-reliability-skill-generator/issues.\n` +
    "Releases: https://github.com/trustabl/agent-reliability-skill-generator/releases\n";
  assert.equal(check({ ...good, readme }).status, 0);
});

test("fails on an npx github: install", () => {
  const run = check({ ...good, mcp: mcpFor("github:trustabl/agent-reliability-skill-generator") });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /mcp\.json: installs from the repository/);
});

test("fails on a git URL install", () => {
  for (const repo of ["https://github.com/trustabl/agent-reliability-skill-generator", "git+https://github.com/trustabl/agent-reliability-skill-generator.git"]) {
    const run = check({ ...good, readme: `${good.readme}Or: npx -y ${repo}\n` });
    assert.equal(run.status, 1, repo);
    assert.match(run.stderr, /README\.md: installs from the repository/, repo);
  }
});

test("fails when a file points at another version's release file", () => {
  const run = check({ ...good, version: "0.2.0" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /README\.md: does not reference .*v0\.2\.0\/agent-reliability-skill-generator-0\.2\.0\.tgz/);
  assert.match(run.stderr, /mcp\.json: does not reference/);
});

test("fails when one file lacks the release file", () => {
  const run = check({ ...good, readme: "Install it somehow.\n" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /README\.md: does not reference/);
  assert.doesNotMatch(run.stderr, /mcp\.json/);
});
