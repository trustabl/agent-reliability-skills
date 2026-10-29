#!/usr/bin/env node
// Every documented install must download the release file, which GitHub
// counts. Installing from the repository (`npx github:...` or a git URL) is a
// clone and is never counted (TR-1309). The release URL is built from
// package.json's version, which the release workflow checks against the tag.
import fs from "node:fs";

const FILES = ["README.md", "mcp.json"];
const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const url = `https://github.com/trustabl/agent-reliability-skills/releases/download/v${version}/agent-reliability-skills-${version}.tgz`;
const fromRepo = /github:trustabl\/agent-reliability-skills|(git\+)?https:\/\/github\.com\/trustabl\/agent-reliability-skills(\.git)?(?=["'\s#]|$)/m;

let failed = false;
for (const file of FILES) {
  const body = fs.readFileSync(file, "utf8");
  if (fromRepo.test(body)) {
    console.error(`${file}: installs from the repository; point it at ${url}`);
    failed = true;
  }
  if (!body.includes(url)) {
    console.error(`${file}: does not reference ${url}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`install paths point at ${url}`);
