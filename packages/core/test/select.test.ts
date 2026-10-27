import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  dimension,
  impactScore,
  PROBE_BUDGET,
  selectProbes,
  type Dimension,
  type Impact,
  type ProbeTier,
  type SelectableProbe,
} from "../src/index";

const flat: Impact = { reversibility: "low", blastRadius: "low", timeToImpact: "low" };
const item = (
  id: string,
  over: {
    decision?: number;
    dim?: Dimension;
    tier?: ProbeTier;
    impact?: Partial<Impact>;
    lint?: number;
  } = {},
): SelectableProbe => ({
  probe: {
    id,
    tier: over.tier ?? "free",
    lint: Array.from({ length: over.lint ?? 0 }, () => ({ rule: "option_count", detail: "" })),
  },
  candidate: {
    decisionId: `d${over.decision ?? 0}`,
    dimension: over.dim ?? "deadline",
    impact: { ...flat, ...over.impact },
  },
  decisionIdx: over.decision ?? 0,
});
const ids = (xs: SelectableProbe[]) => xs.map((x) => x.probe.id);

describe("selectProbes", () => {
  it("ranks by impact, then decision order, then dimension catalog order", () => {
    const picked = selectProbes([
      item("a", { decision: 2 }),
      item("b", { decision: 1, dim: "scope" }),
      item("c", { decision: 1, dim: "owner" }),
      item("d", { decision: 3, impact: { reversibility: "high" } }),
    ]);
    expect(ids(picked)).toEqual(["d", "c", "b", "a"]);
  });

  it("keeps at most the budget, dropping the lowest impact", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      item(`p${i}`, { decision: i, impact: i === 7 ? { timeToImpact: "high" } : {} }),
    );
    const picked = selectProbes(many);
    expect(picked).toHaveLength(PROBE_BUDGET);
    expect(ids(picked)).toEqual(["p7", "p0", "p1", "p2", "p3"]);
    expect(selectProbes(many, { budget: 2 })).toHaveLength(2);
  });

  it("keeps one probe per decision and dimension, in the best allowed tier", () => {
    const tierPriority = Object.fromEntries(
      dimension.options.map((d) => [d, ["template", "free"]]),
    ) as Record<Dimension, ProbeTier[]>;
    const xs = [item("free", { tier: "free" }), item("tmpl", { tier: "template" })];
    expect(ids(selectProbes(xs))).toEqual(["free"]);
    expect(ids(selectProbes(xs, { tierPriority }))).toEqual(["tmpl"]);
    expect(ids(selectProbes([item("z"), item("y")]))).toEqual(["y"]);
  });

  it("never selects a tier the priority leaves out, or a probe with lint findings", () => {
    const tierPriority = Object.fromEntries(dimension.options.map((d) => [d, ["free"]])) as Record<
      Dimension,
      ProbeTier[]
    >;
    expect(selectProbes([item("t", { tier: "assisted" })], { tierPriority })).toEqual([]);
    expect(selectProbes([item("bad", { lint: 1 }), item("ok", { decision: 1 })])).toHaveLength(1);
  });

  it("scores impact as the sum of the three levels", () => {
    expect(impactScore(flat)).toBe(3);
    expect(impactScore({ reversibility: "high", blastRadius: "medium", timeToImpact: "low" })).toBe(
      6,
    );
  });

  const level = fc.constantFrom("low" as const, "medium" as const, "high" as const);
  const arbItem = fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      decision: fc.nat(6),
      dim: fc.constantFrom(...dimension.options),
      tier: fc.constantFrom("template" as const, "assisted" as const, "free" as const),
      impact: fc.record({ reversibility: level, blastRadius: level, timeToImpact: level }),
      lint: fc.nat(1),
    })
    .map(({ id, ...over }) => item(id, over));
  const arbItems = fc.uniqueArray(arbItem, { selector: (x) => x.probe.id, maxLength: 20 });

  it("property: output is at most the budget and a subset of the input", () => {
    fc.assert(
      fc.property(arbItems, fc.nat(7), (xs, budget) => {
        const picked = selectProbes(xs, { budget });
        expect(picked.length).toBeLessThanOrEqual(budget);
        for (const p of picked) expect(xs).toContain(p);
        expect(selectProbes(xs).length).toBeLessThanOrEqual(PROBE_BUDGET);
      }),
    );
  });

  it("property: permuting the input gives the same output", () => {
    fc.assert(
      fc.property(
        arbItems.chain((xs) =>
          fc.tuple(fc.constant(xs), fc.shuffledSubarray(xs, { minLength: xs.length })),
        ),
        ([xs, shuffled]) => {
          expect(ids(selectProbes(shuffled))).toEqual(ids(selectProbes(xs)));
        },
      ),
    );
  });
});
