// A minimal MCP client over stdio, the way an MCP client starts and talks to
// the server. Shared by smoke.mjs and real-repos.mjs.
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export class Client {
  // roots: directories to report through MCP roots, or null to not declare the capability.
  constructor({ serverPath, env, roots = null, echoStderr = true }) {
    this.roots = roots;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.proc = spawn(process.execPath, [serverPath], { env, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      buf += chunk;
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.onMessage(JSON.parse(line));
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
      if (echoStderr) process.stderr.write(chunk);
    });
  }

  onMessage(msg) {
    if (msg.method === "roots/list" && msg.id !== undefined) {
      const roots = (this.roots ?? []).map((dir) => ({ uri: pathToFileURL(dir).href, name: path.basename(dir) }));
      this.send({ jsonrpc: "2.0", id: msg.id, result: { roots } });
      return;
    }
    const done = this.pending.get(msg.id);
    if (done) {
      this.pending.delete(msg.id);
      done(msg);
    }
  }

  send(msg) {
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  request(method, params, timeoutMs = 300_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async initialize(clientName) {
    const capabilities = this.roots ? { roots: {} } : {};
    const res = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities,
      clientInfo: { name: clientName, version: "0" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return res;
  }

  call(args) {
    return this.request("tools/call", { name: "trustabl_forge", arguments: args });
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

export const text = (res) => res.content.map((c) => c.text).join("\n");

// The sdks field of the SKILL.md stamp, or null when there is no stamp.
export function stampedSdks(skill) {
  const m = /<!-- generated: [^>]*?\| sdks: ([^|]*?) \|/.exec(skill ?? "");
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
}
