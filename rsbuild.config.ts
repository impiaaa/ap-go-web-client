import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "@rsbuild/core";
import { pluginTypeCheck } from "@rsbuild/plugin-type-check";
import { pluginHtmlMinifierTerser } from "rsbuild-plugin-html-minifier-terser";
import { pluginI18nextExtractor } from "rsbuild-plugin-i18next-extractor";
import { pluginWasmPack } from "rsbuild-plugin-wasmpack";
import i18nextToolkitConfig from "./i18next.config.ts";

function genSoftwareLicenses() {
  let s = "";
  const packages = JSON.parse(
    readFileSync("package-lock.json", "utf-8"),
  ).packages;
  for (const package_name in packages) {
    if (!package_name) continue;
    const pkg = packages[package_name];
    if (
      pkg.dev ||
      pkg.devOptional ||
      !pkg.license ||
      !package_name.startsWith("node_modules/")
    )
      continue;
    const short_name = package_name.substring("node_modules/".length);
    s += `<li>${short_name} ${pkg.version} is licensed under ${pkg.license}.</li>`;
  }
  return s;
}

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  html: {
    template: "./src/index.html",
    templateParameters: {
      gitVersion: execFileSync("git", [
        "describe",
        "--always",
        "--dirty=*",
        "--tags",
      ]),
      softwareLicenses: genSoftwareLicenses(),
    },
  },
  output: {
    assetPrefix: process.env.ASSET_PREFIX,
    target: "web",
  },
  plugins: [
    pluginHtmlMinifierTerser({
      collapseBooleanAttributes: true,
      collapseInlineTagWhitespace: false,
      collapseWhitespace: true,
      decodeEntities: true,
      minifyCSS: true,
      minifyURLs: true,
      removeAttributeQuotes: true,
      removeComments: true,
      removeEmptyAttributes: true,
      removeOptionalTags: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      sortAttributes: true,
      sortClassName: true,
      useShortDoctype: true,
    }),
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
