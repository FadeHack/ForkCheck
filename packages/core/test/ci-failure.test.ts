import { expect, it } from "vitest";

it("fails on purpose to check CI goes red", () => {
  expect(1).toBe(2);
});
