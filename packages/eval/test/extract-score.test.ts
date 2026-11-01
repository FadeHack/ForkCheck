import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DecisionWithEvidence } from "@forkcheck/engine";
import {
  parseScenario,
  scenarioExtractInput,
  scoreExtraction,
  summarizeScores,
} from "../src/index";

const s = parseScenario(
  readFileSync(
    new URL("../../../scenarios/dev/ownership-outage-email.json", import.meta.url),
    "utf8",
  ),
);

const extracted = (
  quote: string,
  over: Partial<DecisionWithEvidence["decision"]> = {},
): DecisionWithEvidence => ({
  decision: {
    id: `d-${quote}`,
    meetingId: s.id,
    idx: 0,
    kind: "commitment",
    statement: quote,
    ownerText: null,
    deadlineText: null,
    ownerInferred: false,
    deadlineInferred: false,
    status: "ambiguous",
    ...over,
  },
  evidence: [{ id: "e", decisionId: "d", resolutionId: null, segmentId: "x", quote }],
});

describe("scenarioExtractInput", () => {
  it("parses the transcript with every speaker known", () => {
    const input = scenarioExtractInput(s);
    expect(input.participants.map((p) => p.id)).toEqual(s.participants);
    expect(input.segments.every((seg) => seg.participantId !== null)).toBe(true);
  });
});

describe("scoreExtraction", () => {
  it("matches on overlapping quotes and lists misses and extras", () => {
    const score = scoreExtraction(s, [
      extracted("handle the customer emails"),
      extracted("I'll have the credits applied by Thursday.", { ownerText: "Felix" }),
      extracted("We should look at that."),
    ]);
    expect(score).toMatchObject({ expected: 6, extracted: 3, matched: 2, invented: [] });
    expect(score.missed).toEqual([
      "workspace-export",
      "close-tickets",
      "postmortem",
      "status-page-step",
    ]);
    expect(score.extra).toEqual(["We should look at that."]);
  });

  it("notes a stated owner that differs from the answer key, but not an inferred one", () => {
    const quote = "we'll handle the customer emails by tomorrow";
    const score = scoreExtraction(s, [extracted(quote, { ownerText: "Imani" })]);
    expect(score.differs).toEqual([{ decision: "customer-email", field: "owner", value: "Imani" }]);
    expect(score.invented).toEqual([]);
    expect(
      scoreExtraction(s, [extracted(quote, { ownerText: "Imani", ownerInferred: true })]).differs,
    ).toEqual([]);
  });

  it("counts stated fields the transcript never says as invented", () => {
    const quote = "I'll add a step for it.";
    const score = scoreExtraction(s, [
      extracted(quote, { ownerText: "the SRE team", deadlineText: "Friday" }),
    ]);
    expect(score.invented).toEqual([
      { decision: `d-${quote}`, field: "owner", value: "the SRE team" },
      { decision: `d-${quote}`, field: "deadline", value: "Friday" },
    ]);
  });

  it("does not count a spoken conditional deadline as invented", () => {
    const score = scoreExtraction(s, [
      extracted("I'll publish the postmortem on the blog after legal reads it.", {
        ownerText: "Felix",
        deadlineText: "after legal reads it",
      }),
    ]);
    expect(score.invented).toEqual([]);
    expect(score.differs).toEqual([
      { decision: "postmortem", field: "deadline", value: "after legal reads it" },
    ]);
  });

  it("on audio, matches a quote the ASR heard with drift, not on paste", () => {
    const heard = "I'll publish the publish the post mortem on the blog after legal reads it.";
    const audio = { text: `Felix: ${heard}` };
    expect(scoreExtraction(s, [extracted(heard)]).matched).toBe(0);
    expect(scoreExtraction(s, [extracted(heard)], audio).matched).toBe(1);
  });

  it("on audio, still refuses short or mostly different quotes", () => {
    const audio = { text: "" };
    // Contained in the expected quote: a match on paste and audio alike.
    expect(scoreExtraction(s, [extracted("blog after legal")], audio).matched).toBe(1);
    // Four words, all in the expected quote but not as a phrase: too short to match on words.
    expect(scoreExtraction(s, [extracted("legal reads the blog")], audio).matched).toBe(0);
    // Five words, three shared.
    expect(scoreExtraction(s, [extracted("legal reads the contract today")], audio).matched).toBe(
      0,
    );
    expect(
      scoreExtraction(s, [extracted("I'll publish the release notes on the wiki today.")], audio)
        .matched,
    ).toBe(0);
  });

  it("on audio, a field the ASR heard is not invented", () => {
    const quote = "I'll add a step for it.";
    const decision = extracted(quote, { ownerText: "the SRE team" });
    expect(scoreExtraction(s, [decision]).invented).toHaveLength(1);
    expect(
      scoreExtraction(s, [decision], { text: "the SRE team will add a step for it" }).invented,
    ).toEqual([]);
  });

  it("summarizes precision and recall", () => {
    const score = scoreExtraction(s, [extracted("handle the customer emails"), extracted("nope")]);
    expect(summarizeScores([score])).toMatchObject({ precision: 0.5, recall: 1 / 6, invented: 0 });
  });
});
