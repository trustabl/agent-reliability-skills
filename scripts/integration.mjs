#!/usr/bin/env node
// End-to-end checks the smoke test does not make, each through a real MCP
// client, a real server process and the real analyzer:
//   - the packed release file installs and runs the way `npx -y <tgz>` does;
//   - output_path writes, replaces Forge's own file, refuses a hand-written
//     file, and refuses a path outside the repository;
//   - a repository with no agent SDK gets the MCP advice to pass `policy`;
//   - TRUSTABL_VERSION pins the analyzer release, and too old a pin is refused;
//   - with the network blocked, a warm cache still generates the skill, and a
//     cold cache says what is wrong.
// Needs network for the downloads. Set GITHUB_TOKEN in CI to stay under
// GitHub's anonymous rate limit.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, stampedSdks, text } from "./mcp-client.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repo, "dist", "index.js");
const fixture = path.join(repo, "testdata", "claude-sdk");
const { version } = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const SKILL_DESTINATION = ".claude/skills/trustabl-pre-coding/SKILL.md";
// The oldest analyzer the server accepts (server/version.js).
const PINNED = "v0.1.14";
const isWindows = process.platform === "win32";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-reliability-skills-integration-"));
const tmp = (name) => {
  const d = path.join(scratch, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// A home and cache of its own, so the run starts with nothing cached.
function homeEnv(home, extra = {}) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    ...extra,
  };
  delete env.TRUSTABL_BIN;
  delete env.TRUSTABL_VERSION;
  return env;
}

function check(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok - ${msg}`);
}

const clients = [];
async function start(opts, name = "agent-reliability-skills-integration") {
  const client = new Client({ echoStderr: false, ...opts });
  clients.push(client);
  const init = await client.initialize(name);
  return { client, init };
}

function copyFixture(name) {
  const d = tmp(name);
  fs.cpSync(fixture, d, { recursive: true });
  return d;
}

// A proxy that refuses every connection and records where each one was going,
// so "offline" is checked rather than assumed.
function refusingProxy() {
  const hosts = [];
  const server = http.createServer((req, res) => {
    hosts.push(req.headers.host ?? req.url);
    res.writeHead(502).end();
  });
  server.on("connect", (req, socket) => {
    hosts.push(req.url);
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, hosts, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function offlineEnv(home, proxyUrl, extra = {}) {
  return homeEnv(home, {
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    http_proxy: proxyUrl,
    NO_PROXY: "",
    no_proxy: "",
    // Makes Node's fetch honor the proxy variables (Node 22.21 and later).
    NODE_USE_ENV_PROXY: "1",
    ...extra,
  });
}

let proxy;
let tarballServer;
try {
  const home = tmp("home");
  const env = homeEnv(home);

  // 1. The packed release file, started the way the README's install does.
  const packDir = tmp("pack");
  const npm = isWindows ? "npm.cmd" : "npm";
  const packed = spawnSync(npm, ["pack", "--pack-destination", packDir], { cwd: repo, encoding: "utf8", shell: isWindows });
  check(packed.status === 0, `npm pack succeeded${packed.status === 0 ? "" : `: ${packed.stderr}`}`);
  const tgz = path.join(packDir, `agent-reliability-skills-${version}.tgz`);
  check(fs.existsSync(tgz), `npm pack wrote agent-reliability-skills-${version}.tgz`);
  {
    // The README installs from the release URL, a remote tarball. Serve the
    // packed file over HTTP so npx gets the same kind of spec. (A bare file
    // path is not the same: npx tries to execute it as a command.)
    tarballServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      fs.createReadStream(tgz).pipe(res);
    });
    await new Promise((resolve) => tarballServer.listen(0, "127.0.0.1", resolve));
    const tgzUrl = `http://127.0.0.1:${tarballServer.address().port}/${path.basename(tgz)}`;
    const npx = isWindows ? "npx.cmd" : "npx";
    // A fresh npm cache, so the install cannot borrow anything from this machine.
    const npxEnv = { ...env, npm_config_cache: tmp("npm-cache"), npm_config_update_notifier: "false" };
    const { client, init } = await start({ command: npx, args: ["-y", tgzUrl], shell: isWindows, env: npxEnv });
    check(init.serverInfo?.name === "agent-reliability-skills", "packed install: serverInfo is agent-reliability-skills");
    check(init.serverInfo?.version === version, `packed install: serverInfo version is ${version}`);
    const { tools } = await client.request("tools/list", {});
    check(tools.some((t) => t.name === "trustabl_forge"), "packed install: tools/list includes trustabl_forge");
    const res = await client.call({ path: fixture });
    check(!res.isError && stampedSdks(res.content[1]?.text)?.includes("claude_sdk"), "packed install: generates a skill stamped with claude_sdk");
    client.close();
  }

  // 2. output_path through the whole stack.
  {
    const { client } = await start({ serverPath, env });
    const target = copyFixture("write");
    const dest = path.join(target, ...SKILL_DESTINATION.split("/"));

    const first = await client.call({ path: target, output_path: SKILL_DESTINATION });
    check(!first.isError, "output_path: first write succeeds");
    check(fs.readFileSync(dest, "utf8") === first.content[1].text, "output_path: the file equals the returned SKILL.md");
    check(text(first).includes(`Written to: ${dest}`), "output_path: the summary names the written file");

    fs.appendFileSync(dest, "\nedited by hand\n");
    const second = await client.call({ path: target, output_path: SKILL_DESTINATION });
    check(!second.isError, "output_path: a second write replaces Forge's own file");
    check(fs.readFileSync(dest, "utf8") === second.content[1].text, "output_path: the replaced file equals the new SKILL.md");

    const mine = path.join(target, "NOTES.md");
    fs.writeFileSync(mine, "mine\n");
    const refused = await client.call({ path: target, output_path: "NOTES.md" });
    check(refused.isError && /not generated by Forge/.test(text(refused)), "output_path: a hand-written file is refused");
    check(fs.readFileSync(mine, "utf8") === "mine\n", "output_path: the hand-written file is unchanged");

    const outside = await client.call({ path: target, output_path: "../escaped.md" });
    check(outside.isError && /not a file inside the target directory/.test(text(outside)), "output_path: a path outside the repository is refused");
    check(!fs.existsSync(path.join(target, "..", "escaped.md")), "output_path: nothing is written outside the repository");

    // 3. No agent SDK: the advice is the policy input, not a CLI flag.
    const plain = tmp("no-sdk");
    fs.writeFileSync(path.join(plain, "package.json"), '{ "name": "plain", "dependencies": { "express": "^5.0.0" } }\n');
    const none = await client.call({ path: plain });
    check(none.isError && text(none).startsWith("Forge found no supported agent SDK"), "no SDK: the error explains what Forge found");
    check(text(none).includes("call trustabl_forge again with the policy input"), "no SDK: the error says to pass policy");
    check(!text(none).includes("run 'trustabl forge"), "no SDK: the CLI command advice is gone");
    const withPolicy = await client.call({ path: plain, policy: ["mcp"] });
    check(!withPolicy.isError && stampedSdks(withPolicy.content[1]?.text)?.includes("mcp"), "no SDK: passing policy generates the skill");
    check(fs.readdirSync(plain).join() === "package.json", "no SDK: nothing is written without output_path");
    client.close();
  }

  // 4. A pinned analyzer version, end to end.
  {
    const { client } = await start({ serverPath, env: { ...env, TRUSTABL_VERSION: PINNED } });
    const res = await client.call({ path: fixture });
    check(!res.isError, `pinned ${PINNED}: generates a skill`);
    check(client.stderr.includes(`installed trustabl ${PINNED}`), `pinned ${PINNED}: downloads and installs that release`);
    check(fs.existsSync(path.join(home, ".agent-reliability-skills", PINNED)), `pinned ${PINNED}: cached under its own version`);
    client.close();

    const { client: old } = await start({ serverPath, env: { ...env, TRUSTABL_VERSION: "v0.1.13" } });
    const refused = await old.call({ path: fixture });
    check(refused.isError && text(refused).includes("needs analyzer 0.1.14 or later"), "pinned v0.1.13: refused as too old");
    old.close();
  }

  // 5. Offline. The cache is warm from the runs above.
  proxy = await refusingProxy();
  {
    const { client } = await start({ serverPath, env: offlineEnv(home, proxy.url) });
    const res = await client.call({ path: fixture });
    // Node's fetch honors the proxy variables only from Node 22.21 and 24.0
    // (NODE_USE_ENV_PROXY). On an older Node the server's lookup bypasses the
    // proxy, reaches GitHub, and nothing here is offline.
    check(
      proxy.hosts.includes("api.github.com:443"),
      `offline: the server's GitHub lookup went to the blocking proxy (Node ${process.version}; needs 22.21 or later); ` +
        `seen: ${[...new Set(proxy.hosts)].join(", ") || "none"}`,
    );
    check(proxy.hosts.includes("github.com:443"), "offline: the analyzer's rules fetch went to the blocking proxy");
    check(!res.isError, `offline: a warm cache still generates the skill${res.isError ? ` (${text(res)})` : ""}`);
    check(stampedSdks(res.content[1]?.text)?.includes("claude_sdk"), "offline: the skill is stamped with claude_sdk");
    check(client.stderr.includes("could not reach GitHub"), "offline: the server says it used the cached analyzer");
    client.close();

    const { client: pinned } = await start({ serverPath, env: offlineEnv(home, proxy.url, { TRUSTABL_VERSION: PINNED }) });
    const pinnedRes = await pinned.call({ path: fixture });
    check(!pinnedRes.isError, `offline: a cached pinned ${PINNED} generates the skill`);
    pinned.close();

    const { client: cold } = await start({ serverPath, env: offlineEnv(tmp("cold-home"), proxy.url) });
    const coldRes = await cold.call({ path: fixture });
    check(coldRes.isError && /no usable trustabl is cached/.test(text(coldRes)), "offline: a cold cache explains that nothing is cached");
    cold.close();
  }

  console.log("integration test passed");
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  for (const c of clients) c.close();
  proxy?.server.close();
  tarballServer?.close();
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (err) {
    // A leftover temp folder is not a test failure (Windows can hold a file open briefly).
    console.error(`warning: could not remove ${scratch}: ${err.message}`);
  }
}
