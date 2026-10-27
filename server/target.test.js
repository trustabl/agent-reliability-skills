import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { ToolError } from "./errors.js";
import { firstFileRoot, NEED_PATH, resolveTarget } from "./target.js";

const repo = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "forge-target-test-")));
const noRootsCall = async () => {
  throw new Error("getRoots must not be called");
};
const roots = (...uris) => async () => uris;

test("an absolute path is used as is, without asking for roots", async () => {
  const t = repo();
  assert.equal(await resolveTarget(t, noRootsCall), t);
});

test("an absolute path that is missing or a file is refused", async () => {
  const t = repo();
  await assert.rejects(resolveTarget(path.join(t, "nope"), noRootsCall), /Path does not exist/);
  fs.writeFileSync(path.join(t, "f.txt"), "");
  await assert.rejects(resolveTarget(path.join(t, "f.txt"), noRootsCall), /not a directory/);
});

test("no path and no roots capability asks for path", async () => {
  await assert.rejects(resolveTarget(undefined, async () => null), (err) => err instanceof ToolError && err.message === NEED_PATH);
  await assert.rejects(resolveTarget("  ", async () => null), (err) => err.message === NEED_PATH);
});

test("no path uses the first file:// root", async () => {
  const t = repo();
  assert.equal(await resolveTarget(undefined, roots("https://example.com/x", pathToFileURL(t).href)), t);
});

test("no path and only non-file roots asks for path", async () => {
  await assert.rejects(resolveTarget(undefined, roots("https://example.com/x")), (err) => err.message === NEED_PATH);
});

test("a relative path is resolved against the first root", async () => {
  const t = repo();
  fs.mkdirSync(path.join(t, "agent"));
  assert.equal(await resolveTarget("agent", roots(pathToFileURL(t).href)), path.join(t, "agent"));
});

test("a relative path with no roots is refused, never resolved against the working directory", async () => {
  await assert.rejects(resolveTarget("agent", async () => null), /is relative/);
});

test("a URL is refused: Forge takes a local directory", async () => {
  await assert.rejects(resolveTarget("https://github.com/owner/repo", noRootsCall), /local directory, not a URL/);
});

test("firstFileRoot skips malformed URIs", () => {
  const t = repo();
  assert.equal(firstFileRoot(["file://%zz", pathToFileURL(t).href]), t);
  assert.equal(firstFileRoot(null), null);
  assert.equal(firstFileRoot([]), null);
});

test("Windows drive paths are never mistaken for URLs", async () => {
  // On Windows these are absolute; elsewhere they are relative and resolve
  // against the root. Either way the result is "does not exist", not "URL".
  const t = repo();
  for (const p of ["C:/forge-target-test-missing", "C:\\forge-target-test-missing"]) {
    await assert.rejects(resolveTarget(p, roots(pathToFileURL(t).href)), (err) => {
      assert.ok(err instanceof ToolError, p);
      assert.doesNotMatch(err.message, /not a URL/, p);
      assert.match(err.message, /Path does not exist/, p);
      return true;
    });
  }
});

test("a file:///C:/ root becomes a Windows drive path", { skip: process.platform !== "win32" }, () => {
  assert.equal(firstFileRoot(["file:///C:/Users/dev/repo"]), "C:\\Users\\dev\\repo");
});
