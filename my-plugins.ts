import { readFile } from "node:fs/promises";
import { glob } from "glob";
import type { TOptionsBase } from "i18next";
import type { ExtractedKey, ExtractedKeysMap } from "i18next-cli";
import { JSDOM } from "jsdom";

interface PartialOptions {
  optionsAttr?: string;
  parseDefaultValueFromContent?: boolean;
  selectorAttr?: string;
  targetAttr?: string;
  useOptionsAttr?: boolean;
}

interface Options {
  optionsAttr: string;
  parseDefaultValueFromContent: boolean;
  selectorAttr: string;
  targetAttr: string;
  useOptionsAttr: boolean;
}

const defaults: Options = {
  optionsAttr: "i18n-options",
  parseDefaultValueFromContent: true,
  selectorAttr: "data-i18n",
  targetAttr: "i18n-target",
  useOptionsAttr: false,
};

function extendDefault(
  o: TOptionsBase,
  key: string,
  val: string,
  options: Options,
): ExtractedKey {
  return {
    ...o,
    ...{
      defaultValue: options.parseDefaultValueFromContent
        ? val
        : o.defaultValue
          ? `${o.defaultValue}`
          : undefined,
      key: key,
      ns: Array.isArray(o.ns) ? o.ns[0] : o.ns,
    },
  };
}

function parse(
  elem: Element,
  key: string,
  opts: TOptionsBase,
  options: Options,
  keys: ExtractedKeysMap,
) {
  var attr = "text";

  if (key.indexOf("[") === 0) {
    const parts = key.split("]");
    key = parts[1];
    attr = parts[0].substring(1, parts[0].length - 1);
  }

  key =
    key.indexOf(";") === key.length - 1
      ? key.substring(0, key.length - 2)
      : key;

  const ns = Array.isArray(opts.ns) ? opts.ns[0] : opts.ns;
  const nskey = ns ? `${ns}:${key}` : key;

  if (attr === "html") {
    keys.set(nskey, extendDefault(opts, key, elem.innerHTML, options));
  } else if (attr === "text") {
    keys.set(nskey, extendDefault(opts, key, elem.textContent, options));
  } else if (attr === "prepend") {
    keys.set(nskey, extendDefault(opts, key, elem.innerHTML, options));
  } else if (attr === "append") {
    keys.set(nskey, extendDefault(opts, key, elem.innerHTML, options));
  } else if (attr.indexOf("data-") === 0) {
    const dataAttr = attr.substring("data-".length);
    keys.set(
      nskey,
      extendDefault(opts, key, elem.getAttribute(dataAttr) || "", options),
    );
  } else {
    keys.set(
      nskey,
      extendDefault(opts, key, elem.getAttribute(attr) || "", options),
    );
  }
}

function relaxedJsonParse(badJSON: string) {
  return JSON.parse(
    badJSON
      .replace(
        /:\s*"([^"]*)"/g,
        (_match, p1) => `: "${p1.replace(/:/g, "@colon@")}"`,
      )
      .replace(
        /:\s*'([^']*)'/g,
        (_match, p1) => `: "${p1.replace(/:/g, "@colon@")}"`,
      )
      .replace(/(['"])?([a-z0-9A-Z_]+)(['"])?\s*:/g, '"$2": ')
      .replace(/@colon@/g, ":"),
  );
}

function _loc(
  elem: Element,
  options: Options,
  extracted_keys: ExtractedKeysMap,
  opts?: TOptionsBase,
) {
  var key = elem.getAttribute(options.selectorAttr);
  if (!key) return;

  var target = elem,
    targetSelector = elem.getAttribute(options.targetAttr);

  if (targetSelector != null)
    target = elem.querySelector(targetSelector) || elem;

  if (!opts && options.useOptionsAttr === true)
    opts = relaxedJsonParse(elem.getAttribute(options.optionsAttr) || "{}");

  opts = opts || { ns: "translation" };

  if (key.indexOf(";") >= 0) {
    const keys = key.split(";");
    for (let ix = 0, l_ix = keys.length; ix < l_ix; ix++) {
      if (keys[ix] !== "")
        parse(target, keys[ix], opts, options, extracted_keys);
    }
  } else {
    parse(target, key, opts, options, extracted_keys);
  }
}

export const extractHtmlPlugin = (partial_options: PartialOptions = {}) => ({
  name: "extract-html-plugin",
  async onEnd(keys: ExtractedKeysMap) {
    const options: Options = { ...defaults, ...partial_options };
    const htmlFiles = await glob("src/**/*.html");
    for (const file of htmlFiles) {
      const content = await readFile(file, "utf-8");
      const doc = new JSDOM(content).window.document;
      const childs = doc.querySelectorAll(`[${options.selectorAttr}]`);
      for (let j = childs.length - 1; j > -1; j--) {
        _loc(childs[j], options, keys);
      }
    }
  },
});
