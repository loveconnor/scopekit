import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const shared = {
  format: ["esm" as const],
  target: "node22",
  // Workspace packages ship as TypeScript source, so they are bundled into the service.
  noExternal: [/^@scopekit\//],
};

export default defineConfig(() => {
  // `SCOPEKIT_BUILD_TARGET=vercel` builds the app alone, with the tracker inlined, for api/index.js.
  if (process.env.SCOPEKIT_BUILD_TARGET === "vercel") {
    const tracker = readFileSync(createRequire(import.meta.url).resolve("@scopekit/sdk/script"), "utf8");
    return { ...shared, entry: { app: "src/app.ts" }, clean: true, define: { __SCOPEKIT_TRACKER__: JSON.stringify(tracker) } };
  }
  return { ...shared, entry: ["src/index.ts"], clean: true };
});
