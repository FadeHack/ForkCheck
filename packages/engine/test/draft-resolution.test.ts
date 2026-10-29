import { describe, expect, it } from "vitest";
import type { Answer, Probe } from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import {
  draftResolution,
  draftResolutionUserMessage,
  type DraftResolutionInput,
} from "../src/index";

const probe: Probe = {
  id: "m1:cand:0:probe:0",
  meetingId: "m1",
  kind: "diagnostic",
  candidateId: "m1:cand:0",
  splitId: null,
  tier: "free",
  stem: "Which Friday is SSO ready for the pilot customer?",
  options: [
    { id: "m1:cand:0:probe:0:opt:0", text: "Friday the 30th" },
    { id: "m1:cand:0:probe:0:opt:1", text: "Friday the 6th" },
  ],
  lint: [],
  promptVersion: "1",
  status: "published",
};
const answer = (participantId: string, a: Partial<Answer>): Answer => ({
  id: `a-${participantId}`,
  probeId: probe.id,
  participantId,
  choice: "option",
  optionId: null,
  writeInText: null,
  mappedOptionId: null,
  mappedByModel: false,
  simulated: false,
  ...a,
});
const input: DraftResolutionInput = {
  decision: {
    decision: {
      id: "m1:dec:0",
      meetingId: "m1",
      idx: 0,
      kind: "commitment",
      statement: "Marco has SSO ready by next Friday.",
      ownerText: "Marco",
      deadlineText: "by next Friday",
      ownerInferred: false,
      deadlineInferred: false,
      status: "ambiguous",
    },
    evidence: [],
  },
  probe,
  split: {
    id: `${probe.id}:split`,
    probeId: probe.id,
    outcome: "split",
    validity: [],
    status: "open",
  },
  answers: [
    answer("priya", { optionId: probe.options[0]!.id }),
    answer("marco", { optionId: probe.options[1]!.id }),
    answer("dana", { optionId: probe.options[1]!.id }),
    answer("li", { choice: "write_in", writeInText: " after the security review " }),
  ],
};

describe("draftResolution", () => {
  it("shows the item, question, options and write-ins, without names or counts", () => {
    expect(draftResolutionUserMessage(input)).toBe(
      [
        "Item, as [item ID] (kind, status) statement",
        "[m1:dec:0] (commitment, ambiguous) Marco has SSO ready by next Friday.",
        "  owner: Marco",
        "  deadline: by next Friday",
        "",
        "Question: Which Friday is SSO ready for the pilot customer?",
        "- Friday the 30th",
        "- Friday the 6th",
        "",
        "Answers written in their own words:",
        "- after the security review",
      ].join("\n"),
    );
  });

  it("returns trimmed text marked as drafted by the model", async () => {
    const model = new ScriptedProvider({
      draftResolution: [
        { text: "  SSO is ready for the pilot on [Friday the 30th / Friday the 6th]. " },
      ],
    });
    const { output, trace } = await draftResolution(input, model);
    expect(output).toEqual({
      text: "SSO is ready for the pilot on [Friday the 30th / Friday the 6th].",
      draftedByModel: true,
    });
    expect(trace).toMatchObject({ stage: "draftResolution", promptVersion: "draftResolution.v1" });
    expect(model.requests).toHaveLength(1);
  });
});
