import { describe, expect, it } from "vitest";
import {
  candidate as candidateSchema,
  parseTranscript,
  type Decision,
  type Participant,
} from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import {
  findCandidates,
  findCandidatesUserMessage,
  type DecisionWithEvidence,
  type FindCandidatesInput,
} from "../src/index";

const meeting = {
  id: "m1",
  title: "SSO check-in",
  heldAt: "2026-10-26T15:00:00-04:00",
  timezone: "America/New_York",
};
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
  text: [
    "[00:00] Priya: So SSO is ready by next Friday?",
    "[00:05] Marco: Yep, I'll have it ready by next Friday.",
    "[00:09] Priya: And the pricing page, we'll revisit.",
  ].join("\n"),
});

const item = (idx: number, over: Partial<Decision> = {}): DecisionWithEvidence => {
  const id = `m1:dec:${idx}`;
  return {
    decision: {
      id,
      meetingId: "m1",
      idx,
      kind: "commitment",
      statement: "Marco has SSO ready by next Friday.",
      ownerText: "Marco",
      deadlineText: "by next Friday",
      ownerInferred: false,
      deadlineInferred: false,
      status: "ambiguous",
      ...over,
    },
    evidence: [
      {
        id: `${id}:ev:0`,
        decisionId: id,
        resolutionId: null,
        segmentId: segments[1]!.id,
        quote: "I'll have it ready by next Friday.",
      },
    ],
  };
};
const input: FindCandidatesInput = {
  meeting,
  participants,
  segments,
  decisions: [
    item(0),
    item(1, { kind: "open_item", statement: "Pricing page.", status: "debated" }),
  ],
};

const impact = { reversibility: "medium", blastRadius: "high", timeToImpact: "high" };
const draft = (over: Record<string, unknown> = {}) => ({
  decisionId: "m1:dec:0",
  dimension: "deadline",
  readings: [{ text: "Friday the 30th" }, { text: "Friday the 6th" }],
  impact,
  ...over,
});

async function run(candidates: unknown[]) {
  const model = new ScriptedProvider({ findCandidates: [{ candidates }] });
  const result = await findCandidates(input, model);
  return { ...result, model };
}

describe("findCandidates", () => {
  it("sends the versioned prompt with item IDs, quotes and a named transcript", async () => {
    const { model, trace } = await run([]);
    const [req] = model.requests;
    expect(req).toMatchObject({ stage: "findCandidates", promptVersion: "findCandidates.v2" });
    const user = req!.messages[1]!.content;
    expect(user).toBe(findCandidatesUserMessage(input));
    expect(user).toContain(
      "[m1:dec:0] (commitment, ambiguous) Marco has SSO ready by next Friday.",
    );
    expect(user).toContain('  quote: "I\'ll have it ready by next Friday."');
    expect(user).toContain(`[${segments[1]!.id}] Marco: Yep, I'll have it ready by next Friday.`);
    expect(trace.drops).toEqual([]);
  });

  it("builds valid candidates with exactly one dimension and IDs for every reading", async () => {
    const { output } = await run([draft(), draft({ dimension: "scope" })]);
    expect(output.candidates).toHaveLength(2);
    for (const c of output.candidates) expect(candidateSchema.parse(c)).toEqual(c);
    expect(output.candidates[0]).toEqual({
      id: "m1:cand:0",
      decisionId: "m1:dec:0",
      dimension: "deadline",
      readings: [
        { id: "m1:cand:0:r:0", text: "Friday the 30th" },
        { id: "m1:cand:0:r:1", text: "Friday the 6th" },
      ],
      impact,
    });
  });

  it("rejects a dimension outside the catalog at the schema", async () => {
    await expect(run([draft({ dimension: "budget" })])).rejects.toThrow();
  });

  it("drops unknown, debated, duplicate and single-reading candidates with reasons", async () => {
    const { output, trace } = await run([
      draft({ decisionId: "m1:dec:9" }),
      draft({ decisionId: "m1:dec:1" }),
      draft(),
      draft({ readings: [{ text: "Friday the 6th" }] }),
      draft({ dimension: "owner", readings: [{ text: "Marco" }, { text: " marco " }] }),
    ]);
    expect(output.candidates.map((c) => c.dimension)).toEqual(["deadline"]);
    expect(trace.drops.map((d) => d.reason)).toEqual([
      "unknown_decision",
      "debated_decision",
      "duplicate_dimension",
      "fewer_than_two_readings",
    ]);
  });

  it("keeps only the dimensions PROBE_DIMENSIONS allows", async () => {
    const model = new ScriptedProvider({
      findCandidates: [
        {
          candidates: [
            draft(),
            draft({
              dimension: "criteria",
              readings: [{ text: "unit tests" }, { text: "QA pass" }],
            }),
            draft({ dimension: "owner", readings: [{ text: "Marco" }, { text: "Priya" }] }),
          ],
        },
      ],
    });
    const { output, trace } = await findCandidates(
      { ...input, dimensions: ["owner", "deadline", "scope"] },
      model,
    );
    expect(output.candidates.map((c) => c.dimension)).toEqual(["deadline", "owner"]);
    expect(trace.drops.map((d) => d.reason)).toEqual(["dimension_not_checked"]);
  });
});
