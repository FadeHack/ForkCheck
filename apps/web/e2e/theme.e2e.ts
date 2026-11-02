import { expect, test, type Page } from "@playwright/test";

const PAPER = { light: "rgb(251, 248, 243)", dark: "rgb(22, 19, 16)" };

let consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector("main")!).backgroundColor);

function luminance(rgb: string): number {
  const [r, g, b] = rgb
    .match(/\d+(\.\d+)?/g)!
    .slice(0, 3)
    .map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Tabs through the page and records each focused control's ring. */
async function focusRings(page: Page) {
  const rings: { name: string; style: string; width: number; color: string }[] = [];
  await page.locator("body").focus();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      // The dev server's tools overlay sits after the page in tab order; it isn't ours.
      if (!el || el === document.body || el.tagName === "NEXTJS-PORTAL") return null;
      const s = getComputedStyle(el);
      const name =
        el.getAttribute("aria-label") || el.id || el.textContent?.trim().slice(0, 30) || "";
      return {
        name: `${el.tagName.toLowerCase()} ${name}`,
        style: s.outlineStyle,
        width: parseFloat(s.outlineWidth),
        color: s.outlineColor,
      };
    });
    if (ring === null || ring.name === rings[0]?.name) break;
    // Tab steps through a date input's month, day and year without leaving the element.
    if (ring.name !== rings.at(-1)?.name) rings.push(ring);
  }
  return rings;
}

test("the theme follows the system until a choice is made, and the choice persists", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  expect(await background(page)).toBe(PAPER.dark);

  await page.getByLabel("Theme").selectOption("light");
  expect(await background(page)).toBe(PAPER.light);
  await page.reload();
  expect(await background(page)).toBe(PAPER.light);
  await expect(page.getByLabel("Theme")).toHaveValue("light");

  await page.getByLabel("Theme").selectOption("system");
  expect(await background(page)).toBe(PAPER.dark);
  await page.reload();
  expect(await background(page)).toBe(PAPER.dark);
  await expect(page.getByLabel("Theme")).toHaveValue("system");
});

for (const theme of ["light", "dark"] as const) {
  test(`every control on the start page shows a visible focus ring (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    const rings = await focusRings(page);
    const paper = await background(page);
    expect(rings.length).toBeGreaterThanOrEqual(8);
    for (const ring of rings) {
      expect(ring.style, ring.name).toBe("solid");
      expect(ring.width, ring.name).toBeGreaterThanOrEqual(2);
      expect(contrast(ring.color, paper), ring.name).toBeGreaterThanOrEqual(3);
    }
  });
}
