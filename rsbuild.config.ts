import { defineConfig } from "@rsbuild/core";
import { pluginTypeCheck } from "@rsbuild/plugin-type-check";

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  html: {
    template: "./src/index.html",
  },
  output: {
    target: "web",
  },
  plugins: [pluginTypeCheck()],
  source: {
    entry: {
      index: "./src/index.ts",
    },
  },
  tools: {
    rspack(_config) {},
  },
});
