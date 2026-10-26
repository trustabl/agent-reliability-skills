// Runs the analyzer's `trustabl forge` and turns a failed run into text for
// the caller. The CLI owns the lists of policy categories and languages and
// its own error messages, so this file passes inputs and errors through
// unchanged rather than validating or rewording them.
import { execFile } from "node:child_process";

export const CLI_TIMEOUT_MS = 120_000;
// A generated SKILL.md is tens of KB; leave plenty of headroom.
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const clean = (values) => (values ?? []).map((v) => v.trim()).filter(Boolean);

export function buildForgeArgs({ target, policy, lang }) {
  const args = ["forge", target];
  const p = clean(policy);
  if (p.length) args.push("--policy", p.join(","));
  const l = clean(lang);
  if (l.length) args.push("--lang", l.join(","));
  return args;
}

/**
 * Runs bin asynchronously, so the server keeps answering pings while Forge
 * works. Never rejects: every outcome is a RunResult.
 */
export function runCli(bin, args, { timeoutMs = CLI_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8", windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr, timedOut: false });
        if (err.killed) return resolve({ code: null, stdout, stderr, timedOut: true });
        if (typeof err.code === "number") return resolve({ code: err.code, stdout, stderr, timedOut: false });
        resolve({ code: null, stdout: stdout ?? "", stderr: stderr ?? "", timedOut: false, spawnError: err.message });
      },
    );
  });
}

/**
 * Text for a run that did not succeed. Exit 1 covers bad input and "no SDK
 * detected"; exit 2 covers any other error (cmd/trustabl/main.go), so the
 * exit code alone says nothing about the cause and none is guessed here.
 */
export function describeFailure({ code, stderr, timedOut, spawnError }, timeoutMs = CLI_TIMEOUT_MS) {
  if (timedOut) {
    return `trustabl forge did not finish within ${timeoutMs / 1000} seconds and was stopped. ` +
      "The first run also clones the rules repository; try again, or check the network.";
  }
  if (spawnError) return `Could not run trustabl: ${spawnError}`;
  return `trustabl forge exited with code ${code}:\n${stderr.trim() || "(no error output)"}`;
}
