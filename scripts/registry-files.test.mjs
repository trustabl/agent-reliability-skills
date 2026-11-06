// The listing files must agree with each other and with the server: the MCP
// Registry rejects a publish whose server.json name differs from the npm
// package's mcpName, and the .mcpb manifest should list the tool the server
// actually registers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));

test("server.json name matches package.json mcpName", () => {
  assert.equal(json("server.json").name, json("package.json").mcpName);
});

test("server.json description fits the registry's 100-character limit", () => {
  assert.ok(json("server.json").description.length <= 100);
});

test("the bundle manifest is named agent-reliability-skills and lists the server's tool", () => {
  const manifest = json("manifest.json");
  assert.equal(manifest.name, "agent-reliability-skills");
  const tool = read("server/tool.js").match(/TOOL_NAME = "([^"]+)"/)[1];
  assert.deepEqual(manifest.tools.map((t) => t.name), [tool]);
});
