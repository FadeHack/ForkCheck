import { describe, expect, it } from "vitest";
import {
  assistedStem,
  probe as probeSchema,
  type Candidate,
  type Participant,
} from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import {
  assistedOptionsUserMessage,
  generateProbes,
  generateProbesUserMessage,
  isNotSureOption,
  type GenerateProbesInput,
} from "../src/index";

const participants: Participant[] = ["Priya", "Marco"].map((name) => ({
  id: name.toLowerCase(),
  meetingId: "m1",
  displayName: name,
  isSimulated: true,
  status: "active",
}));
const candidate: Candidate = {
  id: "m1:cand:0",
  decisionId: "m1:dec:0",
  dimension: "deadline",
  readings: [
    { id: "m1:cand:0:r:0", text: "Friday the 30th" },
    { id: "m1:cand:0:r:1", text: "Friday the 6th" },
  ],
  impact: { reversibility: "medium", blastRadius: "high", timeToImpact: "high" },
};
const input: GenerateProbesInput = {
  meeting: {
    id: "m1",
    title: "SSO check-in",
    heldAt: "2026-10-26T15:00:00-04:00",
    timezone: "America/New_York",
  },
  participants,
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
    evidence: [
      {
        id: "m1:dec:0:ev:0",
        decisionId: "m1:dec:0",
        resolutionId: null,
        segmentId: "s1",
        quote: "I'll have it ready by next Friday.",
      },
    ],
  },
  candidate,
  tier: "free",
};

const stem = "On which day does the pilot customer first log in with SSO?";
const opts = (...texts: string[]) => texts.map((text) => ({ text }));

async function run(probes: unknown[], over: Partial<GenerateProbesInput> = {}) {
  const model = new ScriptedProvider({ generateProbes: [{ probes }] });
  const result = await generateProbes({ ...input, ...over }, model);
  return { ...result, model };
}

describe("generateProbes", () => {
  it("sends the versioned prompt without the license header, and the candidate's readings", async () => {
    const { model } = await run([]);
    const [req] = model.requests;
    expect(req).toMatchObject({ stage: "generateProbes", promptVersion: "generateProbes.v1" });
    expect(req!.messages[0]!.content).toMatch(/^You detect hidden misalignment/);
    expect(req!.messages[0]!.content).not.toContain("Apache");
    const user = req!.messages[1]!.content;
    expect(user).toBe(generateProbesUserMessage(input));
    expect(user).toContain("Dimension: deadline");
    expect(user).toContain("- Friday the 6th");
  });

  it("builds draft T2 probes that reference their candidate", async () => {
    const { output, trace } = await run([
      { stem, options: opts("Friday the 30th", "Friday the 6th") },
    ]);
    expect(trace.drops).toEqual([]);
    expect(output.probes).toHaveLength(1);
    const [p] = output.probes;
    expect(probeSchema.parse(p)).toEqual(p);
    expect(p).toMatchObject({
      id: "m1:cand:0:probe:0",
      meetingId: "m1",
      kind: "diagnostic",
      candidateId: candidate.id,
      splitId: null,
      tier: "free",
      stem,
      promptVersion: "generateProbes.v1",
      status: "draft",
      lint: [],
    });
    expect(p!.options).toEqual([
      { id: "m1:cand:0:probe:0:opt:0", text: "Friday the 30th" },
      { id: "m1:cand:0:probe:0:opt:1", text: "Friday the 6th" },
    ]);
  });

  it("removes a model-written not-sure option; the app adds its own choice", async () => {
    const { output, trace } = await run([
      { stem, options: opts("Friday the 30th", "Friday the 6th", "Not sure", "None of the above") },
    ]);
    expect(output.probes[0]!.options.map((o) => o.text)).toEqual([
      "Friday the 30th",
      "Friday the 6th",
    ]);
    expect(trace.drops.map((d) => d.reason)).toEqual([
      "model_not_sure_option",
      "model_not_sure_option",
    ]);
  });

  it("drops blank and repeated options but leaves count problems to lint", async () => {
    const { output } = await run([
      { stem, options: opts("Friday the 30th", " ", "friday the 30th") },
    ]);
    expect(output.probes[0]!.options.map((o) => o.text)).toEqual(["Friday the 30th"]);
  });

  it("drops a probe with an empty stem", async () => {
    const { output, trace } = await run([{ stem: "  ", options: opts("a", "b") }]);
    expect(output.probes).toEqual([]);
    expect(trace.drops.map((d) => d.reason)).toEqual(["empty_stem"]);
  });

  it("refuses the template tier, which needs no model", async () => {
    await expect(run([], { tier: "template" })).rejects.toThrow(/no "template" tier/);
  });
});

describe("generateProbes, tier T1 (assisted)", () => {
  const assisted = (dimension: Candidate["dimension"] = "deadline") => ({
    ...input,
    tier: "assisted" as const,
    candidate: { ...candidate, dimension },
  });
  async function runAssisted(options: unknown[], over = assisted()) {
    const model = new ScriptedProvider({ generateProbes: [{ options }] });
    const result = await generateProbes(over, model);
    return { ...result, model };
  }

  it.each(["deadline", "scope", "criteria", "dependency", "outcome"] as const)(
    "%s: the stem equals the template stem byte for byte, even if the model sends one",
    async (dimension) => {
      const over = assisted(dimension);
      const expected = assistedStem({
        meeting: over.meeting,
        decision: over.decision.decision,
        candidate: over.candidate,
      });
      const model = new ScriptedProvider({
        generateProbes: [
          (req: { schema: { parse: (x: unknown) => unknown } }) => {
            // A stem key is not part of the T1 schema, so the model cannot supply one.
            expect(() => req.schema.parse({ stem: "Rewritten?", options: [] })).toThrow();
            return { options: opts("Friday the 30th", "Friday the 6th") };
          },
        ],
      });
      const { output } = await generateProbes(over, model);
      const [p] = output.probes;
      expect(Buffer.from(p!.stem).equals(Buffer.from(expected!))).toBe(true);
      expect(p).toMatchObject({ tier: "assisted", promptVersion: "generateProbesAssisted.v1" });
      expect(p!.options.map((o) => o.text)).toEqual(["Friday the 30th", "Friday the 6th"]);
      expect(probeSchema.parse(p)).toEqual(p);
    },
  );

  it("sends the assisted prompt with the fixed question and the readings", async () => {
    const { model } = await runAssisted(opts("A", "B"));
    const [req] = model.requests;
    expect(req!.promptVersion).toBe("generateProbesAssisted.v1");
    const user = req!.messages[1]!.content;
    expect(user).toContain(
      'Fixed question: For "Marco has SSO ready", what has to exist by "next Friday"?',
    );
    expect(user).toContain("- Friday the 6th");
  });

  it("owner has no T1 stem: no call, no probe, a drop", async () => {
    const model = new ScriptedProvider({});
    const { output, trace } = await generateProbes(assisted("owner"), model);
    expect(model.requests).toHaveLength(0);
    expect(output.probes).toEqual([]);
    expect(trace.drops.map((d) => d.reason)).toEqual(["no_assisted_stem"]);
  });

  it("an empty option list is the model declining", async () => {
    const { output } = await runAssisted([]);
    expect(output.probes).toEqual([]);
  });

  it("removes a model-written not-sure option", async () => {
    const { output, trace } = await runAssisted(opts("The draft", "Not sure", "The signed copy"));
    expect(output.probes[0]!.options.map((o) => o.text)).toEqual(["The draft", "The signed copy"]);
    expect(trace.drops.map((d) => d.reason)).toEqual(["model_not_sure_option"]);
  });

  it("feedback lists the rejected options and the problems", () => {
    const msg = assistedOptionsUserMessage(assisted(), "Q?", {
      probe: {
        stem: "Q?",
        options: [
          { id: "o0", text: "Short" },
          { id: "o1", text: "A much longer option text here" },
        ],
      },
      problems: ["longest option is 6× the shortest"],
    });
    expect(msg).toContain("Earlier options for this question were rejected:\n- Short");
    expect(msg).toContain("- longest option is 6× the shortest");
  });
});

describe("isNotSureOption", () => {
  it.each([
    ["Not sure", true],
    ["I don't know.", true],
    ["Not decided yet", true],
    ["Other", true],
    ["Not sure until legal replies", false],
    ["Friday the 6th", false],
  ])("%s → %s", (text, expected) => {
    expect(isNotSureOption(text)).toBe(expected);
  });
});
