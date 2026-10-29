import { describe, expect, it } from "vitest";
import { revealOrder, validityTally, type RevealItem } from "../../src/ui/reveal";
import { participants, split } from "./fixtures";

const item = (id: string, outcome: "split" | "consistent" | "insufficient"): RevealItem => ({
  split: { ...split(id, `q-${id}`), outcome },
  probe: { id: `q-${id}`, stem: id, options: [] },
  answers: [],
});

describe("revealOrder", () => {
  it("puts differences first and keeps rank order within each group", () => {
    const order = revealOrder([
      item("a", "consistent"),
      item("b", "split"),
      item("c", "insufficient"),
      item("d", "split"),
    ]);
    expect(order.map((i) => i.split.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("validityTally", () => {
  it("groups names by label in the order the labels are offered", () => {
    const s = {
      ...split("s1", "q1"),
      validity: [
        { participantId: "p2", label: "doesnt_matter" as const },
        { participantId: "p0", label: "valid" as const },
        { participantId: "p1", label: "valid" as const },
      ],
    };
    expect(validityTally(s, participants)).toEqual([
      "Real difference: Priya and Marco",
      "Different, but it doesn't matter: Dana",
    ]);
  });
});
