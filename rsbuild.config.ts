import { defineConfig } from "@rsbuild/core";
import { pluginTypeCheck } from "@rsbuild/plugin-type-check";
import { pluginWasmPack } from "rsbuild-plugin-wasmpack";

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  html: {
    template: "./src/index.html",
  },
  output: {
    target: "web",
  },
  plugins: [
    pluginTypeCheck(),
    pluginWasmPack({
      autoInstallWasmPack: true,
      crates: [
        {
          path: "gen",
          target: "web",
        },
      ],
    }),
  ],
  source: {
    entry: {
      index: "./src/index.ts",
    },
  },
  tools: {
    rspack(_config) {},
  },
});
