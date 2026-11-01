import { describe, expect, it } from "vitest";
import {
  ADOPTION_RULE,
  applyAdoptionRule,
  type ConditionMetrics,
  type Ratio,
  type StageCost,
} from "../src/index";

const r = (n: number, of = 100): Ratio => ({ n, of });

function stage(name: string, calls: number, invalidJson = 0, validFirstTry?: number): StageCost {
  return {
    stage: name,
    calls,
    failed: invalidJson,
    p50Ms: 1000,
    p95Ms: 2000,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    validFirstTry: validFirstTry === undefined ? r(0, 0) : r(validFirstTry, calls),
    invalidJson,
  };
}

/** Synthetic results: S2 precision/recall/evidence and S3 reveal/relevance/lint, in percent. */
function results(
  s2: [number, number, number],
  s3: [number, number, number],
  stages: StageCost[],
  provider = "meta",
): ConditionMetrics {
  return {
    condition: `${provider}/paste/precise`,
    runIds: ["r"],
    scenarios: 78,
    failedRuns: r(0, 78),
    s2: { precision: r(s2[0]), recall: r(s2[1]), evidenceValid: r(s2[2]), invented: 0 },
    s3: { reveal: r(s3[0]), relevance: r(s3[1]), lintPass: r(s3[2]) },
    s4: { precision: r(0), recall: r(0), falseSplits: 0, controls: 0 },
    s5: { confirmedOnlyWithAll: r(0, 0), modelActions: 0 },
    s6: { catch: r(0, 0), pass: r(0, 0), novel: r(0, 0) },
    s7: { traceable: r(0, 0), unresolvedVisible: r(0, 0), inferredText: 0, validRecords: r(0, 0) },
    cost: {
      stages,
      totalUsd: 0,
      byProvider: {},
      usdPerMeeting: 0,
      callsPerMeeting: 0,
      failedCalls: r(0, 0),
    },
  };
}

const spark = results([90, 80, 95], [75, 70, 60], [stage("extract", 78), stage("critique", 200)]);
const cleanStages = [
  stage("extract", 100, 1, 90),
  stage("findCandidates", 100, 0, 99),
  stage("generateProbes", 100, 1, 95),
  stage("critique", 100, 0, 100),
];

describe("applyAdoptionRule", () => {
  it("adopts a stage within 5 points on every metric with ≥98% valid JSON", () => {
    // Exactly 5 points behind on S2 recall; better than Spark on S3 relevance.
    const open = results([88, 75, 95], [71, 80, 58], cleanStages, "baseten");
    const [s2, s3] = applyAdoptionRule(spark, open);
    expect(s2).toMatchObject({ stage: "S2", adopt: true, reasons: [] });
    expect(s2!.metrics.map((m) => m.gapPoints)).toEqual([-2, -5, 0]);
    expect(s2!.validAfterRepair).toEqual({ n: 99, of: 100 });
    expect(s2!.validFirstTry).toEqual({ n: 90, of: 100 });
    expect(s3).toMatchObject({ stage: "S3", adopt: true });
    expect(s3!.metrics.find((m) => m.metric === "relevance")!.gapPoints).toBe(10);
    expect(s3!.validAfterRepair).toEqual({ n: 299, of: 300 });
  });

  it("rejects a stage more than 5 points behind on any one metric", () => {
    const open = results([90, 74.9, 95], [75, 70, 60], cleanStages, "baseten");
    const [s2, s3] = applyAdoptionRule(spark, open);
    expect(s2).toMatchObject({ adopt: false, reasons: ["recall: 5.1 points below Muse Spark"] });
    expect(s3!.adopt).toBe(true);
  });

  it("rejects a stage whose JSON validity after repair is under 98%, whatever its quality", () => {
    const open = results(
      [95, 90, 99],
      [80, 80, 70],
      [stage("extract", 100, 3, 60), ...cleanStages.slice(1)],
      "baseten",
    );
    const [s2, s3] = applyAdoptionRule(spark, open);
    expect(s2).toMatchObject({
      adopt: false,
      reasons: ["JSON validity after repair 97.0% < 98%"],
    });
    expect(s3!.adopt).toBe(true);
  });

  it("accepts exactly 98% valid", () => {
    const open = results([90, 80, 95], [75, 70, 60], [stage("extract", 50, 1)], "baseten");
    const [s2] = applyAdoptionRule(spark, open);
    expect(s2!.validAfterRepair).toEqual({ n: 49, of: 50 });
    expect(s2!.adopt).toBe(true);
    expect(ADOPTION_RULE.minValidAfterRepair).toBe(0.98);
  });

  it("never adopts on missing data", () => {
    const open = results([90, 80, 95], [75, 70, 60], [stage("extract", 100)], "baseten");
    open.s3.reveal = r(0, 0);
    const [, s3] = applyAdoptionRule(spark, open);
    expect(s3).toMatchObject({ adopt: false });
    expect(s3!.reasons).toEqual(["reveal rate: no data", "JSON validity: no calls"]);
  });
});
