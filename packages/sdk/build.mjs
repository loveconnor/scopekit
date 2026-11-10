import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT_BYTES = 5 * 1024;
const outfile = new URL("./dist/script.js", import.meta.url).pathname;

await build({
  entryPoints: [new URL("./src/tracker.ts", import.meta.url).pathname],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2019"],
  legalComments: "none",
});

const gzip = gzipSync(readFileSync(outfile)).length;
console.log(`script.js ${gzip} bytes gzip (limit ${LIMIT_BYTES})`);
if (process.argv.includes("--check") && gzip > LIMIT_BYTES) {
  console.error("Tracker script is over its size budget");
  process.exit(1);
}
