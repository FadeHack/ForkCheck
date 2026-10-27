import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@forkcheck/engine", () => {
  it("resolves through the workspace", () => {
    expect(packageName).toBe("@forkcheck/engine");
  });
});
