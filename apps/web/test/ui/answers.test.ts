import { describe, expect, it } from "vitest";
import type { ParticipantProbe } from "../../src/contracts/api";
import { answerRequests, answerText, initialDrafts } from "../../src/ui/participant/answers";
import { answer } from "./fixtures";

const q = (id: string): ParticipantProbe => ({
  id,
  kind: "diagnostic",
  stem: `Question ${id}`,
  options: [
    { id: `${id}-a`, text: "Staging" },
    { id: `${id}-b`, text: "Production" },
  ],
});

describe("initialDrafts", () => {
  it("starts from the saved answer and leaves the rest empty", () => {
    const writeIn = {
      ...answer("p0", "q2", null),
      choice: "write_in" as const,
      writeInText: "Both",
    };
    const drafts = initialDrafts(
      [q("q1"), q("q2"), q("q3")],
      [answer("p0", "q1", "q1-b"), writeIn],
    );
    expect(drafts).toEqual({
      q1: { choice: "option", optionId: "q1-b", writeIn: "" },
      q2: { choice: "write_in", optionId: null, writeIn: "Both" },
      q3: { choice: null, optionId: null, writeIn: "" },
    });
  });
});

describe("answerRequests", () => {
  it("builds one request per question in order", () => {
    const result = answerRequests([q("q1"), q("q2"), q("q3")], {
      q1: { choice: "option", optionId: "q1-a", writeIn: "" },
      q2: { choice: "unsure", optionId: null, writeIn: "" },
      q3: { choice: "write_in", optionId: null, writeIn: "  Neither yet  " },
    });
    expect(result).toEqual({
      ok: true,
      bodies: [
        { probeId: "q1", choice: "option", optionId: "q1-a" },
        { probeId: "q2", choice: "unsure" },
        { probeId: "q3", choice: "write_in", writeIn: "Neither yet" },
      ],
    });
  });

  it("names what each unanswered question still needs", () => {
    const result = answerRequests([q("q1"), q("q2")], {
      q2: { choice: "write_in", optionId: null, writeIn: " " },
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        q1: "Choose an answer. If you don't know, choose Not sure.",
        q2: "Write your answer, or choose one of the options.",
      },
    });
  });
});

describe("answerText", () => {
  it("reads an answer back in the participant's terms", () => {
    expect(answerText(q("q1"), answer("p0", "q1", "q1-b"))).toBe("Production");
    expect(answerText(q("q1"), answer("p0", "q1", null))).toBe("Not sure");
    expect(
      answerText(q("q1"), { ...answer("p0", "q1", null), choice: "write_in", writeInText: "Both" }),
    ).toBe('In your own words: "Both"');
  });
});
