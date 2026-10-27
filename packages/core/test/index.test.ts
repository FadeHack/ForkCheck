import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@forkcheck/core", () => {
  it("resolves through the workspace", () => {
    expect(packageName).toBe("@forkcheck/core");
  });
});
