import { z } from "zod";
import { dimension, type Dimension } from "../model/analysis";
import { probeTier, type ProbeTier } from "../model/probe";

/** The probe tier for every dimension; unknown dimensions or tiers are rejected. */
export const tierConfig = z.strictObject(
  Object.fromEntries(dimension.options.map((d) => [d, probeTier])) as Record<
    Dimension,
    typeof probeTier
  >,
);
export type TierConfig = z.infer<typeof tierConfig>;

export function parseTierConfig(raw: unknown): TierConfig {
  return tierConfig.parse(raw);
}

/** The gate runs a choice was made from, so the config can be traced back to its logs. */
export const TIER_RUNS: readonly string[] = [
  "g1-free-20261028",
  "g1-assisted-20261028",
  "g1-template-20261028",
  "g1-config-form-20261028",
  "g1-config-criteria-20261028",
];

/**
 * Default tier per dimension (R§6.2), from the gate runs in TIER_RUNS: highest reveal
 * rate, then fewest control false splits, then the least model-written wording.
 * Revealed counts are free / assisted / template.
 */
export const TIERS: TierConfig = parseTierConfig({
  // 3/3, 0/3, 1/1: ties free on rate, and fixed text wins the tie.
  owner: "template",
  // 6/6, 6/6, 1/2.
  deadline: "assisted",
  // 0/6 in every tier with model-written stems, which ask about features; the T0
  // deliverable-form template asks which version is meant (1/2 in g1-config-form-20261028,
  // where the miss plants readings the transcript never mentions).
  scope: "template",
  // 1/3 with 2 false splits, 1/3 with none, 0/1. Model-written options guessed at checks
  // nobody had in mind, so people answered "not sure"; T0 asks how thorough the check is
  // (3/3 in g1-config-criteria-20261028).
  criteria: "template",
  // Not planted in the dev set.
  dependency: "free",
  outcome: "free",
});

export function tierFor(d: Dimension, config: TierConfig = TIERS): ProbeTier {
  return config[d];
}
