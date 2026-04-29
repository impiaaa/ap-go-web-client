import { defineConfig } from "i18next-cli";
import { extractHtmlPlugin } from "./my-plugins.ts";

export default defineConfig({
  extract: {
    input: ["src/**/*.ts"],
    output: "locales/{{language}}.json",
  },
  locales: ["en"],
  plugins: [extractHtmlPlugin()],
});
