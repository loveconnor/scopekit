import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Workspace packages ship as TypeScript source, so they are bundled into the service.
  noExternal: [/^@scopekit\//],
});
