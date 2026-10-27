import { describe, expect, it } from "vitest";
import { packageName as core } from "@forkcheck/core";
import { packageName as engine } from "@forkcheck/engine";

describe("@forkcheck/web", () => {
  it("resolves workspace packages", () => {
    expect([core, engine]).toEqual(["@forkcheck/core", "@forkcheck/engine"]);
  });
});
