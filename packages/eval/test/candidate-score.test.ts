import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candidate, Dimension } from "@forkcheck/core";
import type { DecisionWithEvidence } from "@forkcheck/engine";
import { parseScenario, scoreCandidates } from "../src/index";

const s = parseScenario(
  readFileSync(
    new URL("../../../scenarios/dev/ownership-outage-email.json", import.meta.url),
    "utf8",
  ),
);
const planted = s.plantedMismatches[0]!;
const quote = s.expectedDecisions.find((e) => e.id === planted.decision)!.quotes[0]!;

const decisions: DecisionWithEvidence[] = [
  {
    decision: {
      id: "x:dec:0",
      meetingId: s.id,
      idx: 0,
      kind: "commitment",
      statement: quote,
      ownerText: null,
      deadlineText: null,
      ownerInferred: false,
      deadlineInferred: false,
      status: "ambiguous",
    },
    evidence: [{ id: "e", decisionId: "x:dec:0", resolutionId: null, segmentId: "s", quote }],
  },
];
const candidate = (id: string, dimension: Dimension, decisionId = "x:dec:0"): Candidate => ({
  id,
  decisionId,
  dimension,
  readings: [
    { id: `${id}:r:0`, text: "one" },
    { id: `${id}:r:1`, text: "two" },
  ],
  impact: { reversibility: "low", blastRadius: "low", timeToImpact: "low" },
});

describe("scoreCandidates", () => {
  it("finds a planted gap only on the matching decision and dimension", () => {
    const score = scoreCandidates(s, decisions, [
      candidate("c0", planted.dimension),
      candidate("c1", planted.dimension === "scope" ? "deadline" : "scope"),
    ]);
    expect(score).toMatchObject({ candidates: 2, hit: [planted.id], missed: [] });
    expect([...score.onPlanted]).toEqual(["c0"]);
  });

  it("misses a planted gap when the dimension differs or the decision was not extracted", () => {
    const other: Dimension = planted.dimension === "scope" ? "deadline" : "scope";
    expect(scoreCandidates(s, decisions, [candidate("c0", other)]).missed).toEqual([planted.id]);
    expect(scoreCandidates(s, [], []).missed).toEqual([planted.id]);
  });
});
