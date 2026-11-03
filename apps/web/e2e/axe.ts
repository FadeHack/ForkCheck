import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function noAxeViolations(page: Page) {
  // The reveal and the record fade their marks in; axe must read the settled colors.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}
