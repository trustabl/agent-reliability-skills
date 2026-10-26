import assert from "node:assert/strict";
import { test } from "node:test";

import { buildForgeArgs, describeFailure, runCli } from "./forge.js";

const node = process.execPath;

test("buildForgeArgs maps inputs onto the CLI flags", () => {
  assert.deepEqual(buildForgeArgs({ target: "/repo" }), ["forge", "/repo"]);
  assert.deepEqual(
    buildForgeArgs({ target: "/repo", policy: ["openai_sdk", " mcp ", ""], lang: ["go"] }),
    ["forge", "/repo", "--policy", "openai_sdk,mcp", "--lang", "go"],
  );
  assert.deepEqual(buildForgeArgs({ target: "/repo", policy: [], lang: ["  "] }), ["forge", "/repo"]);
});

test("runCli captures stdout and stderr of a successful run", async () => {
  const r = await runCli(node, ["-e", "process.stdout.write('skill'); process.stderr.write('note')"]);
  assert.deepEqual(r, { code: 0, stdout: "skill", stderr: "note", timedOut: false });
});

test("runCli reports the exit code and stderr of a failed run", async () => {
  // exitCode, not process.exit(): pipe writes are async on macOS and exit() can drop them.
  const r = await runCli(node, ["-e", "process.stderr.write('Error: unknown flag: --lang'); process.exitCode = 2"]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, "Error: unknown flag: --lang");
  assert.equal(r.timedOut, false);
});

test("runCli stops a run that exceeds the timeout", async () => {
  const r = await runCli(node, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.equal(r.code, null);
});

test("runCli reports a binary that cannot start", async () => {
  const r = await runCli("/definitely/not/trustabl", ["forge"]);
  assert.equal(r.code, null);
  assert.match(r.spawnError, /ENOENT/);
});

test("describeFailure passes stderr through with the exit code and guesses nothing", () => {
  const text = describeFailure({ code: 2, stdout: "", stderr: "Error: unknown flag: --lang\n", timedOut: false });
  assert.equal(text, "trustabl forge exited with code 2:\nError: unknown flag: --lang");
  assert.doesNotMatch(text, /network/i);
});

test("describeFailure explains a timeout and a start failure", () => {
  assert.match(describeFailure({ code: null, stdout: "", stderr: "", timedOut: true }, 120000), /within 120 seconds/);
  assert.match(describeFailure({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: "spawn x ENOENT" }), /Could not run trustabl: spawn x ENOENT/);
  assert.equal(describeFailure({ code: 1, stdout: "", stderr: "  ", timedOut: false }), "trustabl forge exited with code 1:\n(no error output)");
});
