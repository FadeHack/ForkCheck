import { describe, expect, it } from "vitest";
import { lintProbe, parseTranscript, type Candidate, type Participant } from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import {
  critique,
  critiqueUserMessage,
  MAX_GENERATIONS,
  vetProbe,
  type VetProbeInput,
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
const input: VetProbeInput = {
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
    evidence: [],
  },
  candidate,
  tier: "free",
  segments,
};

const good = {
  stem: "On which day does the pilot customer first log in with SSO?",
  options: [{ text: "Friday the 30th" }, { text: "Friday the 6th" }],
};
const fixed = {
  stem: "Which Friday will the customer's admins first sign in through SSO?",
  options: [{ text: "This coming Friday" }, { text: "The Friday after" }],
};
// Repeats Marco's words, so lint fails before the critic is asked.
const verbatim = {
  stem: good.stem,
  options: [{ text: "ready for the pilot customer by next Friday" }, { text: "a week later" }],
};
const pass = { canDiverge: true, leadingOption: null, reason: "Each reading picks its own day." };
const leads = { canDiverge: true, leadingOption: 1, reason: "Only the second sounds safe." };

async function run(generations: unknown[], critiques: unknown[]) {
  const model = new ScriptedProvider({
    generateProbes: generations.map((p) => ({ probes: p === null ? [] : [p] })),
    critique: critiques,
  });
  const result = await vetProbe(input, model);
  const count = (stage: string) => model.requests.filter((r) => r.stage === stage).length;
  return { ...result, model, generations: count("generateProbes"), critiques: count("critique") };
}

describe("vetProbe", () => {
  it("returns a probe that passes lint and the critic on the first try", async () => {
    const r = await run([good], [pass]);
    expect(r.probe).toMatchObject({ stem: good.stem, candidateId: candidate.id, lint: [] });
    expect(r).toMatchObject({ generations: 1, critiques: 1, drops: [] });
    expect(r.traces.map((t) => t.stage)).toEqual(["generateProbes", "critique"]);
  });

  it("rewrites once after a lint failure, sending the findings back, without paying the critic", async () => {
    const r = await run([verbatim, fixed], [pass]);
    expect(r.probe?.stem).toBe(fixed.stem);
    expect(r).toMatchObject({ generations: 2, critiques: 1 });
    expect(r.drops.map((d) => d.reason)).toEqual(["regenerated_after_lint"]);
    const retry = r.model.requests.filter((q) => q.stage === "generateProbes")[1]!;
    const user = retry.messages[1]!.content;
    expect(user).toContain("An earlier question for this gap was rejected:");
    expect(user).toContain("- ready for the pilot customer by next Friday");
    expect(user).toContain("- option 1 repeats");
  });

  it("rewrites once after a critic failure, sending its reasons back", async () => {
    const r = await run([good, fixed], [leads, pass]);
    expect(r.probe?.stem).toBe(fixed.stem);
    expect(r.drops.map((d) => d.reason)).toEqual(["regenerated_after_critic"]);
    const retry = r.model.requests.filter((q) => q.stage === "generateProbes")[1]!;
    expect(retry.messages[1]!.content).toContain(
      '- Option "Friday the 6th" looks like the right answer.',
    );
  });

  it("drops the probe after two failures and never generates a third time", async () => {
    const r = await run([good, verbatim, good], [leads, pass]);
    expect(r.probe).toBeNull();
    expect(r.generations).toBe(MAX_GENERATIONS);
    expect(r.drops.map((d) => d.reason)).toEqual(["regenerated_after_critic", "failed_twice_lint"]);
  });

  it("drops without a rewrite when the model declines to write a question", async () => {
    const r = await run([null], []);
    expect(r.probe).toBeNull();
    expect(r).toMatchObject({ generations: 1, critiques: 0 });
    expect(r.drops.map((d) => d.reason)).toEqual(["model_declined"]);
  });

  it("never returns a probe with lint findings", async () => {
    for (const script of [
      [[good], [pass]],
      [[verbatim, fixed], [pass]],
      [[verbatim, verbatim], []],
      [
        [good, good],
        [leads, leads],
      ],
    ] as const) {
      const { probe } = await run([...script[0]], [...script[1]]);
      if (probe) {
        const targets = [{ decision: input.decision.decision, dimension: candidate.dimension }];
        expect(lintProbe(probe, { targets, segments })).toEqual([]);
      }
    }
  });
});

describe("critique", () => {
  const probe = {
    id: "p",
    meetingId: "m1",
    kind: "diagnostic" as const,
    candidateId: candidate.id,
    splitId: null,
    tier: "free" as const,
    stem: good.stem,
    options: [
      { id: "o0", text: "Friday the 30th" },
      { id: "o1", text: "Friday the 6th" },
    ],
    lint: [],
    promptVersion: "generateProbes.v1",
    status: "draft" as const,
  };
  const judge = async (reply: unknown) =>
    critique({ candidate, probe }, new ScriptedProvider({ critique: [reply] }));

  it("numbers options from 0 and shows the readings", () => {
    const msg = critiqueUserMessage({ candidate, probe });
    expect(msg).toContain("- Friday the 6th\n\nQuestion:");
    expect(msg).toContain("\n0 Friday the 30th\n1 Friday the 6th");
  });

  it("passes only when readings diverge and no option leads", async () => {
    expect((await judge(pass)).output).toEqual({ pass: true, reasons: [] });
    expect((await judge(leads)).output).toEqual({
      pass: false,
      reasons: [
        'Option "Friday the 6th" looks like the right answer.',
        "Only the second sounds safe.",
      ],
    });
    expect((await judge({ ...pass, canDiverge: false, reason: "Same pick." })).output).toEqual({
      pass: false,
      reasons: ["Readings would not lead to different options.", "Same pick."],
    });
  });

  it("ignores a leading-option index that names no option", async () => {
    expect((await judge({ ...pass, leadingOption: 7 })).output.pass).toBe(true);
  });
});

describe("vetProbe at tier T0", () => {
  // No scripted replies: any model call fails the test.
  const noModel = () => new ScriptedProvider({});

  it("returns the template probe without calling the model", async () => {
    const r = await vetProbe({ ...input, tier: "template" }, noModel());
    expect(r.probe).toMatchObject({ id: "m1:cand:0:t0", tier: "template", lint: [] });
    expect(r.traces).toEqual([]);
  });

  it("drops a dimension with no template", async () => {
    const r = await vetProbe(
      { ...input, tier: "template", candidate: { ...candidate, dimension: "criteria" } },
      noModel(),
    );
    expect(r.probe).toBeNull();
    expect(r.drops.map((d) => d.reason)).toEqual(["no_template"]);
  });
});
