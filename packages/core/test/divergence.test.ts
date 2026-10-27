import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { divergence, DivergenceError, type DivergenceAnswer } from "../src/index";

const probe = { options: ["A", "B", "C"].map((id) => ({ id, text: `option ${id}` })) };
const people = ["p1", "p2", "p3", "p4"];

// Compact answers: "A" option, "wA" write-in mapped to A, "w" unmapped write-in, "?" unsure,
// "-" no answer.
type Code = "A" | "B" | "C" | "wA" | "wB" | "w" | "?" | "-";
function answers(codes: readonly Code[]): DivergenceAnswer[] {
  return codes.flatMap((code, i): DivergenceAnswer[] => {
    const participantId = people[i]!;
    const base = { participantId, optionId: null, writeInText: null, mappedOptionId: null };
    if (code === "-") return [];
    if (code === "?") return [{ ...base, choice: "unsure" }];
    if (code === "w") return [{ ...base, choice: "write_in", writeInText: "my own words" }];
    if (code.startsWith("w")) {
      return [{ ...base, choice: "write_in", writeInText: "mapped", mappedOptionId: code[1]! }];
    }
    return [{ ...base, choice: "option", optionId: code }];
  });
}
const outcomeOf = (codes: readonly Code[]) =>
  divergence(probe, people.slice(0, codes.length), answers(codes)).outcome;

describe("divergence truth table", () => {
  it.each([
    // split: two distinct options among definite answers
    [["A", "B"], "split"],
    [["A", "B", "?"], "split"],
    [["A", "B", "-", "w"], "split"],
    [["A", "wB"], "split"],
    [["wA", "wB", "?", "?"], "split"],
    [["A", "B", "C", "A"], "split"],
    // consistent: at least two definite, all the same, no "not sure"
    [["A", "A"], "consistent"],
    [["A", "A", "-"], "consistent"],
    [["A", "wA", "w"], "consistent"],
    [["B", "B", "B", "B"], "consistent"],
    // insufficient: fewer than two definite, or agreement with a "not sure"
    [["A", "A", "?"], "insufficient"],
    [["A", "-", "-"], "insufficient"],
    [["A", "?"], "insufficient"],
    [["A", "w"], "insufficient"],
    [["w", "w", "w"], "insufficient"],
    [["?", "?", "?"], "insufficient"],
    [["-", "-", "-"], "insufficient"],
    [[], "insufficient"],
  ] as [Code[], string][])("%j → %s", (codes, expected) => {
    expect(outcomeOf(codes)).toBe(expected);
  });

  it("matches the rule for every combination of three participants", () => {
    const codes: Code[] = ["A", "B", "wA", "wB", "w", "?", "-"];
    for (const x of codes)
      for (const y of codes)
        for (const z of codes) {
          const row: Code[] = [x, y, z];
          const definite = row.filter((c) => c !== "w" && c !== "?" && c !== "-");
          const distinct = new Set(definite.map((c) => c.replace("w", ""))).size;
          const expected =
            distinct >= 2
              ? "split"
              : definite.length >= 2 && !row.includes("?")
                ? "consistent"
                : "insufficient";
          expect(outcomeOf(row), row.join(",")).toBe(expected);
        }
  });
});

describe("divergence details", () => {
  it("groups definite answers in option order and lists everything else", () => {
    const d = divergence(probe, people, answers(["B", "?", "wA", "w"]));
    expect(d).toEqual({
      outcome: "split",
      groups: [
        { optionId: "A", participantIds: ["p3"] },
        { optionId: "B", participantIds: ["p1"] },
      ],
      unsure: ["p2"],
      unmappedWriteIns: [{ participantId: "p4", text: "my own words" }],
      nonResponders: [],
      coverage: { answered: 2, of: 4 },
    });
  });

  it("reports coverage and non-responders with a consistent outcome", () => {
    const d = divergence(probe, people, answers(["A", "A", "A"]));
    expect(d).toMatchObject({ outcome: "consistent", nonResponders: ["p4"] });
    expect(d.coverage).toEqual({ answered: 3, of: 4 });
  });

  it("ignores answers from people who are not active participants", () => {
    expect(divergence(probe, ["p1", "p2"], answers(["A", "A", "B"])).outcome).toBe("consistent");
  });

  it("rejects two answers from one participant and unknown options", () => {
    const [a] = answers(["A"]);
    expect(() => divergence(probe, people, [a!, a!])).toThrow(DivergenceError);
    expect(() => divergence(probe, people, [{ ...a!, optionId: "Z" }])).toThrow(DivergenceError);
  });

  it("treats a write-in mapped to an unknown option as unmapped", () => {
    const [w] = answers(["wA"]);
    const d = divergence(probe, people, [{ ...w!, mappedOptionId: "Z" }]);
    expect(d.unmappedWriteIns).toEqual([{ participantId: "p1", text: "mapped" }]);
  });
});

describe("divergence properties", () => {
  const code = fc.constantFrom<Code>("A", "B", "C", "wA", "wB", "w", "?", "-");
  const row = fc.array(code, { minLength: 0, maxLength: 4 });

  it("adding a not-sure answer never turns a split into anything else", () => {
    fc.assert(
      fc.property(row, (codes) => {
        fc.pre(codes.length < 4 && outcomeOf(codes) === "split");
        expect(outcomeOf([...codes, "?"])).toBe("split");
      }),
    );
  });

  it("removing a non-responder never changes the outcome", () => {
    fc.assert(
      fc.property(row, fc.nat(3), (codes, i) => {
        fc.pre(i < codes.length && codes[i] === "-");
        const ids = people.slice(0, codes.length);
        const all = answers(codes);
        const before = divergence(probe, ids, all).outcome;
        const after = divergence(
          probe,
          ids.filter((_, k) => k !== i),
          all,
        ).outcome;
        expect(after).toBe(before);
      }),
    );
  });

  it("the outcome and lists do not depend on answer order", () => {
    fc.assert(
      fc.property(
        row.chain((codes) =>
          fc.tuple(
            fc.constant(codes),
            fc.shuffledSubarray(answers(codes), { minLength: answers(codes).length }),
          ),
        ),
        ([codes, shuffled]) => {
          const ids = people.slice(0, codes.length);
          expect(divergence(probe, ids, shuffled)).toEqual(divergence(probe, ids, answers(codes)));
        },
      ),
    );
  });
});
