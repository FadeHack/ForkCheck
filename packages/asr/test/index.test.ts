import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@forkcheck/asr", () => {
  it("resolves through the workspace", () => {
    expect(packageName).toBe("@forkcheck/asr");
  });
});
