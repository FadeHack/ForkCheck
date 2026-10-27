import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSplit, parseScenario, scenarioBriefs } from "../src/index";

const s = parseScenario(
  readFileSync(
    new URL("../../../scenarios/dev/deadline-next-friday.json", import.meta.url),
    "utf8",
  ),
);

describe("scenarioBriefs", () => {
  it("gives each participant only their own readings", () => {
    const briefs = scenarioBriefs(s);
    expect(briefs.map((b) => b.participantId)).toEqual(s.participants);
    for (const b of briefs) {
      const own = s.briefs.find((x) => x.participant === b.participantId)!.readings;
      expect(b.readings.map((r) => r.reading)).toEqual(own.map((r) => r.reading));
    }
  });
});

describe("isSplit", () => {
  it("needs two different definite options", () => {
    expect(isSplit(["a", "b"])).toBe(true);
    expect(isSplit(["a", "a", null])).toBe(false);
    expect(isSplit([null, "a", null])).toBe(false);
  });
});
