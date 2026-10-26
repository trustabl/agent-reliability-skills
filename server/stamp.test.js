import assert from "node:assert/strict";
import { test } from "node:test";

import { parseStamp } from "./stamp.js";

const STAMP = "<!-- generated: 2026-10-26 | rules: e07feb0 | schema: 29 | sdks: claude_sdk, mcp | template: 3 -->";

test("parses a five-field stamp anywhere in the file", () => {
  assert.deepEqual(parseStamp(`# Title\n\n${STAMP}\n\n## Body\n`), {
    date: "2026-10-26",
    rules: "e07feb0",
    schema: 29,
    sdks: ["claude_sdk", "mcp"],
    template: 3,
  });
});

test("a stamp in the middle of lots of content still parses", () => {
  const s = parseStamp(`lots of content before\n\n${STAMP}\n\nlots of content after`);
  assert.equal(s.rules, "e07feb0");
});

test("a four-field stamp predates the template field and is template 1", () => {
  const s = parseStamp("<!-- generated: 2026-08-11 | rules: abc123 | schema: 13 | sdks: claude_sdk -->");
  assert.equal(s.template, 1);
  assert.deepEqual(s.sdks, ["claude_sdk"]);
});

test("a legacy four-field stamp with two SDKs keeps both SDKs intact", () => {
  const s = parseStamp("# Header\n\n<!-- generated: 2026-08-11 | rules: abc1234 | schema: 13 | sdks: claude_sdk, mcp -->\n\nbody");
  assert.equal(s.template, 1);
  assert.deepEqual(s.sdks, ["claude_sdk", "mcp"]);
});

test("a five-field stamp does not absorb the template field into sdks", () => {
  const s = parseStamp("<!-- generated: 2026-08-11 | rules: abc1234 | schema: 13 | sdks: claude_sdk, mcp | template: 7 -->");
  assert.equal(s.template, 7);
  assert.deepEqual(s.sdks, ["claude_sdk", "mcp"]);
});

test("an empty sdks field parses to no SDKs", () => {
  // The first " -->" starts at the second space, so the field is "sdks: " and
  // its value is empty, exactly as Go's TrimPrefix + Split yields.
  assert.deepEqual(parseStamp("<!-- generated: d | rules: r | schema: 1 | sdks:  -->").sdks, []);
});

test("sdks are split on comma-space, as Go's strings.Split(s, \", \") does", () => {
  assert.deepEqual(parseStamp("<!-- generated: d | rules: r | schema: 1 | sdks: a,b -->").sdks, ["a,b"]);
});

test("no stamp: empty input, plain markdown, an unrelated comment, a bad format", () => {
  for (const text of ["", "no stamp here", "# Just a regular markdown file\n\nNo stamp here.", "<!-- some other comment -->", "<!-- generated: bad | format -->"]) {
    assert.equal(parseStamp(text), null, text);
  }
});

test("rejects malformed stamps", () => {
  const bad = [
    "no stamp here",
    "<!-- generated: 2026-10-26 | rules: e07feb0 | schema: 29 | sdks: claude_sdk",          // no closing -->
    "<!-- generated: 2026-10-26 | e07feb0 | schema: 29 | sdks: claude_sdk -->",             // rules: missing
    "<!-- generated: 2026-10-26 | rules: e07feb0 | schema: x | sdks: claude_sdk -->",       // schema not a number
    "<!-- generated: 2026-10-26 | rules: e07feb0 | schema: 29 -->",                         // three fields
    "<!-- generated: 2026-10-26 | rules: e07feb0 | schema: 29 | sdks: a | template: 0 -->", // template < 1
    "<!-- generated: 2026-10-26 | rules: e07feb0 | schema: 29 | sdks: a | template: 3 | x -->", // extra field
    "<!-- generated: 2026-08-11 | rules: abc1234 | schema: 13 | sdks: mcp | template: x -->",
    "<!-- generated: 2026-08-11 | rules: abc1234 | schema: 13 | sdks: mcp | tmpl: 2 -->",
    "<!-- generated: 2026-08-11 | rules: abc1234 | schema: 13 | sdks: mcp | template: -3 -->",
    "<!-- generated: 2026-08-11 | rules: abc123 | schema: 13 | claude_sdk, mcp -->", // sdks: prefix missing
  ];
  for (const text of bad) assert.equal(parseStamp(text), null, text);
});
