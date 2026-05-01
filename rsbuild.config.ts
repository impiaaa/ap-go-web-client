import { execFileSync } from "node:child_process";
import { defineConfig } from "@rsbuild/core";
import { pluginTypeCheck } from "@rsbuild/plugin-type-check";
import { pluginI18nextExtractor } from "rsbuild-plugin-i18next-extractor";
import { pluginWasmPack } from "rsbuild-plugin-wasmpack";
import i18nextToolkitConfig from "./i18next.config.ts";

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  html: {
    template: "./src/index.html",
    templateParameters: {
      gitVersion: execFileSync("git", [
        "describe",
        "--always",
        "--dirty=*",
        "--match= ",
      ]),
    },
  },
  output: {
    target: "web",
  },
  plugins: [
    pluginI18nextExtractor({
      i18nextToolkitConfig: i18nextToolkitConfig,
      localesDir: "./locales",
    }),
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
