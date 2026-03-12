import { defineConfig } from "@rsbuild/core";
import { pluginTypeCheck } from "@rsbuild/plugin-type-check";

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  source: {
    entry: {
      index: "./src/index.ts",
    },
  },
  html: {
    template: "./src/index.html",
  },
  output: {
    target: "web",
  },
  plugins: [pluginTypeCheck()],
  tools: {
    rspack(_config) {},
  },
});
