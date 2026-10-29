import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

/** The `--name: #hex` declarations of the first rule whose selector matches exactly. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const backgrounds = ["paper", "surface"];
/** Every token used as text, on every background it can sit on. */
const text = ["ink", "ink-muted", "action", "confirmed", "unresolved", "split"].flatMap((fg) =>
  backgrounds.map((bg) => [fg, bg] as const),
);
/** Pairs that must hold 3:1: control borders, the focus ring, fork lines and glyphs. */
const boundaries = ["line", "action", "split", "ink-muted"].flatMap((fg) =>
  backgrounds.map((bg) => [fg, bg] as const),
);

const themes = {
  light: tokens(":root"),
  dark: tokens(':root[data-theme="dark"]'),
};

describe("color tokens", () => {
  it("declares the same dark values for the system setting and the explicit choice", () => {
    expect(tokens(':root:not([data-theme="light"])')).toEqual(themes.dark);
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it("computes ratios like the WCAG formula", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  for (const [theme, t] of Object.entries(themes)) {
    describe(theme, () => {
      it.each(text)("%s text on %s is at least 4.5:1", (fg, bg) => {
        expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
      });

      it("text on the primary button is at least 4.5:1", () => {
        expect(contrast(t["on-action"]!, t.action!)).toBeGreaterThanOrEqual(4.5);
      });

      it("the toast's paper-on-ink text is at least 4.5:1", () => {
        expect(contrast(t.paper!, t.ink!)).toBeGreaterThanOrEqual(4.5);
      });

      it.each(boundaries)("%s against %s is at least 3:1", (fg, bg) => {
        expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
