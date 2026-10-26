import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_ANALYZER_VERSION, compareTags, meetsMinimum, normalizeTag } from "./version.js";

test("the floor is 0.1.14, the first analyzer with forge --lang", () => {
  assert.equal(MIN_ANALYZER_VERSION, "0.1.14");
});

test("meetsMinimum accepts the floor and anything newer", () => {
  for (const tag of ["v0.1.14", "0.1.14", "v0.1.15", "v0.2.0", "v1.0.0", "v0.1.15-rc.1"]) {
    assert.equal(meetsMinimum(tag), true, tag);
  }
});

test("meetsMinimum rejects older releases and a pre-release of the floor", () => {
  for (const tag of ["v0.1.13", "v0.0.99", "v0.1.14-rc.1"]) {
    assert.equal(meetsMinimum(tag), false, tag);
  }
});

test("meetsMinimum rejects a tag it cannot parse", () => {
  assert.equal(meetsMinimum("main"), false);
  assert.equal(meetsMinimum("v0.1"), false);
});

test("normalizeTag adds the v that release tags carry", () => {
  assert.equal(normalizeTag("0.1.15"), "v0.1.15");
  assert.equal(normalizeTag("v0.1.15"), "v0.1.15");
});

test("compareTags orders numerically, not as strings, and puts a pre-release before its release", () => {
  const sorted = ["v0.1.15", "v0.1.9", "v0.1.15-rc.1", "v0.2.0", "v0.1.100"].sort(compareTags);
  assert.deepEqual(sorted, ["v0.1.9", "v0.1.15-rc.1", "v0.1.15", "v0.1.100", "v0.2.0"]);
  assert.equal(compareTags("0.1.15", "v0.1.15"), 0);
});
