import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/stdio.ts", "src/http.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
