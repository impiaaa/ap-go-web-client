import * as fs from "node:fs";
import {
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  Variant,
} from "@poupe/material-color-utilities";
import rgba from "color-rgba";

const contrast_levels = [-1.0, 0.0, 1.0];
const is_darks = [false, true];

function argbFromRgba(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): number {
  return (
    ((alpha << 24) |
      ((red & 255) << 16) |
      ((green & 255) << 8) |
      (blue & 255)) >>>
    0
  );
}

const color_rgba = rgba("Lightsteelblue");
if (color_rgba.length === 0) {
  throw "Invalid color";
}

{
  const color_hct = Hct.fromInt(argbFromRgba(...color_rgba));

  const schemes = contrast_levels.map((contrast_level) => {
    return is_darks.map((is_dark) => {
      return new DynamicScheme({
        contrastLevel: contrast_level,
        isDark: is_dark,
        sourceColorHct: color_hct,
        specVersion: "2026",
        variant: Variant.VIBRANT,
      });
    });
  });

  const all_colors = new MaterialDynamicColors().allColors;

  const fd = fs.openSync("src/colors.css", "w");

  contrast_levels.forEach((contrast_level, i) => {
    fs.writeSync(
      fd,
      `@media (prefers-contrast: ${contrast_level > 0.0 ? "more" : contrast_level < 0.0 ? "less" : "no-preference"}) {\n`,
    );

    const fixed_colors = all_colors.filter((dynamic_color) =>
      schemes[i].every(
        (scheme) =>
          scheme.getArgb(dynamic_color) ===
          schemes[i][0].getArgb(dynamic_color),
      ),
    );
    const dynamic_colors = all_colors.filter(
      (dynamic_color) => !fixed_colors.includes(dynamic_color),
    );

    if (fixed_colors.length > 0) {
      fs.writeSync(fd, "  :root {\n");
      for (const dynamic_color of fixed_colors) {
        fs.writeSync(
          fd,
          `    --${dynamic_color.name.replaceAll("_", "-")}: ${hexFromArgb(schemes[0][0].getArgb(dynamic_color))};\n`,
        );
      }
      fs.writeSync(fd, "  }\n");
    }

    is_darks.forEach((is_dark, j) => {
      fs.writeSync(
        fd,
        `  @media (prefers-color-scheme: ${is_dark ? "dark" : "light"}) {\n`,
      );
      const scheme = schemes[i][j];
      fs.writeSync(fd, "    :root {\n");
      for (const dynamic_color of dynamic_colors) {
        fs.writeSync(
          fd,
          `      --${dynamic_color.name.replaceAll("_", "-")}: ${hexFromArgb(scheme.getArgb(dynamic_color))};\n`,
        );
      }
      fs.writeSync(fd, "    }\n");
      fs.writeSync(fd, "  }\n");
    });
    fs.writeSync(fd, "}\n");
  });
  fs.close(fd);
}
