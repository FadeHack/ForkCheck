import { describe, expect, it } from "vitest";
import { parseTranscript, type Participant, type Probe } from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import {
  generateRecheck,
  generateRecheckUserMessage,
  MAX_GENERATIONS,
  vetRecheck,
  type VetRecheckInput,
} from "../src/index";

const participants: Participant[] = ["Priya", "Marco"].map((name) => ({
  id: name.toLowerCase(),
  meetingId: "m1",
  displayName: name,
  isSimulated: true,
  status: "active",
}));
const { segments } = parseTranscript({
  meetingId: "m1",
  participants,
  text: "[00:00] Marco: Yep, I'll have it ready for the pilot customer by next Friday.",
});
const originalProbe: Probe = {
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
const input: VetRecheckInput = {
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
  originalProbe,
  resolution: {
    id: "res-1",
    splitId: "split-1",
    text: "SSO is live for the pilot on Friday the 30th",
    proposedBy: "priya",
    draftedByModel: false,
    status: "confirmed",
  },
  segments,
};

const novel = {
  consequence: "Whether pilot admins can use SSO on the 2nd.",
  stem: "On Monday the 2nd, how do the pilot customer's admins sign in?",
  options: [{ text: "Through single sign-on" }, { text: "With their old passwords" }],
};
// Same words as the original stem: fails the novelty rule.
const echo = {
  consequence: "The ready date.",
  stem: "Which Friday is SSO ready for the pilot customer?",
  options: [{ text: "Friday the 30th" }, { text: "Friday the 6th" }],
};

describe("generateRecheck", () => {
  it("shows the item, the original question and the resolution", () => {
    const message = generateRecheckUserMessage(input);
    expect(message).toContain("Marco has SSO ready by next Friday.");
    expect(message).toContain(`Question: ${originalProbe.stem}`);
    expect(message).toContain("- Friday the 6th");
    expect(message).toContain("Confirmed resolution: SSO is live for the pilot on Friday the 30th");
    expect(message).not.toContain("rejected");
  });

  it("builds a draft recheck probe tied to the split", async () => {
    const model = new ScriptedProvider({ generateRecheck: [novel] });
    const { output } = await generateRecheck(input, model);
    expect(output.probe).toMatchObject({
      id: "split-1:recheck:res-1",
      meetingId: "m1",
      kind: "recheck",
      candidateId: null,
      splitId: "split-1",
      tier: "free",
      status: "draft",
      stem: novel.stem,
    });
    expect(output.probe.options.map((o) => o.id)).toEqual([
      "split-1:recheck:res-1:opt:0",
      "split-1:recheck:res-1:opt:1",
    ]);
  });

  it("drops a model-written not-sure option and duplicate options", async () => {
    const model = new ScriptedProvider({
      generateRecheck: [
        {
          ...novel,
          options: [...novel.options, { text: "through single sign-on" }, { text: "Not sure" }],
        },
      ],
    });
    const { output, trace } = await generateRecheck(input, model);
    expect(output.probe.options.map((o) => o.text)).toEqual(novel.options.map((o) => o.text));
    expect(trace.drops.map((d) => d.reason)).toEqual(["model_not_sure_option"]);
  });
});

describe("vetRecheck", () => {
  it("keeps a novel recheck without regenerating", async () => {
    const model = new ScriptedProvider({ generateRecheck: [novel] });
    const result = await vetRecheck(input, model);
    expect(result.probe?.stem).toBe(novel.stem);
    expect(result.consequence).toBe(novel.consequence);
    expect(model.requests).toHaveLength(1);
    expect(result.drops).toEqual([]);
  });

  it("a novelty failure triggers exactly one regeneration, with the finding as feedback", async () => {
    const model = new ScriptedProvider({ generateRecheck: [echo, novel] });
    const result = await vetRecheck(input, model);
    expect(result.probe?.stem).toBe(novel.stem);
    expect(model.requests).toHaveLength(2);
    expect(result.drops.map((d) => d.reason)).toEqual(["regenerated_after_lint"]);
    const retry = model.requests[1]!.messages.at(-1)!.content;
    expect(retry).toContain("An earlier recheck question was rejected:");
    expect(retry).toContain("shares 1.00 of its words with the original");
  });

  it("drops the recheck when the rewrite fails too, without a third call", async () => {
    const model = new ScriptedProvider({ generateRecheck: [echo, echo, novel] });
    const result = await vetRecheck(input, model);
    expect(result.probe).toBeNull();
    expect(model.requests).toHaveLength(MAX_GENERATIONS);
    expect(result.drops.map((d) => d.reason)).toEqual([
      "regenerated_after_lint",
      "failed_twice_lint",
    ]);
  });

  it("treats an option equal to the resolution text as a lint failure", async () => {
    const restates = {
      ...novel,
      options: [
        { text: "SSO is live for the pilot on Friday the 30th." },
        { text: "Live a week later, on Friday the 6th" },
      ],
    };
    const model = new ScriptedProvider({ generateRecheck: [restates, novel] });
    const result = await vetRecheck(input, model);
    expect(model.requests).toHaveLength(2);
    expect(result.drops[0]!.item).toMatchObject({
      findings: [expect.objectContaining({ rule: "recheck_restates_resolution" })],
    });
  });

  it("an empty question is rewritten", async () => {
    const model = new ScriptedProvider({ generateRecheck: [{ ...novel, stem: "  " }, novel] });
    const result = await vetRecheck(input, model);
    expect(result.probe?.stem).toBe(novel.stem);
    expect(model.requests[1]!.messages.at(-1)!.content).toContain("- the question is empty");
  });
});
