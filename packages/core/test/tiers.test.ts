import { describe, expect, it } from "vitest";
import { dimension, parseTierConfig, TIER_RUNS, TIERS, tierFor } from "../src/index";

const all = Object.fromEntries(dimension.options.map((d) => [d, "free"]));

describe("tier config", () => {
  it("covers every dimension", () => {
    expect(Object.keys(TIERS).sort()).toEqual([...dimension.options].sort());
  });

  it("rejects an unknown dimension", () => {
    expect(() => parseTierConfig({ ...all, tone: "free" })).toThrow();
  });

  it("rejects an unknown tier", () => {
    expect(() => parseTierConfig({ ...all, owner: "magic" })).toThrow();
  });

  it("rejects a missing dimension", () => {
    const { scope: _, ...rest } = all;
    expect(() => parseTierConfig(rest)).toThrow();
  });

  it("looks up a dimension's tier", () => {
    expect(tierFor("owner", parseTierConfig({ ...all, owner: "template" }))).toBe("template");
  });
});

describe("chosen tiers", () => {
  it("records the gate runs they came from", () => {
    expect(TIER_RUNS).toEqual([
      "g1-free-20261028",
      "g1-assisted-20261028",
      "g1-template-20261028",
      "g1-config-form-20261028",
    ]);
    expect(TIERS).toMatchObject({
      owner: "template",
      deadline: "assisted",
      scope: "template",
      criteria: "assisted",
    });
  });
});
