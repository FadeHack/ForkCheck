import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { optionOrder, seededShuffle } from "../src/index";

const probe = {
  id: "m1:cand:0:probe:0",
  options: ["a", "b", "c", "d"].map((t) => ({ id: `o-${t}`, text: t })),
};

describe("seededShuffle", () => {
  it("property: is a permutation and the same seed gives the same order", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 10 }), fc.string(), (xs, seed) => {
        const once = seededShuffle(xs, seed);
        expect(seededShuffle(xs, seed)).toEqual(once);
        expect([...once].sort()).toEqual([...xs].sort());
      }),
    );
  });

  it("does not modify its input", () => {
    const xs = [1, 2, 3];
    seededShuffle(xs, "s");
    expect(xs).toEqual([1, 2, 3]);
  });
});

describe("optionOrder", () => {
  it("is reproducible per participant and probe", () => {
    expect(optionOrder(probe, "rosa")).toEqual(optionOrder(probe, "rosa"));
    expect(optionOrder(probe, "rosa").options).toHaveLength(4);
  });

  it("varies across participants and across probes", () => {
    const orders = (f: (i: number) => [typeof probe, string]) =>
      new Set(
        Array.from({ length: 20 }, (_, i) =>
          optionOrder(...f(i))
            .options.map((o) => o.text)
            .join(""),
        ),
      );
    expect(orders((i) => [probe, `p${i}`]).size).toBeGreaterThan(5);
    expect(orders((i) => [{ ...probe, id: `probe-${i}` }, "rosa"]).size).toBeGreaterThan(5);
  });
});
