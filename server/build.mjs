// Bundles the server into ../dist/index.js (committed; package.json "bin"
// points at it) with the package version built in, so the version the server
// reports always equals package.json and the release tag.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { version } = JSON.parse(readFileSync(here("../package.json"), "utf8"));

await build({
  entryPoints: [here("index.js")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: here("../dist/index.js"),
  define: { __FORGE_VERSION__: JSON.stringify(version) },
  logLevel: "info",
});
