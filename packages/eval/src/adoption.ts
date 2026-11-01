import { rate, type ConditionMetrics, type Ratio } from "./metrics";

/** R§7.3, fixed before the comparison run. */
export const ADOPTION_RULE = {
  /** Spark Open may trail Muse Spark by at most this many percentage points per metric. */
  maxGapPoints: 5,
  /** Share of the stage's calls that end in a schema-valid object, after the one repair. */
  minValidAfterRepair: 0.98,
} as const;

type Pick3 = (m: ConditionMetrics) => Record<string, Ratio>;

/** The two compared stages, their quality metrics and the model calls that produce them. */
export const COMPARED_STAGES: readonly {
  stage: "S2" | "S3";
  name: string;
  modelStages: readonly string[];
  quality: Pick3;
}[] = [
  {
    stage: "S2",
    name: "Extraction",
    modelStages: ["extract"],
    quality: (m) => ({
      precision: m.s2.precision,
      recall: m.s2.recall,
      "evidence validity": m.s2.evidenceValid,
    }),
  },
  {
    stage: "S3",
    name: "Questions",
    modelStages: ["findCandidates", "generateProbes", "critique"],
    quality: (m) => ({
      "reveal rate": m.s3.reveal,
      relevance: m.s3.relevance,
      "lint pass": m.s3.lintPass,
    }),
  },
];

export interface MetricGap {
  metric: string;
  spark: number | null;
  open: number | null;
  /** Spark Open minus Muse Spark, in percentage points; null when either side has no data. */
  gapPoints: number | null;
  within: boolean;
}

export interface AdoptionResult {
  stage: "S2" | "S3";
  name: string;
  metrics: MetricGap[];
  /** Spark Open calls for the stage: first answers that parsed, and objects after repair. */
  validFirstTry: Ratio;
  validAfterRepair: Ratio;
  adopt: boolean;
  /** Why it was not adopted; empty when it was. */
  reasons: string[];
}

function validity(m: ConditionMetrics, stages: readonly string[]) {
  const costs = m.cost.stages.filter((s) => stages.includes(s.stage));
  const calls = costs.reduce((t, s) => t + s.calls, 0);
  return {
    validFirstTry: costs.reduce(
      (t, s) => ({ n: t.n + s.validFirstTry.n, of: t.of + s.validFirstTry.of }),
      { n: 0, of: 0 },
    ),
    validAfterRepair: { n: calls - costs.reduce((t, s) => t + s.invalidJson, 0), of: calls },
  };
}

/**
 * Applies the adoption rule per stage, mechanically: every quality metric within
 * `maxGapPoints` of Muse Spark (or better), and JSON validity after repair at least
 * `minValidAfterRepair`. A metric with no data on either side fails the rule, so a stage is
 * never adopted on missing evidence. The demo path stays on Muse Spark whatever this says.
 */
export function applyAdoptionRule(
  spark: ConditionMetrics,
  open: ConditionMetrics,
): AdoptionResult[] {
  return COMPARED_STAGES.map(({ stage, name, modelStages, quality }) => {
    const a = quality(spark);
    const b = quality(open);
    const metrics = Object.keys(a).map((metric): MetricGap => {
      const s = rate(a[metric]!);
      const o = rate(b[metric]!);
      const gapPoints = s === null || o === null ? null : Math.round((o - s) * 1000) / 10;
      return {
        metric,
        spark: s,
        open: o,
        gapPoints,
        within: gapPoints !== null && gapPoints >= -ADOPTION_RULE.maxGapPoints,
      };
    });
    const v = validity(open, modelStages);
    const valid = rate(v.validAfterRepair);
    const reasons = [
      ...metrics
        .filter((m) => !m.within)
        .map((m) =>
          m.gapPoints === null
            ? `${m.metric}: no data`
            : `${m.metric}: ${Math.abs(m.gapPoints)} points below Muse Spark`,
        ),
      ...(valid === null
        ? ["JSON validity: no calls"]
        : valid < ADOPTION_RULE.minValidAfterRepair
          ? [`JSON validity after repair ${(valid * 100).toFixed(1)}% < 98%`]
          : []),
    ];
    return { stage, name, metrics, ...v, adopt: reasons.length === 0, reasons };
  });
}
