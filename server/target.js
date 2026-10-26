// Picks the repository directory to run Forge on: the `path` input, or the
// workspace the client reports through MCP roots. It never falls back to the
// server's working directory. Like the analyzer's MCP server (callScan in
// internal/mcpserver/server.go), Forge refuses to guess: some clients start
// servers from the user's home directory, and Forge's detection walks the
// whole tree under the target.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ToolError } from "./errors.js";

export const NEED_PATH =
  "Pass `path`: the absolute path of the repository to generate the skill for. This client did not report " +
  "a workspace (MCP roots), and Forge does not guess one from the server's working directory.";

/** The local path of the first file:// root, or null. */
export function firstFileRoot(uris) {
  for (const uri of uris ?? []) {
    if (typeof uri !== "string" || !uri.startsWith("file://")) continue;
    try {
      return fileURLToPath(uri);
    } catch {
      // Malformed URI: try the next root.
    }
  }
  return null;
}

export async function resolveTarget(pathInput, getRoots) {
  const p = pathInput?.trim();
  if (p && /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    throw new ToolError(`Forge takes a local directory, not a URL: ${p}`);
  }

  let dir;
  if (p && path.isAbsolute(p)) {
    dir = path.resolve(p);
  } else {
    const root = firstFileRoot(await getRoots());
    if (!root) {
      throw new ToolError(p ? `path "${p}" is relative and this client reported no workspace to resolve it against. ${NEED_PATH}` : NEED_PATH);
    }
    dir = p ? path.resolve(root, p) : root;
  }

  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new ToolError(`Path does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) throw new ToolError(`Path is not a directory: ${dir}. Forge takes a repository directory.`);
  return dir;
}
