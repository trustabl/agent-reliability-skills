#!/usr/bin/env node
// Agent Reliability Skill Generator MCP server: generates a pre-coding reliability skill
// (SKILL.md) for the repository an agent is working in, by running the
// analyzer's `trustabl forge`.
//
//   trustabl_forge   generate the skill; optionally write it into the repo
//
// stdout is reserved for the MCP protocol; all logging goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runCli } from "./forge.js";
import {
  forgeTool,
  TOOL_ANNOTATIONS,
  TOOL_DESCRIPTION,
  TOOL_INPUT_SCHEMA,
  TOOL_NAME,
  TOOL_TITLE,
} from "./tool.js";
import { createResolver } from "./trustabl-bin.js";

// Replaced with package.json's version by build.mjs; "dev" when run unbundled.
// eslint-disable-next-line no-undef
const VERSION = typeof __FORGE_VERSION__ === "string" ? __FORGE_VERSION__ : "dev";
const log = (msg) => process.stderr.write(`[agent-reliability-skill-generator] ${msg}\n`);

const server = new McpServer({ name: "agent-reliability-skill-generator", version: VERSION });
const ensureTrustabl = createResolver();

// The client's workspace roots, or null when it did not declare the roots capability.
async function clientRoots() {
  if (!server.server.getClientCapabilities()?.roots) return null;
  try {
    const { roots } = await server.server.listRoots();
    return roots.map((r) => r.uri);
  } catch (err) {
    log(`roots/list failed: ${err.message}`);
    return null;
  }
}

server.registerTool(
  TOOL_NAME,
  { title: TOOL_TITLE, description: TOOL_DESCRIPTION, inputSchema: TOOL_INPUT_SCHEMA, annotations: TOOL_ANNOTATIONS },
  (input) => forgeTool(input, { ensureBin: ensureTrustabl, run: runCli, getRoots: clientRoots }),
);

await server.connect(new StdioServerTransport());
log(`MCP server ${VERSION} ready`);
