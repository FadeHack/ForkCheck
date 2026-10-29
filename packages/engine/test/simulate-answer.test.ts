import { describe, expect, it } from "vitest";
import { optionOrder, type Probe } from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import { simulateAnswer, simulateAnswerUserMessage, type ParticipantBrief } from "../src/index";

const probe: Probe = {
  id: "m1:cand:0:probe:0",
  meetingId: "m1",
  kind: "diagnostic",
  candidateId: "m1:cand:0",
  splitId: null,
  tier: "free",
  stem: "When should Brightwater have the completed questionnaire?",
  options: [
    { id: "o0", text: "By Friday the 30th" },
    { id: "o1", text: "By Friday the 6th" },
    { id: "o2", text: "By Monday the 9th" },
  ],
  lint: [],
  promptVersion: "generateProbes.v1",
  status: "draft",
};
const rosa: ParticipantBrief = {
  participantId: "Rosa",
  readings: [
    { decisionId: "questionnaire-return", dimension: "deadline", reading: "Friday 30 October." },
  ],
};
const kwame: ParticipantBrief = {
  participantId: "Kwame",
  readings: [
    { decisionId: "questionnaire-return", dimension: "deadline", reading: "Friday 6 November." },
  ],
};

async function run(reply: unknown, brief = rosa, p = probe) {
  const model = new ScriptedProvider({ simulateAnswer: [reply] });
  const result = await simulateAnswer({ brief, probe: p }, model);
  return { ...result, model };
}

describe("simulateAnswer", () => {
  it("builds the prompt from the participant's own brief only", async () => {
    const { model } = await run({ optionId: null, reason: "" });
    const [req] = model.requests;
    expect(req).toMatchObject({ stage: "simulateAnswer", promptVersion: "simulateAnswer.v1" });
    expect(req!.messages).toHaveLength(2);
    expect(req!.messages[1]!.content).toBe(
      [
        "Your private notes on what the meeting agreed, as (item, dimension) note:",
        "- (questionnaire-return, deadline) Friday 30 October.",
        "",
        "Question: When should Brightwater have the completed questionnaire?",
        "A. By Friday the 30th",
        "B. By Friday the 6th",
        "C. By Monday the 9th",
      ].join("\n"),
    );
    const all = req!.messages.map((m) => m.content).join("\n");
    expect(all).not.toContain("6 November");
    expect(all).not.toContain("Kwame");
  });

  it("uses an organizer's free-text notes in place of keyed readings", () => {
    const brief = { participantId: "Rosa", readings: [], notes: "Questionnaire back by the 30th." };
    expect(simulateAnswerUserMessage({ brief, probe }).split("\n").slice(0, 3)).toEqual([
      "Your private notes on what the meeting agreed:",
      "Questionnaire back by the 30th.",
      "",
    ]);
  });

  it("shows options in the participant's shuffled order and maps the letter back", async () => {
    const shuffled = optionOrder(probe, kwame.participantId);
    const msg = simulateAnswerUserMessage({ brief: kwame, probe: shuffled });
    shuffled.options.forEach((o, i) =>
      expect(msg).toContain(`${String.fromCharCode(65 + i)}. ${o.text}`),
    );
    const { output } = await run({ optionId: "b", reason: "" }, kwame, shuffled);
    expect(output.answer).toEqual({ choice: "option", optionId: shuffled.options[1]!.id });
  });

  it("treats null as not sure", async () => {
    const { output } = await run({ optionId: null, reason: "Notes don't say." });
    expect(output.answer).toEqual({ choice: "unsure", optionId: null });
  });

  it("treats an unknown letter as not sure and logs it", async () => {
    const { output, trace } = await run({ optionId: "F", reason: "" });
    expect(output.answer).toEqual({ choice: "unsure", optionId: null });
    expect(trace.drops.map((d) => d.reason)).toEqual(["unknown_option"]);
  });
});
