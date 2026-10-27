import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { divergence, type DivergenceAnswer, type Probe } from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import { mapWriteIn, mapWriteInUserMessage } from "../src/index";

const probe: Probe = {
  id: "m1:cand:0:probe:0",
  meetingId: "m1",
  kind: "diagnostic",
  candidateId: "m1:cand:0",
  splitId: null,
  tier: "free",
  stem: "Which Friday does Brightwater get the questionnaire?",
  options: [
    { id: "opt-a", text: "Friday the 30th" },
    { id: "opt-b", text: "Friday the 6th" },
  ],
  lint: [],
  promptVersion: "1",
  status: "published",
};
const map = (optionId: string | null) =>
  new ScriptedProvider({ mapWriteIn: [{ optionId, reason: "because" }] });

describe("mapWriteIn", () => {
  it("shows the question, lettered options and the answer", () => {
    expect(mapWriteInUserMessage({ probe, text: "  end of next week " })).toBe(
      [
        "Question: Which Friday does Brightwater get the questionnaire?",
        "A. Friday the 30th",
        "B. Friday the 6th",
        "",
        "Their answer: end of next week",
      ].join("\n"),
    );
  });

  it("maps a write-in to an option ID, marked as the model's", async () => {
    const { output, trace } = await mapWriteIn(
      { probe, text: "the week after this one" },
      map("B"),
    );
    expect(output).toEqual({ mappedOptionId: "opt-b", mappedByModel: true });
    expect(trace.drops).toEqual([]);
  });

  it("leaves a write-in that fits nothing unmapped", async () => {
    const { output } = await mapWriteIn({ probe, text: "whenever legal signs off" }, map(null));
    expect(output).toEqual({ mappedOptionId: null, mappedByModel: true });
  });

  it("treats an unknown letter as unmapped and records the drop", async () => {
    const { output, trace } = await mapWriteIn({ probe, text: "Monday" }, map("D"));
    expect(output.mappedOptionId).toBeNull();
    expect(trace.drops.map((d) => d.reason)).toEqual(["unknown_option"]);
  });

  it("accepts a letter with punctuation", async () => {
    const { output } = await mapWriteIn({ probe, text: "the 30th" }, map(" a) "));
    expect(output.mappedOptionId).toBe("opt-a");
  });

  it("does not call the model for an empty write-in", async () => {
    const model = map("A");
    const { output, trace } = await mapWriteIn({ probe, text: "   " }, model);
    expect(output.mappedOptionId).toBeNull();
    expect(model.requests).toHaveLength(0);
    expect(trace.drops.map((d) => d.reason)).toEqual(["empty_write_in"]);
  });
});

describe("write-ins in divergence", () => {
  const people = ["p1", "p2", "p3"];
  const writeIn = (participantId: string, mappedOptionId: string | null): DivergenceAnswer => ({
    participantId,
    choice: "write_in",
    optionId: null,
    writeInText: "my words",
    mappedOptionId,
  });
  const pick = (participantId: string, optionId: string): DivergenceAnswer => ({
    participantId,
    choice: "option",
    optionId,
    writeInText: null,
    mappedOptionId: null,
  });

  it("a mapped write-in counts as its option", async () => {
    const { output } = await mapWriteIn({ probe, text: "the week after" }, map("B"));
    const result = divergence(probe, people.slice(0, 2), [
      pick("p1", "opt-a"),
      writeIn("p2", output.mappedOptionId),
    ]);
    expect(result.outcome).toBe("split");
  });

  it("an unmapped write-in is listed, not counted, and never makes consistent", async () => {
    const { output } = await mapWriteIn({ probe, text: "whenever legal signs off" }, map(null));
    const result = divergence(probe, people.slice(0, 2), [
      pick("p1", "opt-a"),
      writeIn("p2", output.mappedOptionId),
    ]);
    expect(result.outcome).toBe("insufficient");
    expect(result.unmappedWriteIns).toEqual([{ participantId: "p2", text: "my words" }]);
    expect(result.coverage).toEqual({ answered: 1, of: 2 });
  });

  it("property: an unmapped write-in changes nothing but the unmapped list", () => {
    const choice = fc.constantFrom<"a" | "b" | "unsure" | "none">("a", "b", "unsure", "none");
    fc.assert(
      fc.property(fc.tuple(choice, choice), fc.integer({ min: 0, max: 2 }), (others, at) => {
        const ids = people.filter((_, i) => i !== at);
        const base: DivergenceAnswer[] = others.flatMap((c, i) => {
          const pid = ids[i]!;
          if (c === "none") return [];
          if (c === "unsure")
            return [{ ...pick(pid, "x"), choice: "unsure" as const, optionId: null }];
          return [pick(pid, `opt-${c}`)];
        });
        const without = divergence(probe, people, base);
        const withWriteIn = divergence(probe, people, [...base, writeIn(people[at]!, null)]);
        expect(withWriteIn.outcome).toBe(without.outcome);
        expect(withWriteIn.groups).toEqual(without.groups);
        expect(withWriteIn.coverage).toEqual(without.coverage);
        expect(withWriteIn.unmappedWriteIns).toEqual([
          { participantId: people[at], text: "my words" },
        ]);
      }),
      { numRuns: 200 },
    );
  });
});
