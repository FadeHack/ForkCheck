import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIO_SET, parseScenario } from "../src/index";

const root = new URL("../../../scenarios/", import.meta.url);
const ids = new Set(
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json") && f !== "sample.json")
    .map((f) => parseScenario(readFileSync(new URL(f, root), "utf8")).id),
);

describe("audio set", () => {
  it("has 6 synthetic and 4 human recordings of distinct scenarios", () => {
    expect(AUDIO_SET.filter((e) => e.source === "synthetic")).toHaveLength(6);
    expect(AUDIO_SET.filter((e) => e.source === "human")).toHaveLength(4);
    expect(new Set(AUDIO_SET.map((e) => e.scenarioId)).size).toBe(10);
  });

  it("covers dev and held-out scenarios with synthetic voices", () => {
    const synthetic = AUDIO_SET.filter((e) => e.source === "synthetic").map((e) => e.scenarioId);
    expect(synthetic.some((id) => id.startsWith("dev-"))).toBe(true);
    expect(synthetic.some((id) => id.startsWith("heldout-"))).toBe(true);
  });

  it.each(AUDIO_SET.map((e) => [e.file, e] as const))("%s names a known scenario", (_f, e) => {
    expect(ids.has(e.scenarioId)).toBe(true);
    expect(e.file.startsWith(e.scenarioId)).toBe(true);
  });
});
