import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintScenario, parseScenario, type Scenario } from "../src/index";

const load = (set: string): Scenario[] => {
  const dir = new URL(`../../../scenarios/${set}/`, import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => parseScenario(readFileSync(new URL(f, dir), "utf8")));
};
const heldout = load("heldout");
const cases = heldout.map((s) => [s.id, s] as const);

/** Categories the loop must leave alone: nothing planted, nothing to probe. */
const controls = new Set(["same_reading", "aligned", "debated", "insufficient"]);

describe("held-out scenario set", () => {
  it("has 18 scenarios that bring the full set to the R§7.1 composition", () => {
    expect(heldout).toHaveLength(18);
    expect(heldout.every((s) => s.set === "heldout" && s.id.startsWith("heldout-"))).toBe(true);
    const counts: Record<string, number> = {};
    for (const s of [...heldout, ...load("dev")]) {
      counts[s.category] = (counts[s.category] ?? 0) + 1;
    }
    expect(counts).toEqual({
      deadline: 4,
      ownership: 3,
      scope: 3,
      criteria: 3,
      dependency_outcome: 2,
      same_reading: 3,
      partial_agreement: 2,
      debated: 2,
      aligned: 2,
      insufficient: 1,
      sarcasm: 1,
    });
  });

  it.each(cases)("%s passes the lint", (_id, s) => {
    expect(lintScenario(s)).toEqual([]);
  });

  it.each(cases)("%s: briefs disagree only where a mismatch is planted", (_id, s) => {
    const planted = new Set(s.plantedMismatches.map((m) => `${m.decision}/${m.dimension}`));
    const readings = new Map<string, Set<string>>();
    for (const b of s.briefs) {
      for (const r of b.readings) {
        const key = `${r.decision}/${r.dimension}`;
        readings.set(key, (readings.get(key) ?? new Set()).add(r.reading));
      }
    }
    const disagreeing = [...readings].filter(([, set]) => set.size > 1).map(([key]) => key);
    expect(new Set(disagreeing)).toEqual(planted);
  });

  it.each(cases)("%s: controls plant nothing; the rest plant one gap with both fixes", (_id, s) => {
    expect(s.plantedMismatches).toHaveLength(controls.has(s.category) ? 0 : 1);
    for (const r of s.scriptedResolutions) {
      expect(r.precise.expectedRecheck).toBe("consistent");
      expect(r.vague.expectedRecheck).toBe("split");
    }
  });

  it.each(cases)("%s: every participant has a brief", (_id, s) => {
    expect(s.briefs.map((b) => b.participant).sort()).toEqual([...s.participants].sort());
  });

  it("debated scenarios list the open question as unresolved and plant nothing", () => {
    const debated = heldout.filter((s) => s.category === "debated");
    expect(debated).toHaveLength(2);
    for (const s of debated) {
      expect(s.expectedRecord.unresolved, s.id).toHaveLength(1);
      expect(
        s.expectedDecisions.some((d) => d.kind === "open_item"),
        s.id,
      ).toBe(true);
    }
  });
});
