import { describe, expect, it } from "vitest";
import { parseTranscript, type Participant } from "@forkcheck/core";
import { ScriptedProvider } from "@forkcheck/ai";
import { extract, extractUserMessage, type ExtractInput } from "../src/index";

const meeting = {
  id: "m1",
  title: "SSO check-in",
  heldAt: "2026-10-26T15:00:00-04:00",
  timezone: "America/New_York",
};
const participants: Participant[] = ["Priya", "Marco", "Dana"].map((name) => ({
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
    "[00:00] Priya: Where are we on single sign-on for the pilot customer?",
    "[00:06] Marco: Login works on staging. I still need to wire up the admin roles.",
    "[00:20] Priya: OK, so SSO is ready by Friday. Marco, that’s yours?",
    "[00:25] Marco: Yep, I'll have it ready by Friday.",
    "[00:29] Dana: Great, I'll tell them Friday.",
    "[00:33] Priya: We'll sort out the launch email.",
  ].join("\n"),
});
const input: ExtractInput = { meeting, participants, segments };
const seg = (i: number) => segments[i]!.id;

const draft = (over: Record<string, unknown>) => ({
  kind: "commitment",
  statement: "Something happens.",
  ownerText: null,
  deadlineText: null,
  status: "ambiguous",
  evidence: [],
  ...over,
});

async function run(decisions: unknown[]) {
  const model = new ScriptedProvider({ extract: [{ decisions }] });
  const result = await extract(input, model);
  return { ...result, model };
}

describe("extract", () => {
  it("sends the versioned prompt and a transcript keyed by segment ID", async () => {
    const { model, trace } = await run([]);
    const [req] = model.requests;
    expect(req).toMatchObject({ stage: "extract", promptVersion: "extract.v1" });
    expect(req!.messages[0]!.content).toMatch(/^You read a meeting transcript/);
    expect(req!.messages[1]!.content).toContain(
      `[${seg(3)}] Marco: Yep, I'll have it ready by Friday.`,
    );
    expect(req!.messages[1]!.content).toContain("Held: Monday, October 26, 2026");
    expect(trace).toMatchObject({ stage: "extract", promptVersion: "extract.v1", drops: [] });
  });

  it("keeps verified quotes in the transcript's own characters", async () => {
    const { output } = await run([
      draft({
        statement: "SSO is ready by Friday.",
        ownerText: "Marco",
        deadlineText: "by Friday",
        // Straight apostrophe in the model's copy, curly in the transcript.
        evidence: [{ segmentId: seg(2), quote: "Marco, that's yours?" }],
      }),
    ]);
    const [d] = output.decisions;
    expect(d!.decision).toMatchObject({
      id: "m1:dec:0",
      idx: 0,
      ownerText: "Marco",
      ownerInferred: false,
      deadlineText: "by Friday",
      deadlineInferred: true,
    });
    expect(d!.evidence).toEqual([
      {
        id: "m1:dec:0:ev:0",
        decisionId: "m1:dec:0",
        resolutionId: null,
        segmentId: seg(2),
        quote: "Marco, that’s yours?",
      },
    ]);
  });

  it("drops invalid quotes, and a decision left with none", async () => {
    const { output, trace } = await run([
      draft({
        statement: "SSO is ready by Friday.",
        evidence: [
          { segmentId: seg(3), quote: "I'll have it ready by Friday" },
          { segmentId: seg(3), quote: "I'll have it live by Friday" },
          { segmentId: "m1:seg:99", quote: "ready" },
        ],
      }),
      draft({
        statement: "Dana tells the customer on Thursday.",
        evidence: [{ segmentId: seg(4), quote: "I'll tell them Thursday." }],
      }),
    ]);
    expect(output.decisions).toHaveLength(1);
    expect(output.decisions[0]!.evidence.map((e) => e.quote)).toEqual([
      "I'll have it ready by Friday",
    ]);
    expect(trace.drops.map((d) => d.reason)).toEqual([
      "evidence_not_found",
      "evidence_unknown_segment",
      "evidence_not_found",
      "no_verified_evidence",
    ]);
  });

  it.each([
    ["named in a quote", "Marco", seg(2), "Marco, that’s yours?", false],
    ["first person by the owner", "Marco", seg(3), "I'll have it ready by Friday", false],
    ["first person by someone else", "Marco", seg(4), "I'll tell them Friday.", true],
    ["not in any quote", "Dana", seg(3), "I'll have it ready by Friday", true],
    ["a group named in the quote", "We", seg(5), "We'll sort out the launch email.", false],
    [
      "a role the model guessed",
      "the marketing team",
      seg(5),
      "We'll sort out the launch email.",
      true,
    ],
  ])("owner %s → inferred %s", async (_name, ownerText, segmentId, quote, inferred) => {
    const { output } = await run([draft({ ownerText, evidence: [{ segmentId, quote }] })]);
    expect(output.decisions[0]!.decision.ownerInferred).toBe(inferred);
  });

  it.each([
    ["by Friday", "I'll have it ready by Friday", false],
    ["BY FRIDAY", "I'll have it ready by Friday", false],
    ["2026-10-30", "I'll have it ready by Friday", true],
    ["Friday 10:00 ET", "I'll have it ready by Friday", true],
  ])("deadline %s → inferred %s", async (deadlineText, quote, inferred) => {
    const { output } = await run([
      draft({ deadlineText, evidence: [{ segmentId: seg(3), quote }] }),
    ]);
    expect(output.decisions[0]!.decision.deadlineInferred).toBe(inferred);
  });

  it("treats blank owner and deadline as absent, and passes status through", async () => {
    const { output } = await run([
      draft({
        ownerText: " ",
        deadlineText: "",
        status: "debated",
        evidence: [{ segmentId: seg(5), quote: "launch email" }],
      }),
    ]);
    expect(output.decisions[0]!.decision).toMatchObject({
      ownerText: null,
      ownerInferred: false,
      deadlineText: null,
      deadlineInferred: false,
      status: "debated",
    });
  });

  it("rejects a status outside the enum", async () => {
    await expect(
      run([draft({ status: "maybe", evidence: [{ segmentId: seg(5), quote: "launch" }] })]),
    ).rejects.toThrow();
  });
});

describe("extractUserMessage", () => {
  it("flattens multi-line turns and labels unknown speakers", () => {
    const text = extractUserMessage({
      meeting,
      participants,
      segments: [
        { ...segments[0]!, text: "line one\nline two", participantId: null, speakerLabel: "B" },
      ],
    });
    expect(text).toContain(`[${seg(0)}] Speaker B: line one line two`);
  });
});
