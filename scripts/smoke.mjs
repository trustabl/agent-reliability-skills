#!/usr/bin/env node
// Boots dist/index.js over stdio the way an MCP client does and checks the
// handshake, the tool listing, and real trustabl_forge calls against the
// fixture repository: cold start, warm start, errors, and MCP roots.
// Needs network on the first call (analyzer binary + rules). Set GITHUB_TOKEN
// in CI to stay under GitHub's anonymous rate limit.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, text } from "./mcp-client.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repo, "dist", "index.js");
const fixture = path.join(repo, "testdata", "claude-sdk");
// A fresh home and cache, so the first start is a genuine cold start: no
// cached trustabl binary and no cached rules.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-reliability-skills-smoke-"));
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
};
delete env.TRUSTABL_BIN;

function check(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok - ${msg}`);
}
function expectSkill(res, label) {
  check(!res.isError, `${label}: not an error${res.isError ? ` (${text(res)})` : ""}`);
  check(/<!-- generated: [^>]*sdks: [^|]*claude_sdk/.test(res.content[1]?.text ?? ""), `${label}: SKILL.md stamped with claude_sdk`);
  return res.content[1].text;
}

let client;
try {
  // Cold start: handshake, listing, first real call.
  client = new Client({ serverPath, env });
  const init = await client.initialize("agent-reliability-skills-smoke");
  check(init.serverInfo?.name === "agent-reliability-skills", "initialize returns serverInfo agent-reliability-skills");
  const { tools } = await client.request("tools/list", {});
  const tool = tools.find((t) => t.name === "trustabl_forge");
  check(tool, "tools/list includes trustabl_forge");
  check(tool.title === "Generate a pre-coding reliability skill", "tool has a top-level title");
  check(
    tool.annotations?.readOnlyHint === false && tool.annotations?.destructiveHint === true,
    "tool has readOnlyHint false and destructiveHint true",
  );
  const coldSkill = expectSkill(await client.call({ path: fixture }), "cold start");
  check(client.stderr.includes("downloading "), "cold start downloaded the analyzer binary");
  check(client.stderr.includes("checksum verified"), "cold start verified the checksum");
  check(JSON.stringify(fs.readdirSync(fixture)) === JSON.stringify(["package.json"]), "no file written without output_path");

  const bad = await client.call({ path: fixture, policy: ["not_a_category"] });
  check(bad.isError && text(bad).includes('unknown policy category "not_a_category"'), "invalid category returns the CLI's error");
  const noPath = await client.call({});
  check(noPath.isError && text(noPath).startsWith("Pass `path`"), "no path and no roots asks for path");
  client.close();

  // Warm start: a new process must reuse the cached binary.
  client = new Client({ serverPath, env });
  await client.initialize("agent-reliability-skills-smoke");
  expectSkill(await client.call({ path: fixture }), "warm start");
  check(!client.stderr.includes("downloading "), "warm start reused the cached binary");
  client.close();

  // Roots: no path, workspace reported by the client.
  client = new Client({ serverPath, env, roots: [fixture] });
  await client.initialize("agent-reliability-skills-smoke");
  const rootsRes = await client.call({});
  const rootsSkill = expectSkill(rootsRes, "roots");
  check(rootsRes.content[0].text.includes(fixture), "roots: the summary names the reported workspace");
  check(rootsSkill === coldSkill, "roots: same SKILL.md as passing the path explicitly");
  client.close();

  console.log("smoke test passed");
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
  client?.close();
} finally {
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
