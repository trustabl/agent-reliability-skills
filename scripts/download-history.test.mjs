// Runs the Python embedded in .github/workflows/download-history.yml, taken
// from the workflow itself so the test exercises what CI runs. A harness swaps
// urllib's urlopen for canned GitHub API pages and pins today's date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(ROOT, ".github/workflows/download-history.yml");

// The heredoc between `python3 - <<'PY'` and `PY`, with the YAML indent removed.
function embeddedPython() {
  const lines = fs.readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.findIndex((l) => l.trim() === "python3 - <<'PY'");
  const end = lines.findIndex((l, i) => i > start && l.trim() === "PY");
  assert.ok(start >= 0 && end > start, "download-history.yml has no python3 heredoc");
  const body = lines.slice(start + 1, end);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return body.map((l) => l.slice(indent)).join("\n");
}

const HARNESS = `
import datetime, io, json, os, sys, urllib.request

pages = json.load(open(os.environ["FAKE_PAGES"]))
seen = []

class FakeDate(datetime.date):
    @classmethod
    def today(cls):
        return datetime.date.fromisoformat(os.environ["FAKE_TODAY"])

datetime.date = FakeDate

def fake_urlopen(req, timeout=None):
    url = req.full_url
    seen.append({"url": url, "auth": req.get_header("Authorization")})
    page = int(url.rsplit("page=", 1)[1])
    body = json.dumps(pages[page - 1] if page <= len(pages) else [])
    return io.BytesIO(body.encode())

urllib.request.urlopen = fake_urlopen
try:
    exec(compile(open(os.environ["SCRIPT"]).read(), "download-history", "exec"), {"__name__": "__main__"})
finally:
    json.dump(seen, open(os.environ["SEEN"], "w"))
`;

const python = ["python3", "python"].find((cmd) => spawnSync(cmd, ["--version"]).status === 0);

function asset(name, download_count) {
  return { name, download_count };
}
function release(tag_name, assets, extra = {}) {
  return { tag_name, assets, ...extra };
}

// Runs the snapshot once in dir; returns the history file and the requests made.
function snapshot(dir, { pages, today, token = "" }) {
  const file = (name) => path.join(dir, name);
  fs.writeFileSync(file("script.py"), embeddedPython());
  fs.writeFileSync(file("harness.py"), HARNESS);
  fs.writeFileSync(file("pages.json"), JSON.stringify(pages));
  const run = spawnSync(python, [file("harness.py")], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      SCRIPT: file("script.py"),
      FAKE_PAGES: file("pages.json"),
      FAKE_TODAY: today,
      SEEN: file("seen.json"),
      TARGET_REPO: "trustabl/trustabl-forge",
      HISTORY_FILE: "out/history.json",
      PACKAGE_PREFIX: "trustabl-forge-",
      GITHUB_TOKEN: token,
    },
  });
  assert.equal(run.status, 0, run.stderr);
  return {
    history: JSON.parse(fs.readFileSync(path.join(dir, "out/history.json"), "utf8")),
    seen: JSON.parse(fs.readFileSync(file("seen.json"), "utf8")),
    stdout: run.stdout,
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "download-history-"));

const PAGE = [
  release("v0.1.1", [asset("trustabl-forge-0.1.1.tgz", 7), asset("checksums.txt", 50)]),
  release("v0.1.0", [asset("trustabl-forge-0.1.0.tgz", 30), asset("checksums.txt", 90), asset("trustabl-forge-0.1.0.zip", 4)]),
  release("v0.2.0", [asset("trustabl-forge-0.2.0.tgz", 999)], { draft: true }),
  release("v0.0.9", [asset("other-0.0.9.tgz", 12)]),
];

test("counts only the package file, skips drafts, and labels the unit", { skip: !python }, () => {
  const { history, stdout } = snapshot(tmp(), { pages: [PAGE], today: "2026-10-26" });
  assert.equal(history.repo, "trustabl/trustabl-forge");
  assert.equal(history.unit, "cumulative_release_downloads");
  assert.match(history.note, /not users/);
  assert.deepEqual(history.history, [
    { date: "2026-10-26", total: 37, releases: { "v0.0.9": 0, "v0.1.0": 30, "v0.1.1": 7 } },
  ]);
  assert.match(stdout, /= 37 cumulative package downloads across 3 releases/);
});

test("releases are listed in sorted tag order", { skip: !python }, () => {
  const { history } = snapshot(tmp(), { pages: [PAGE], today: "2026-10-26" });
  assert.deepEqual(Object.keys(history.history[0].releases), ["v0.0.9", "v0.1.0", "v0.1.1"]);
});

test("a same-day rerun replaces that day's entry", { skip: !python }, () => {
  const dir = tmp();
  snapshot(dir, { pages: [PAGE], today: "2026-10-26" });
  const later = [release("v0.1.0", [asset("trustabl-forge-0.1.0.tgz", 41)])];
  const { history } = snapshot(dir, { pages: [later], today: "2026-10-26" });
  assert.deepEqual(history.history, [{ date: "2026-10-26", total: 41, releases: { "v0.1.0": 41 } }]);
});

test("earlier entries are kept unchanged and stay in date order", { skip: !python }, () => {
  const dir = tmp();
  snapshot(dir, { pages: [PAGE], today: "2026-10-26" });
  const week2 = [release("v0.1.0", [asset("trustabl-forge-0.1.0.tgz", 55)])];
  const { history } = snapshot(dir, { pages: [week2], today: "2026-11-02" });
  assert.deepEqual(
    history.history.map((e) => [e.date, e.total]),
    [["2026-10-26", 37], ["2026-11-02", 55]],
  );
  assert.deepEqual(history.history[0].releases, { "v0.0.9": 0, "v0.1.0": 30, "v0.1.1": 7 });
});

test("reads every page of releases", { skip: !python }, () => {
  const full = Array.from({ length: 100 }, (_, i) => release(`v1.0.${i}`, [asset(`trustabl-forge-1.0.${i}.tgz`, 1)]));
  const { history, seen } = snapshot(tmp(), { pages: [full, [release("v0.9.0", [asset("trustabl-forge-0.9.0.tgz", 5)])]], today: "2026-10-26" });
  assert.equal(seen.length, 2);
  assert.match(seen[1].url, /\/repos\/trustabl\/trustabl-forge\/releases\?per_page=100&page=2$/);
  assert.equal(Object.keys(history.history[0].releases).length, 101);
  assert.equal(history.history[0].total, 105);
});

test("sends the token only when one is set", { skip: !python }, () => {
  assert.equal(snapshot(tmp(), { pages: [PAGE], today: "2026-10-26", token: "fake-token-for-test" }).seen[0].auth, "Bearer fake-token-for-test");
  assert.equal(snapshot(tmp(), { pages: [PAGE], today: "2026-10-26" }).seen[0].auth, null);
});
