import { dimension, type Candidate, type Dimension, type Impact } from "./model/analysis";
import type { Probe, ProbeTier } from "./model/probe";

/** R§6.2: at most this many questions per meeting. */
export const PROBE_BUDGET = 5;

/** Tiers to use per dimension, best first. A tier that is not listed is never selected. */
export type TierPriority = Record<Dimension, readonly ProbeTier[]>;

/** Free generation (T2) first everywhere until the M3.4 eval sets the order per dimension. */
const t2First = ["free", "assisted", "template"] as const;
export const DEFAULT_TIER_PRIORITY: TierPriority = {
  owner: t2First,
  deadline: t2First,
  scope: t2First,
  criteria: t2First,
  dependency: t2First,
  outcome: t2First,
};

export interface SelectableProbe {
  probe: Pick<Probe, "id" | "tier" | "lint">;
  candidate: Pick<Candidate, "decisionId" | "dimension" | "impact">;
  /** The decision's transcript order, the tie-break between equal impact. */
  decisionIdx: number;
}

const LEVEL = { low: 1, medium: 2, high: 3 } as const;
export const impactScore = (i: Impact) =>
  LEVEL[i.reversibility] + LEVEL[i.blastRadius] + LEVEL[i.timeToImpact];

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Picks the probes to send: one per (decision, dimension) in its best allowed tier, ranked
 * by impact, then decision order, then dimension catalog order, then probe ID, and cut to
 * the budget. The order is total, so the input order never changes the result.
 */
export function selectProbes<P extends SelectableProbe>(
  items: readonly P[],
  { budget = PROBE_BUDGET, tierPriority = DEFAULT_TIER_PRIORITY } = {},
): P[] {
  const best = new Map<string, { item: P; rank: number }>();
  for (const item of items) {
    if (item.probe.lint.length > 0) continue;
    const rank = tierPriority[item.candidate.dimension].indexOf(item.probe.tier);
    if (rank === -1) continue;
    const key = `${item.candidate.decisionId}\u0000${item.candidate.dimension}`;
    const current = best.get(key);
    if (
      !current ||
      rank < current.rank ||
      (rank === current.rank && byId(item.probe.id, current.item.probe.id) < 0)
    ) {
      best.set(key, { item, rank });
    }
  }

  const dimOrder = (d: Dimension) => dimension.options.indexOf(d);
  return [...best.values()]
    .map((b) => b.item)
    .sort(
      (a, b) =>
        impactScore(b.candidate.impact) - impactScore(a.candidate.impact) ||
        a.decisionIdx - b.decisionIdx ||
        dimOrder(a.candidate.dimension) - dimOrder(b.candidate.dimension) ||
        byId(a.probe.id, b.probe.id),
    )
    .slice(0, Math.max(0, budget));
}
