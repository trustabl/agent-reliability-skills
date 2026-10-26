import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  assetName,
  createResolver,
  expectedChecksum,
  finalizeInstall,
  platformTarget,
} from "./trustabl-bin.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "forge-bin-test-"));
const quiet = () => {};

// A fetch stand-in that replays canned responses and records the URLs asked for.
function fakeFetch(...responses) {
  const fn = async (url) => {
    fn.calls.push(url);
    const r = responses.shift();
    if (!r) throw new Error(`unexpected fetch: ${url}`);
    return r;
  };
  fn.calls = [];
  return fn;
}
const latest = (tag) => ({ ok: true, status: 200, json: async () => ({ tag_name: tag }) });

// Pretend `version` is already installed in the cache under home.
function seedCache(home, version) {
  const { exe } = platformTarget();
  const dir = path.join(home, ".trustabl-forge", version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, exe), "");
  return path.join(dir, exe);
}

test("platformTarget maps Node's names onto the release asset matrix", () => {
  assert.deepEqual(platformTarget("darwin", "arm64"), { osName: "darwin", arch: "arm64", ext: "tar.gz", exe: "trustabl" });
  assert.deepEqual(platformTarget("linux", "x64"), { osName: "linux", arch: "amd64", ext: "tar.gz", exe: "trustabl" });
  // Windows releases are amd64 only; arm64 Windows runs them under emulation.
  assert.deepEqual(platformTarget("win32", "arm64"), { osName: "windows", arch: "amd64", ext: "zip", exe: "trustabl.exe" });
  assert.throws(() => platformTarget("freebsd", "x64"), /Unsupported OS/);
  assert.throws(() => platformTarget("linux", "ia32"), /Unsupported architecture/);
});

test("assetName follows the analyzer's goreleaser name_template", () => {
  assert.equal(
    assetName("v0.1.15", { osName: "linux", arch: "amd64", ext: "tar.gz" }),
    "trustabl_0.1.15_linux_amd64.tar.gz",
  );
});

test("expectedChecksum matches the asset name exactly", () => {
  const text = "aaa  trustabl_0.1.15_linux_amd64.tar.gz.sbom\nbbb  trustabl_0.1.15_linux_amd64.tar.gz\n";
  assert.equal(expectedChecksum(text, "trustabl_0.1.15_linux_amd64.tar.gz"), "bbb");
  assert.equal(expectedChecksum(text, "trustabl_0.1.15_darwin_arm64.tar.gz"), null);
});

test("finalizeInstall moves the temp folder into place", () => {
  const root = tmp();
  const tmpDir = path.join(root, ".tmp-x");
  fs.mkdirSync(tmpDir);
  fs.writeFileSync(path.join(tmpDir, "trustabl"), "new");
  const bin = finalizeInstall(tmpDir, path.join(root, "v0.1.15"), "trustabl");
  assert.equal(bin, path.join(root, "v0.1.15", "trustabl"));
  assert.equal(fs.readFileSync(bin, "utf8"), "new");
  assert.equal(fs.existsSync(tmpDir), false);
});

test("finalizeInstall keeps another process's finished install when it lost the race", () => {
  const root = tmp();
  const finalDir = path.join(root, "v0.1.15");
  fs.mkdirSync(finalDir);
  fs.writeFileSync(path.join(finalDir, "trustabl"), "winner");
  fs.writeFileSync(path.join(finalDir, "LICENSE"), "");
  const tmpDir = path.join(root, ".tmp-x");
  fs.mkdirSync(tmpDir);
  fs.writeFileSync(path.join(tmpDir, "trustabl"), "loser");
  const bin = finalizeInstall(tmpDir, finalDir, "trustabl");
  assert.equal(fs.readFileSync(bin, "utf8"), "winner");
  assert.equal(fs.existsSync(tmpDir), false);
});

test("TRUSTABL_BIN that runs `version` is used without any network call", { skip: process.platform === "win32" }, async () => {
  const dir = tmp();
  const bin = path.join(dir, "fake-trustabl");
  fs.writeFileSync(bin, '#!/bin/sh\n[ "$1" = "version" ] && exit 0\nexit 2\n');
  fs.chmodSync(bin, 0o755);
  const fetchImpl = fakeFetch();
  const ensure = createResolver({ env: { TRUSTABL_BIN: bin }, home: tmp(), fetchImpl, log: quiet });
  assert.equal(await ensure(), bin);
  assert.equal(fetchImpl.calls.length, 0);
});

test("TRUSTABL_BIN that does not run is an error, not a silent download", async () => {
  const fetchImpl = fakeFetch();
  const ensure = createResolver({ env: { TRUSTABL_BIN: path.join(tmp(), "missing") }, home: tmp(), fetchImpl, log: quiet });
  await assert.rejects(ensure(), /TRUSTABL_BIN .* does not run/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("an explicit TRUSTABL_VERSION below 0.1.14 fails before any download", async () => {
  const fetchImpl = fakeFetch();
  const ensure = createResolver({ env: { TRUSTABL_VERSION: "v0.1.13" }, home: tmp(), fetchImpl, log: quiet });
  await assert.rejects(ensure(), /needs analyzer 0\.1\.14 or later/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("a cached explicit version is used without any network call, bare tag accepted", async () => {
  const home = tmp();
  const cached = seedCache(home, "v0.1.15");
  const fetchImpl = fakeFetch();
  const ensure = createResolver({ env: { TRUSTABL_VERSION: "0.1.15" }, home, fetchImpl, log: quiet });
  assert.equal(await ensure(), cached);
  assert.equal(fetchImpl.calls.length, 0);
});

test("latest is resolved once per process", async () => {
  const home = tmp();
  const cached = seedCache(home, "v0.1.15");
  const fetchImpl = fakeFetch(latest("v0.1.15"));
  const ensure = createResolver({ env: {}, home, fetchImpl, log: quiet });
  assert.equal(await ensure(), cached);
  assert.equal(await ensure(), cached);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0], /\/repos\/trustabl\/agent-reliability-analyzer\/releases\/latest$/);
});

test("a failed resolution is not memoized, so the next call retries", async () => {
  const home = tmp();
  const fetchImpl = fakeFetch({ ok: false, status: 403 }, latest("v0.1.15"));
  const ensure = createResolver({ env: { TRUSTABL_VERSION: "${TRUSTABL_VERSION}" }, home, fetchImpl, log: quiet });
  // Nothing cached yet, so the failed lookup has no fallback and is an error.
  await assert.rejects(ensure(), /HTTP 403/);
  const cached = seedCache(home, "v0.1.15");
  assert.equal(await ensure(), cached);
  assert.equal(fetchImpl.calls.length, 2);
});

// A fetch that fails the way Node's does with no network.
const offline = () => {
  const fn = async (url) => {
    fn.calls.push(url);
    throw Object.assign(new TypeError("fetch failed"), { cause: new Error("getaddrinfo ENOTFOUND api.github.com") });
  };
  fn.calls = [];
  return fn;
};

test("offline with latest: falls back to the cached version, no download, and says so on stderr", async () => {
  const home = tmp();
  const cached = seedCache(home, "v0.1.15");
  const fetchImpl = offline();
  const logs = [];
  const ensure = createResolver({ env: {}, home, fetchImpl, log: (m) => logs.push(m) });
  assert.equal(await ensure(), cached);
  assert.equal(fetchImpl.calls.length, 1, "only the release lookup was attempted");
  assert.match(fetchImpl.calls[0], /releases\/latest$/);
  assert.ok(
    logs.some((m) => /could not reach GitHub \(fetch failed: getaddrinfo ENOTFOUND api\.github\.com\); using cached trustabl v0\.1\.15/.test(m)),
    logs.join("\n"),
  );
});

test("a non-OK latest lookup falls back to the newest cached version, compared as versions", async () => {
  const home = tmp();
  seedCache(home, "v0.1.9");
  const newest = seedCache(home, "v0.1.15");
  const ensure = createResolver({ env: {}, home, fetchImpl: fakeFetch({ ok: false, status: 403 }), log: quiet });
  assert.equal(await ensure(), newest);
});

test("the fallback ignores a cached version below the floor and a folder without the binary", async () => {
  const home = tmp();
  seedCache(home, "v0.1.13");
  fs.mkdirSync(path.join(home, ".trustabl-forge", "v0.1.20"), { recursive: true });
  fs.mkdirSync(path.join(home, ".trustabl-forge", ".tmp-v0.1.30-1-abcd"), { recursive: true });
  fs.mkdirSync(path.join(home, ".trustabl-forge", "notes"), { recursive: true });
  const usable = seedCache(home, "v0.1.14");
  const ensure = createResolver({ env: {}, home, fetchImpl: offline(), log: quiet });
  assert.equal(await ensure(), usable);
});

test("offline with latest and nothing usable cached: a readable error that names the lookup, the cause and TRUSTABL_VERSION", async () => {
  const home = tmp();
  seedCache(home, "v0.1.13"); // below the floor, so not usable
  const ensure = createResolver({ env: {}, home, fetchImpl: offline(), log: quiet });
  await assert.rejects(ensure(), (err) => {
    assert.match(err.message, /Could not look up the latest trustabl release/);
    assert.match(err.message, /fetch failed: getaddrinfo ENOTFOUND api\.github\.com/);
    assert.match(err.message, /no usable trustabl is cached/);
    assert.match(err.message, /TRUSTABL_VERSION/);
    return true;
  });
});

test("a pinned TRUSTABL_VERSION never consults the release lookup or the fallback", async () => {
  const home = tmp();
  const newer = seedCache(home, "v0.1.20");
  const pinned = seedCache(home, "v0.1.15");
  const fetchImpl = offline();
  const ensure = createResolver({ env: { TRUSTABL_VERSION: "v0.1.15" }, home, fetchImpl, log: quiet });
  assert.equal(await ensure(), pinned);
  assert.notEqual(pinned, newer);
  assert.equal(fetchImpl.calls.length, 0);
});

// ---- install(): the checksum gate. A binary that fails any step must never be
// ---- left in the cache, because the next call would run it unverified.

const download404 = { ok: false, status: 404 };
const bytes = (buf) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
});
const checksumsFile = (text) => ({ ok: true, status: 200, text: async () => text });
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// Everything under the cache root: version folders and .tmp-* leftovers alike.
const cacheEntries = (home) => {
  const root = path.join(home, ".trustabl-forge");
  return fs.existsSync(root) ? fs.readdirSync(root) : [];
};

async function assertRefused(responses, message) {
  const home = tmp();
  const ensure = createResolver({ env: { TRUSTABL_VERSION: "v0.1.15" }, home, fetchImpl: fakeFetch(...responses), log: quiet });
  await assert.rejects(ensure(), message);
  assert.deepEqual(cacheEntries(home), [], "no version folder and no .tmp-* may remain");
}

const asset = assetName("v0.1.15", platformTarget());
const junk = Buffer.from("not really an archive");

test("install: a 404 on the archive fails and leaves nothing in the cache", async () => {
  await assertRefused([download404], /Download failed \(HTTP 404\)/);
});

test("install: a 404 on checksums.txt refuses to run an unverified binary", async () => {
  await assertRefused([bytes(junk), download404], /Could not fetch checksums\.txt \(HTTP 404\); refusing to run an unverified binary/);
});

test("install: an asset missing from checksums.txt is refused", async () => {
  await assertRefused(
    [bytes(junk), checksumsFile(`${sha256(junk)}  some_other_asset.tar.gz\n`)],
    /is not listed in checksums\.txt; refusing to run an unverified binary/,
  );
});

test("install: a checksum mismatch is a hard failure", async () => {
  await assertRefused([bytes(junk), checksumsFile(`${"0".repeat(64)}  ${asset}\n`)], /Checksum mismatch/);
});

test("install: a matching checksum on a corrupt archive still fails to extract and leaves nothing", async () => {
  await assertRefused([bytes(junk), checksumsFile(`${sha256(junk)}  ${asset}\n`)], /Could not extract/);
});

test("install: a verified archive is unpacked into the cache and both steps are logged", { skip: process.platform === "win32" }, async () => {
  const src = tmp();
  fs.writeFileSync(path.join(src, "trustabl"), '#!/bin/sh\nexit 0\n');
  const archive = path.join(tmp(), asset);
  const packed = spawnSync("tar", ["-czf", archive, "-C", src, "trustabl"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const body = fs.readFileSync(archive);

  const home = tmp();
  const logs = [];
  const fetchImpl = fakeFetch(bytes(body), checksumsFile(`${sha256(body)}  ${asset}\n`));
  const ensure = createResolver({ env: { TRUSTABL_VERSION: "v0.1.15" }, home, fetchImpl, log: (m) => logs.push(m) });
  const bin = await ensure();
  assert.equal(bin, path.join(home, ".trustabl-forge", "v0.1.15", "trustabl"));
  assert.ok(fs.existsSync(bin));
  assert.ok(logs.includes(`downloading ${asset} (v0.1.15)...`), logs.join("\n"));
  assert.ok(logs.includes(`checksum verified: ${asset}`), logs.join("\n"));
  assert.deepEqual(cacheEntries(home), ["v0.1.15"]);
  assert.equal(fetchImpl.calls[0], `https://github.com/trustabl/agent-reliability-analyzer/releases/download/v0.1.15/${asset}`);
  assert.equal(fetchImpl.calls[1], "https://github.com/trustabl/agent-reliability-analyzer/releases/download/v0.1.15/checksums.txt");
});
