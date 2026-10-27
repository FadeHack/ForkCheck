import { describe, expect, it } from "vitest";
import { answer, evidence, meeting } from "../src/index";

const baseAnswer = {
  id: "a1",
  probeId: "p1",
  participantId: "u1",
  choice: "option" as const,
  optionId: "o1",
  writeInText: null,
  mappedOptionId: null,
  mappedByModel: false,
};

describe("answer", () => {
  it("accepts an option answer", () => {
    expect(answer.safeParse(baseAnswer).success).toBe(true);
  });

  it("accepts a write-in mapped by the model", () => {
    const mapped = {
      ...baseAnswer,
      choice: "write_in",
      optionId: null,
      writeInText: "prod by Friday",
      mappedOptionId: "o2",
      mappedByModel: true,
    };
    expect(answer.safeParse(mapped).success).toBe(true);
  });

  it("rejects unsure with an option set", () => {
    expect(answer.safeParse({ ...baseAnswer, choice: "unsure" }).success).toBe(false);
  });

  it("rejects a mapped option on a non-write-in", () => {
    expect(answer.safeParse({ ...baseAnswer, mappedOptionId: "o2" }).success).toBe(false);
  });
});

describe("evidence", () => {
  const base = { id: "e1", segmentId: "s1", quote: "by Friday" };

  it("needs exactly one target", () => {
    expect(evidence.safeParse({ ...base, decisionId: "d1", resolutionId: null }).success).toBe(
      true,
    );
    expect(evidence.safeParse({ ...base, decisionId: null, resolutionId: null }).success).toBe(
      false,
    );
    expect(evidence.safeParse({ ...base, decisionId: "d1", resolutionId: "r1" }).success).toBe(
      false,
    );
  });
});

describe("meeting", () => {
  it("rejects extra keys such as token hashes", () => {
    const m = {
      id: "m1",
      title: "Sync",
      source: "paste",
      status: "draft",
      heldAt: "2026-10-26T15:00:00-04:00",
      timezone: "America/New_York",
      transcriptVersion: 0,
      error: null,
      createdAt: "2026-10-26T19:00:00Z",
      deleteAfter: null,
    };
    expect(meeting.safeParse(m).success).toBe(true);
    expect(meeting.safeParse({ ...m, organizerTokenHash: "x" }).success).toBe(false);
  });
});
