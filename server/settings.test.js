import assert from "node:assert/strict";
import { test } from "node:test";

import { setting } from "./settings.js";

test("setting returns the trimmed value", () => {
  assert.equal(setting("  v0.1.15 "), "v0.1.15");
});

test("setting treats missing, empty and blank values as unset", () => {
  assert.equal(setting(undefined), undefined);
  assert.equal(setting(""), undefined);
  assert.equal(setting("   "), undefined);
});

test("setting treats an unsubstituted ${...} placeholder as unset", () => {
  assert.equal(setting("${TRUSTABL_VERSION}"), undefined);
  assert.equal(setting(" ${GITHUB_TOKEN} "), undefined);
});

test("setting keeps a value that merely contains a placeholder", () => {
  assert.equal(setting("prefix-${X}"), "prefix-${X}");
});
