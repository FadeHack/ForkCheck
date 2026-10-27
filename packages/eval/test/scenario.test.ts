import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScenario, scenario, serializeScenario } from "../src/index";

const sampleText = readFileSync(new URL("../../../scenarios/sample.json", import.meta.url), "utf8");

describe("scenario format v1", () => {
  it("validates the hand-written sample", () => {
    expect(scenario.safeParse(JSON.parse(sampleText)).error).toBeUndefined();
  });

  it("round-trips through parse and serialize", () => {
    const parsed = parseScenario(sampleText);
    const text = serializeScenario(parsed);
    expect(parseScenario(text)).toEqual(parsed);
    expect(serializeScenario(parseScenario(text))).toBe(text);
  });

  it("rejects a quote that is not in the transcript", () => {
    const s = JSON.parse(sampleText);
    s.expectedDecisions[0].quotes.push("ready by Thursday");
    expect(scenario.safeParse(s).success).toBe(false);
  });

  it("rejects a planted mismatch the briefs do not support", () => {
    const s = JSON.parse(sampleText);
    for (const b of s.briefs) b.readings[0].reading = "Production by Friday";
    const issues = scenario.safeParse(s).error?.issues.map((i) => i.message);
    expect(issues).toContain("briefs do not disagree on this decision and dimension");
  });

  it("rejects a mismatch without scripted resolutions", () => {
    const s = JSON.parse(sampleText);
    s.scriptedResolutions = [];
    expect(scenario.safeParse(s).success).toBe(false);
  });
});
