import { z } from "zod";
import { dimension, probeTier, type Dimension, type ProbeTier } from "@forkcheck/core";

/** R§6.5 thresholds for an 8-scenario set of 6 planted mismatches and 2 controls. */
export const G1 = {
  mismatchScenarios: 6,
  controlScenarios: 2,
  minRevealed: 5,
  minOverall: 6,
  maxControlFalseSplits: 1,
} as const;

/** One scenario run through the first probe rounds, as the gate script logs it. */
export const gateLog = z.strictObject({
  runId: z.string().min(1),
  run: z.number().int().nonnegative(),
  scenario: z.string().min(1),
  tier: probeTier,
  planted: z.array(z.strictObject({ id: z.string(), dimension })),
  candidates: z.array(
    z.object({
      id: z.string(),
      dimension,
      mismatch: z.string().nullable(),
      probeId: z.string().nullable(),
    }),
  ),
  rounds: z.array(
    z.object({
      probeId: z.string(),
      stem: z.string(),
      divergence: z.object({ outcome: z.enum(["split", "consistent", "insufficient"]) }),
    }),
  ),
  costUsd: z.number().nonnegative(),
});
export type GateLog = z.infer<typeof gateLog>;

export interface GateScenarioResult {
  scenario: string;
  control: boolean;
  /** Planted mismatches with a split on a probe for the same decision and dimension. */
  revealed: string[];
  missed: string[];
  /** Splits on probes that target no planted mismatch. */
  unplantedSplits: number;
  probes: number;
}

export interface GateRunResult {
  run: number;
  scenarios: GateScenarioResult[];
  revealed: number;
  overall: number;
  controlFalseSplits: number;
  go: boolean;
  /** Why the run is NO-GO; empty when it is GO. */
  reasons: string[];
}

export interface DimensionScore {
  revealed: number;
  of: number;
  falseSplits: number;
}

export interface GateVerdict {
  go: boolean;
  runsNeeded: number;
  runs: GateRunResult[];
  /**
   * Over all runs, per dimension: planted mismatches revealed, and splits in the controls
   * on probes of that dimension.
   */
  byDimension: Partial<Record<Dimension, DimensionScore>>;
  costUsd: number;
}

export function scoreGateScenario(log: GateLog): GateScenarioResult {
  const candidateOf = new Map(
    log.candidates.flatMap((c) => (c.probeId ? [[c.probeId, c] as const] : [])),
  );
  const split = log.rounds.filter((r) => r.divergence.outcome === "split");
  const hit = new Set(split.map((r) => candidateOf.get(r.probeId)?.mismatch ?? null));
  return {
    scenario: log.scenario,
    control: log.planted.length === 0,
    revealed: log.planted.filter((m) => hit.has(m.id)).map((m) => m.id),
    missed: log.planted.filter((m) => !hit.has(m.id)).map((m) => m.id),
    unplantedSplits: split.filter((r) => !candidateOf.get(r.probeId)?.mismatch).length,
    probes: log.rounds.length,
  };
}

/** R§6.5 on one run: a mismatch scenario succeeds when every planted mismatch split, a control when nothing split. */
export function scoreGateRun(run: number, logs: GateLog[]): GateRunResult {
  const scenarios = logs
    .map(scoreGateScenario)
    .sort((a, b) => a.scenario.localeCompare(b.scenario));
  const mismatch = scenarios.filter((s) => !s.control);
  const controls = scenarios.filter((s) => s.control);
  const revealed = mismatch.filter((s) => s.missed.length === 0).length;
  const cleanControls = controls.filter((s) => s.unplantedSplits === 0).length;
  const controlFalseSplits = controls.reduce((n, s) => n + s.unplantedSplits, 0);
  const overall = revealed + cleanControls;

  const reasons: string[] = [];
  if (mismatch.length !== G1.mismatchScenarios || controls.length !== G1.controlScenarios) {
    reasons.push(
      `set has ${mismatch.length} mismatch and ${controls.length} control scenarios, ` +
        `expected ${G1.mismatchScenarios} and ${G1.controlScenarios}`,
    );
  }
  if (revealed < G1.minRevealed) {
    reasons.push(`revealed ${revealed}/${mismatch.length}, needs ${G1.minRevealed}`);
  }
  if (overall < G1.minOverall) {
    reasons.push(`overall ${overall}/${scenarios.length}, needs ${G1.minOverall}`);
  }
  if (controlFalseSplits > G1.maxControlFalseSplits) {
    reasons.push(
      `${controlFalseSplits} false splits in controls, allows ${G1.maxControlFalseSplits}`,
    );
  }
  return {
    run,
    scenarios,
    revealed,
    overall,
    controlFalseSplits,
    go: reasons.length === 0,
    reasons,
  };
}

/**
 * The gate over repeated runs of the set: GO when a majority of runs meet R§6.5, so one
 * unlucky sample neither passes nor fails the gate alone.
 */
export function gateVerdict(logs: GateLog[]): GateVerdict {
  const byRun = new Map<number, GateLog[]>();
  for (const log of logs) byRun.set(log.run, [...(byRun.get(log.run) ?? []), log]);
  const runs = [...byRun].sort(([a], [b]) => a - b).map(([run, ls]) => scoreGateRun(run, ls));
  const runsNeeded = Math.floor(runs.length / 2) + 1;

  const byDimension: GateVerdict["byDimension"] = {};
  const score = (d: Dimension) => (byDimension[d] ??= { revealed: 0, of: 0, falseSplits: 0 });
  for (const log of logs) {
    const { revealed } = scoreGateScenario(log);
    for (const m of log.planted) {
      score(m.dimension).of += 1;
      if (revealed.includes(m.id)) score(m.dimension).revealed += 1;
    }
    if (log.planted.length > 0) continue;
    const dimensionOf = new Map(log.candidates.map((c) => [c.probeId, c.dimension]));
    for (const r of log.rounds) {
      const d = dimensionOf.get(r.probeId);
      if (d && r.divergence.outcome === "split") score(d).falseSplits += 1;
    }
  }
  return {
    go: runs.length > 0 && runs.filter((r) => r.go).length >= runsNeeded,
    runsNeeded,
    runs,
    byDimension,
    costUsd: logs.reduce((t, l) => t + l.costUsd, 0),
  };
}

const pct = (n: number, of: number) => (of === 0 ? "n/a" : `${Math.round((n / of) * 100)}%`);

export function renderGateReport(verdict: GateVerdict, logs: GateLog[]): string {
  const first = logs[0];
  const lines = [
    `# Gate G1: ${verdict.go ? "GO" : "NO-GO"}`,
    "",
    `Run ID \`${first?.runId ?? "none"}\`, tier \`${first?.tier ?? "none"}\`, ` +
      `${verdict.runs.length} runs of the dev set; GO needs ${verdict.runsNeeded} passing runs. ` +
      `Cost $${verdict.costUsd.toFixed(4)}.`,
    "",
    `Per run (R§6.5): planted mismatch revealed in at least ${G1.minRevealed} of ` +
      `${G1.mismatchScenarios}, at least ${G1.minOverall} of ` +
      `${G1.mismatchScenarios + G1.controlScenarios} overall, at most ` +
      `${G1.maxControlFalseSplits} false split in the controls.`,
    "",
    "| Run | Revealed | Overall | Control false splits | Result |",
    "| --- | --- | --- | --- | --- |",
    ...verdict.runs.map(
      (r) =>
        `| ${r.run} | ${r.revealed}/${G1.mismatchScenarios} | ${r.overall}/` +
        `${G1.mismatchScenarios + G1.controlScenarios} | ${r.controlFalseSplits} | ` +
        `${r.go ? "pass" : `fail: ${r.reasons.join("; ")}`} |`,
    ),
    "",
    "## Per scenario",
    "",
    "| Scenario | Kind | Revealed or clean | Probes asked | Unplanted splits |",
    "| --- | --- | --- | --- | --- |",
  ];
  const names = [
    ...new Set(verdict.runs.flatMap((r) => r.scenarios.map((s) => s.scenario))),
  ].sort();
  for (const name of names) {
    const per = verdict.runs.flatMap((r) => r.scenarios.filter((s) => s.scenario === name));
    const control = per[0]?.control ?? false;
    const ok = per.filter((s) => (control ? s.unplantedSplits === 0 : s.missed.length === 0));
    lines.push(
      `| ${name} | ${control ? "control" : "mismatch"} | ${ok.length}/${per.length} | ` +
        `${per.map((s) => s.probes).join(", ")} | ${per.map((s) => s.unplantedSplits).join(", ")} |`,
    );
  }
  lines.push(
    "",
    "## Per dimension",
    "",
    "| Dimension | Revealed | Control false splits |",
    "| --- | --- | --- |",
  );
  for (const [d, t] of Object.entries(verdict.byDimension)) {
    lines.push(`| ${d} | ${t.revealed}/${t.of} (${pct(t.revealed, t.of)}) | ${t.falseSplits} |`);
  }
  return `${lines.join("\n")}\n`;
}

export interface TierCandidate {
  tier: ProbeTier;
  runId: string;
  score: DimensionScore;
}

/**
 * M3.4: for one dimension, the tier with the highest reveal rate, then the fewest false
 * splits in the controls, then the least model-written wording (R§6.2). A tier that never
 * revealed the dimension is not picked.
 */
export function pickTier(candidates: TierCandidate[]): TierCandidate | null {
  const rate = (c: TierCandidate) => (c.score.of === 0 ? 0 : c.score.revealed / c.score.of);
  const ranked = candidates
    .filter((c) => c.score.revealed > 0)
    .sort(
      (a, b) =>
        rate(b) - rate(a) ||
        a.score.falseSplits - b.score.falseSplits ||
        probeTier.options.indexOf(a.tier) - probeTier.options.indexOf(b.tier),
    );
  return ranked[0] ?? null;
}
