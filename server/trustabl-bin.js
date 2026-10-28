// Resolves the analyzer `trustabl` binary that runs `trustabl forge`.
//
// Order: TRUSTABL_BIN override -> the release named by TRUSTABL_VERSION
// (default: latest), downloaded for this OS/arch, sha256-verified against the
// release checksums.txt, and cached under ~/.agent-reliability-skill-generator/<version>/.
//
// Adapted from trustabl-cursor/server/trustabl-bin.js. Unlike it:
//   - a plain `trustabl` on PATH is never used: it may predate forge --lang;
//   - a binary is probed with the `version` subcommand (the analyzer has no
//     --version flag);
//   - the version is resolved once per process, not on every tool call;
//   - an install is unpacked into a temp folder and renamed into place, so two
//     servers cold-starting together never run a half-extracted binary.
//
// NOTE: everything here logs to stderr. stdout is the MCP protocol channel.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { setting } from "./settings.js";
import { MIN_ANALYZER_VERSION, compareTags, meetsMinimum, normalizeTag } from "./version.js";

const REPO = "trustabl/agent-reliability-analyzer";
const defaultLog = (msg) => process.stderr.write(`[agent-reliability-skill-generator] ${msg}\n`);

/** linux/darwin/windows + amd64/arm64, matching the release asset matrix. */
export function platformTarget(platform = process.platform, arch = process.arch) {
  const osName = { linux: "linux", darwin: "darwin", win32: "windows" }[platform];
  if (!osName) throw new Error(`Unsupported OS: ${platform}`);
  const goArch = { x64: "amd64", arm64: "arm64" }[arch];
  if (!goArch) throw new Error(`Unsupported architecture: ${arch}`);
  // Windows releases are amd64-only (arm64 Windows runs the amd64 build via emulation).
  return osName === "windows"
    ? { osName, arch: "amd64", ext: "zip", exe: "trustabl.exe" }
    : { osName, arch: goArch, ext: "tar.gz", exe: "trustabl" };
}

export const assetName = (version, { osName, arch, ext }) =>
  `trustabl_${version.replace(/^v/, "")}_${osName}_${arch}.${ext}`;

/** The sha256 that checksums.txt lists for exactly this asset, or null. */
export function expectedChecksum(checksumsText, asset) {
  for (const line of checksumsText.split("\n")) {
    const [sum, name] = line.trim().split(/\s+/);
    if (name === asset) return sum;
  }
  return null;
}

/**
 * Renames a verified, unpacked tmpDir to finalDir. If another process got
 * there first, its install was verified the same way, so keep it and drop ours.
 */
export function finalizeInstall(tmpDir, finalDir, exe) {
  try {
    fs.renameSync(tmpDir, finalDir);
  } catch (err) {
    if (!fs.existsSync(path.join(finalDir, exe))) throw err;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return path.join(finalDir, exe);
}

/**
 * Windows releases ship a .zip, every other platform a .tar.gz. `tar` is not a
 * safe way to unpack the zip (GNU tar under Git Bash cannot read zip archives);
 * PowerShell's Expand-Archive is always present on Windows 10+.
 */
export function extractCommand(archivePath, destDir, platform = process.platform) {
  // Inside a single-quoted PowerShell string a literal ' is written ''
  // (a profile folder such as C:\Users\O'Brien would end the string early).
  const ps = (p) => p.replaceAll("'", "''");
  return platform === "win32"
    ? ["powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `Expand-Archive -LiteralPath '${ps(archivePath)}' -DestinationPath '${ps(destDir)}' -Force`]]
    : ["tar", ["-xf", archivePath, "-C", destDir]];
}

function extract(archivePath, destDir) {
  const [cmd, args] = extractCommand(archivePath, destDir);
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) throw new Error(`Could not extract ${path.basename(archivePath)}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`Could not extract ${path.basename(archivePath)}: ${r.stderr?.trim() || `exit ${r.status}`}`);
  }
}

/**
 * Returns ensureTrustabl(): resolves to an absolute path of a runnable
 * `trustabl`, downloading and verifying it on first use. The result is
 * memoized for the life of the process; a failure is not, so a later call
 * retries (for example after a network blip or a rate limit).
 */
export function createResolver({ env = process.env, home = os.homedir(), fetchImpl = globalThis.fetch, log = defaultLog } = {}) {
  let pending = null;

  const ghHeaders = () => {
    const h = { "User-Agent": "agent-reliability-skill-generator" };
    const token = setting(env.GITHUB_TOKEN);
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  async function latestTag() {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 403 || res.status === 429 ? ", possibly rate-limited" : ""}`);
    const tag = (await res.json()).tag_name;
    if (!tag) throw new Error("the latest release has no tag_name");
    return tag;
  }

  // The newest cached version that has the binary and meets the floor, or null.
  function newestCached(cacheRoot, exe) {
    let names;
    try {
      names = fs.readdirSync(cacheRoot);
    } catch {
      return null;
    }
    const usable = names
      .filter((name) => meetsMinimum(name) && fs.existsSync(path.join(cacheRoot, name, exe)))
      .sort(compareTags);
    return usable.length ? usable[usable.length - 1] : null;
  }

  async function download(url, dest) {
    const res = await fetchImpl(url, { headers: { ...ghHeaders(), Accept: "application/octet-stream" }, redirect: "follow" });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }

  // A missing checksums.txt, or an asset it does not list, is a hard failure:
  // the server never runs an unverified binary.
  async function verifyChecksum(archivePath, asset, version) {
    const url = `https://github.com/${REPO}/releases/download/${version}/checksums.txt`;
    const res = await fetchImpl(url, { headers: ghHeaders(), redirect: "follow" });
    if (!res.ok) throw new Error(`Could not fetch checksums.txt (HTTP ${res.status}); refusing to run an unverified binary.`);
    const expected = expectedChecksum(await res.text(), asset);
    if (!expected) throw new Error(`${asset} is not listed in checksums.txt; refusing to run an unverified binary.`);
    const actual = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
    if (expected !== actual) throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
    log(`checksum verified: ${asset}`);
  }

  async function install(version, target, finalDir) {
    const asset = assetName(version, target);
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    const tmpDir = path.join(path.dirname(finalDir), `.tmp-${version}-${process.pid}-${randomBytes(4).toString("hex")}`);
    fs.mkdirSync(tmpDir);
    try {
      const archivePath = path.join(tmpDir, asset);
      log(`downloading ${asset} (${version})...`);
      await download(`https://github.com/${REPO}/releases/download/${version}/${asset}`, archivePath);
      await verifyChecksum(archivePath, asset, version);
      extract(archivePath, tmpDir);
      fs.rmSync(archivePath, { force: true });
      const unpacked = path.join(tmpDir, target.exe);
      if (!fs.existsSync(unpacked)) throw new Error(`Extracted ${asset} but ${target.exe} was not in it.`);
      if (target.osName !== "windows") fs.chmodSync(unpacked, 0o755);
      const bin = finalizeInstall(tmpDir, finalDir, target.exe);
      log(`installed trustabl ${version}`);
      return bin;
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }

  async function resolveBinary() {
    const override = setting(env.TRUSTABL_BIN);
    if (override) {
      const r = spawnSync(override, ["version"], { stdio: "ignore", shell: false });
      if (r.error || r.status !== 0) {
        throw new Error(`TRUSTABL_BIN is set to ${override}, but it does not run (\`${override} version\` failed).`);
      }
      log(`using TRUSTABL_BIN (${override})`);
      return override;
    }

    const requested = setting(env.TRUSTABL_VERSION);
    const pinned = requested && requested !== "latest" ? normalizeTag(requested) : undefined;
    if (pinned && !meetsMinimum(pinned)) {
      throw new Error(
        `TRUSTABL_VERSION is ${requested}, but Forge needs analyzer ${MIN_ANALYZER_VERSION} or later ` +
          `(earlier releases lack trustabl forge --lang). Set it to v${MIN_ANALYZER_VERSION} or newer, or to "latest".`,
      );
    }

    const target = platformTarget();
    const cacheRoot = path.join(home, ".agent-reliability-skill-generator");
    let version = pinned;
    if (!version) {
      try {
        version = await latestTag();
      } catch (err) {
        // Offline (or rate-limited) with the default "latest": a verified
        // cached binary beats failing. Only a pinned version skips the lookup.
        const reason = err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message;
        const cached = newestCached(cacheRoot, target.exe);
        if (!cached) {
          throw new Error(
            `Could not look up the latest trustabl release (${reason}), and no usable trustabl is cached in ${cacheRoot}. ` +
              `Check your connection and retry, or set TRUSTABL_VERSION to a tag (e.g. v${MIN_ANALYZER_VERSION}) to pin a version. ` +
              `If you are rate-limited, set GITHUB_TOKEN.`,
          );
        }
        log(`could not reach GitHub (${reason}); using cached trustabl ${cached}`);
        version = cached;
      }
    }
    const finalDir = path.join(cacheRoot, version);
    const bin = path.join(finalDir, target.exe);
    if (fs.existsSync(bin)) return bin;
    return install(version, target, finalDir);
  }

  return function ensureTrustabl() {
    pending ??= resolveBinary().catch((err) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}
