import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}
