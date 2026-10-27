import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSplit, parseScenario, recheckBriefs, scenarioBriefs } from "../src/index";

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

describe("recheckBriefs", () => {
  it("adds the resolution to the planted reading only", () => {
    const m = s.plantedMismatches[0]!;
    const briefs = recheckBriefs(s, m.id, "Ship on Friday the 30th");
    const before = scenarioBriefs(s);
    briefs.forEach((b, i) => {
      b.readings.forEach((r, j) => {
        const old = before[i]!.readings[j]!;
        if (r.decisionId === m.decision && r.dimension === m.dimension) {
          expect(r.reading).toBe(
            `${old.reading} Everyone then confirmed: "Ship on Friday the 30th". Wherever it is specific, it replaces your understanding above; on any point it leaves open, you keep your understanding.`,
          );
        } else {
          expect(r).toEqual(old);
        }
      });
    });
  });

  it("rejects an unknown mismatch", () => {
    expect(() => recheckBriefs(s, "nope", "x")).toThrow("unknown mismatch nope");
  });
});

describe("isSplit", () => {
  it("needs two different definite options", () => {
    expect(isSplit(["a", "b"])).toBe(true);
    expect(isSplit(["a", "a", null])).toBe(false);
    expect(isSplit([null, "a", null])).toBe(false);
  });
});
