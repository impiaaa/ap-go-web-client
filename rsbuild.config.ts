import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "@rsbuild/core";
import { pluginTypeCheck } from "@rsbuild/plugin-type-check";
import { pluginHtmlMinifierTerser } from "rsbuild-plugin-html-minifier-terser";
import { pluginI18nextExtractor } from "rsbuild-plugin-i18next-extractor";
import { pluginWasmPack } from "rsbuild-plugin-wasmpack";
import { parse as parseToml } from "smol-toml";
import i18nextToolkitConfig from "./i18next.config.ts";

function genSoftwareLicenses() {
  let s = "";
  const packages = JSON.parse(
    readFileSync("package-lock.json", "utf-8"),
  ).packages;
  const direct_dependencies: Record<string, string> = packages[""].dependencies;
  const licenses = new Set(
    Object.entries(packages)
      .filter(
        ([package_name, _]) =>
          !!direct_dependencies[
            package_name.startsWith("node_modules/")
              ? package_name.substring("node_modules/".length)
              : package_name
          ],
      )
      .map(([_, pkg]: [string, any]) => pkg.license),
  );
  licenses.forEach((license) => {
    if (!license) return;
    s += "<li>";
    let count = 0;
    for (const package_name in packages) {
      if (!package_name) continue;
      const short_name = package_name.startsWith("node_modules/")
        ? package_name.substring("node_modules/".length)
        : package_name;
      if (!direct_dependencies[short_name]) continue;
      const pkg = packages[package_name];
      if (pkg.dev || pkg.devOptional || pkg.license !== license) continue;
      if (count > 0) s += ", ";
      s += `<a href="https://www.npmjs.com/package/${short_name}/v/${pkg.version}" target="_blank">${short_name} ${pkg.version}</a>`;
      count += 1;
    }
    s += ` ${count === 1 ? "is" : "are"} licensed under ${license}</li>`;
  });

  s += "<li>";
  // const rust_packages = parseToml(readFileSync("gen/Cargo.lock", "utf-8")).package;
  // (rust_packages.valueOf() as any[]).forEach((pkg, i) => {
  //   if (i > 0) s += ", ";
  //   s += `<a href="https://crates.io/crates/${pkg.name}/${pkg.version}" target="_blank">${pkg.name} ${pkg.version}</a>`;
  // });
  const rust_packages = parseToml(
    readFileSync("gen/Cargo.toml", "utf-8"),
  ).dependencies;
  Object.entries(rust_packages.valueOf() as object).forEach(
    ([package_name, pkg], i) => {
      if (i > 0) s += ", ";
      s += `<a href="https://crates.io/crates/${package_name}/${pkg.version}" target="_blank">${package_name} ${pkg.version}</a>`;
    },
  );
  s += "</li>";

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
