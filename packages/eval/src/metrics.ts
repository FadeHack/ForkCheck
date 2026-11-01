import { z } from "zod";
import {
  decision,
  decisionRecord,
  dimension,
  evidence,
  normalizeQuote,
  PROBE_LINT_DEFAULTS,
  recordValidation,
  stemOverlap,
} from "@forkcheck/core";
import { scoreExtraction } from "./extract-score";
import type { LoopResult, ProbeRounds } from "./loop";
import type { Scenario } from "./scenario";

const outcome = z.enum(["split", "consistent", "insufficient"]);
const round = z.object({
  probeId: z.string(),
  stem: z.string(),
  /** Kept for the human rating sheets; the metrics only need the outcome. */
  options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  answers: z
    .array(
      z.object({
        participantId: z.string(),
        choice: z.enum(["option", "unsure", "write_in"]),
        optionId: z.string().nullable(),
      }),
    )
    .optional(),
  divergence: z.object({ outcome }),
});
const actor = z.object({ kind: z.enum(["participant", "model"]) });

/** One model call as the call log records it: no message content, keys or tokens. */
export const modelCallEntry = z.object({
  stage: z.string().min(1),
  provider: z.enum(["meta", "baseten", "fake"]),
  model: z.string(),
  promptVersion: z.string(),
  cacheHit: z.boolean(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative(),
  ok: z.boolean(),
  error: z.string().nullable(),
  /** Set by providers that repair invalid JSON: whether the first answer parsed. */
  validFirstTry: z.boolean().optional(),
});
export type ModelCallEntry = z.infer<typeof modelCallEntry>;

/**
 * One scenario through the loop under one condition, as the eval run writes it to
 * `<run>/logs/*.json`. Every metric below is computed from these files alone.
 */
export const runLog = z.object({
  runId: z.string().min(1),
  run: z.number().int().nonnegative(),
  scenario: z.string().min(1),
  provider: z.enum(["meta", "baseten", "fake"]),
  source: z.enum(["paste", "audio"]),
  resolution: z.enum(["precise", "vague"]),
  /** `detect` runs stop after the first probe rounds (S2–S4); `loop` runs go to the record. */
  depth: z.enum(["detect", "loop"]),
  segments: z.array(z.object({ id: z.string(), text: z.string() })),
  decisions: z.array(z.object({ decision, evidence: z.array(evidence) })),
  candidates: z.array(
    z.object({
      id: z.string(),
      dimension,
      mismatch: z.string().nullable(),
      probeId: z.string().nullable(),
    }),
  ),
  rounds: z.array(round),
  splits: z.array(
    z.object({
      splitId: z.string(),
      probeId: z.string(),
      mismatch: z.string().nullable(),
      events: z.array(z.object({ type: z.string(), actor: actor.optional() })),
      recheck: z
        .object({
          probe: z.object({ stem: z.string() }).nullable(),
          round: round.nullable(),
        })
        .nullable(),
      state: z.object({
        status: z.string(),
        participants: z.array(z.object({ id: z.string(), status: z.string() })),
        resolutions: z.array(z.object({ id: z.string(), status: z.string() })),
        confirmations: z.array(z.object({ resolutionId: z.string(), participantId: z.string() })),
      }),
    }),
  ),
  record: decisionRecord.nullable(),
  validation: recordValidation.nullable(),
  stages: z.array(z.object({ stage: z.string(), calls: z.array(modelCallEntry) })),
});
export type RunLog = z.infer<typeof runLog>;

export interface Ratio {
  n: number;
  of: number;
}
const ratio = (n: number, of: number): Ratio => ({ n, of });
const add = (a: Ratio, b: Ratio): Ratio => ({ n: a.n + b.n, of: a.of + b.of });
export const rate = (r: Ratio): number | null => (r.of === 0 ? null : r.n / r.of);

export interface ScenarioMetrics {
  scenario: string;
  control: boolean;
  s2: {
    precision: Ratio;
    recall: Ratio;
    /** Evidence quotes found word for word in their segment after normalization. */
    evidenceValid: Ratio;
    invented: number;
  };
  s3: {
    /** Planted mismatches whose probe split. */
    reveal: Ratio;
    /** Asked probes that target a planted mismatch; mismatch scenarios only. */
    relevance: Ratio;
    /** Candidates that became a published probe after lint and critic. */
    lintPass: Ratio;
  };
  s4: {
    /** Splits that landed on a planted mismatch. */
    precision: Ratio;
    recall: Ratio;
    /** Splits on unplanted probes in a control scenario. */
    falseSplits: number;
    missed: string[];
  };
  s5: {
    /** Splits whose state never claims confirmation without every active participant. */
    confirmedOnlyWithAll: Ratio;
    /** Resolution events a model acted on. Must be zero. */
    modelActions: number;
  };
  s6: {
    /** Vague scripted resolutions whose recheck split. */
    catch: Ratio;
    /** Precise scripted resolutions whose recheck was consistent. */
    pass: Ratio;
    /** Rechecks whose stem overlaps the original question less than the lint limit. */
    novel: Ratio;
    maxOverlap: number | null;
  };
  s7: {
    traceable: Ratio;
    /** Splits left open that appear as unresolved record items. */
    unresolvedVisible: Ratio;
    /** Stated or confirmed items that are not a verified quote or a submitted resolution. */
    inferredText: number;
    valid: boolean | null;
  };
}

const CONFIRMED = new Set(["confirmed", "rechecked"]);
const OPEN = new Set(["open", "resolving", "reopened", "unresolved"]);
const INFERRED_RULES = new Set(["stated_quote_verified", "confirmed_text_from_resolution"]);

export function scoreRun(s: Scenario, log: RunLog): ScenarioMetrics {
  const control = s.plantedMismatches.length === 0;
  const extraction = scoreExtraction(s, log.decisions);
  const segments = new Map(log.segments.map((seg) => [seg.id, normalizeQuote(seg.text)]));
  const quotes = log.decisions.flatMap((d) => d.evidence);
  const validQuotes = quotes.filter((e) =>
    (segments.get(e.segmentId) ?? "").includes(normalizeQuote(e.quote)),
  );

  const candidateOf = new Map(
    log.candidates.flatMap((c) => (c.probeId ? [[c.probeId, c] as const] : [])),
  );
  const splitRounds = log.rounds.filter((r) => r.divergence.outcome === "split");
  const hit = new Set(splitRounds.map((r) => candidateOf.get(r.probeId)?.mismatch ?? null));
  const revealed = s.plantedMismatches.filter((m) => hit.has(m.id));
  const onPlanted = splitRounds.filter((r) => candidateOf.get(r.probeId)?.mismatch).length;
  const relevant = log.rounds.filter((r) => candidateOf.get(r.probeId)?.mismatch).length;

  const withAll = log.splits.filter((x) => {
    if (!CONFIRMED.has(x.state.status)) return true;
    const current = x.state.resolutions.at(-1);
    const confirmers = new Set(
      x.state.confirmations
        .filter((c) => c.resolutionId === current?.id)
        .map((c) => c.participantId),
    );
    return x.state.participants
      .filter((p) => p.status === "active")
      .every((p) => confirmers.has(p.id));
  });
  const modelActions = log.splits
    .flatMap((x) => x.events)
    .filter((e) => e.actor?.kind === "model").length;

  const rechecked = log.splits.filter((x) => x.mismatch && x.recheck?.round);
  const outcomes = rechecked.map((x) => x.recheck!.round!.divergence.outcome);
  const vague = log.resolution === "vague";
  const stems = new Map(log.rounds.map((r) => [r.probeId, r.stem]));
  const overlaps = log.splits.flatMap((x) =>
    x.recheck?.probe ? [stemOverlap(x.recheck.probe.stem, stems.get(x.probeId) ?? "")] : [],
  );

  const items = log.record?.items ?? [];
  const open = log.splits.filter((x) => OPEN.has(x.state.status));
  const shownOpen = open.filter((x) =>
    items.some((i) => i.category === "unresolved" && i.splitId === x.splitId),
  );

  return {
    scenario: s.id,
    control,
    s2: {
      precision: ratio(extraction.matched, extraction.extracted),
      recall: ratio(extraction.matched, extraction.expected),
      evidenceValid: ratio(validQuotes.length, quotes.length),
      invented: extraction.invented.length,
    },
    s3: {
      reveal: ratio(revealed.length, s.plantedMismatches.length),
      relevance: control ? ratio(0, 0) : ratio(relevant, log.rounds.length),
      lintPass: ratio(log.candidates.filter((c) => c.probeId).length, log.candidates.length),
    },
    s4: {
      precision: ratio(onPlanted, splitRounds.length),
      recall: ratio(revealed.length, s.plantedMismatches.length),
      falseSplits: control ? splitRounds.length - onPlanted : 0,
      missed: s.plantedMismatches.filter((m) => !hit.has(m.id)).map((m) => m.id),
    },
    s5: { confirmedOnlyWithAll: ratio(withAll.length, log.splits.length), modelActions },
    s6: {
      catch: vague
        ? ratio(outcomes.filter((o) => o === "split").length, outcomes.length)
        : ratio(0, 0),
      pass: vague
        ? ratio(0, 0)
        : ratio(outcomes.filter((o) => o === "consistent").length, outcomes.length),
      novel: ratio(
        overlaps.filter((o) => o < PROBE_LINT_DEFAULTS.maxRecheckOverlap).length,
        overlaps.length,
      ),
      maxOverlap: overlaps.length ? Math.max(...overlaps) : null,
    },
    s7: {
      traceable: ratio(items.filter((i) => i.sourceRefs.length > 0).length, items.length),
      unresolvedVisible: ratio(shownOpen.length, open.length),
      inferredText: (log.validation?.findings ?? []).filter((f) => INFERRED_RULES.has(f.rule))
        .length,
      valid: log.validation?.ok ?? null,
    },
  };
}

export interface StageCost {
  stage: string;
  calls: number;
  failed: number;
  p50Ms: number | null;
  p95Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Calls whose first answer parsed, over calls that report it (repairing providers only). */
  validFirstTry: Ratio;
}

/** Nearest-rank percentile, so every reported latency is one that was measured. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/** Latency and cost per stage. Cache hits are left out of latency: they measure the disk. */
export function stageCosts(calls: ModelCallEntry[]): StageCost[] {
  const byStage = new Map<string, ModelCallEntry[]>();
  for (const c of calls) byStage.set(c.stage, [...(byStage.get(c.stage) ?? []), c]);
  return [...byStage].map(([stage, cs]) => {
    const live = cs.filter((c) => !c.cacheHit).map((c) => c.latencyMs);
    const reported = cs.filter((c) => c.validFirstTry !== undefined);
    return {
      stage,
      calls: cs.length,
      failed: cs.filter((c) => !c.ok).length,
      p50Ms: percentile(live, 50),
      p95Ms: percentile(live, 95),
      inputTokens: cs.reduce((t, c) => t + c.inputTokens, 0),
      outputTokens: cs.reduce((t, c) => t + c.outputTokens, 0),
      costUsd: cs.reduce((t, c) => t + c.costUsd, 0),
      validFirstTry: ratio(reported.filter((c) => c.validFirstTry).length, reported.length),
    };
  });
}

export interface ConditionMetrics {
  /** `provider/source/resolution`, e.g. `meta/paste/precise`. */
  condition: string;
  runIds: string[];
  scenarios: number;
  s2: { precision: Ratio; recall: Ratio; evidenceValid: Ratio; invented: number };
  s3: { reveal: Ratio; relevance: Ratio; lintPass: Ratio };
  s4: { precision: Ratio; recall: Ratio; falseSplits: number; controls: number };
  s5: { confirmedOnlyWithAll: Ratio; modelActions: number };
  s6: { catch: Ratio; pass: Ratio; novel: Ratio };
  s7: { traceable: Ratio; unresolvedVisible: Ratio; inferredText: number; validRecords: Ratio };
  cost: {
    stages: StageCost[];
    totalUsd: number;
    usdPerMeeting: number;
    callsPerMeeting: number;
    /** Calls that ended in an error, e.g. output still invalid after repair. */
    failedCalls: Ratio;
  };
}

export const conditionOf = (log: Pick<RunLog, "provider" | "source" | "resolution">) =>
  `${log.provider}/${log.source}/${log.resolution}`;

/** Sums scenario metrics per condition. Each log is one meeting; repeated runs add up. */
export function aggregate(scenarios: Map<string, Scenario>, logs: RunLog[]): ConditionMetrics[] {
  const groups = new Map<string, RunLog[]>();
  for (const log of logs)
    groups.set(conditionOf(log), [...(groups.get(conditionOf(log)) ?? []), log]);
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([condition, group]) => {
      const scored = group.map((log) => {
        const s = scenarios.get(log.scenario);
        if (!s) throw new Error(`run log for unknown scenario ${log.scenario}`);
        return scoreRun(s, log);
      });
      const sum = (f: (m: ScenarioMetrics) => Ratio) => scored.map(f).reduce(add, ratio(0, 0));
      const count = (f: (m: ScenarioMetrics) => number) => scored.reduce((t, m) => t + f(m), 0);
      const calls = group.flatMap((l) => l.stages.flatMap((st) => st.calls));
      const totalUsd = calls.reduce((t, c) => t + c.costUsd, 0);
      const loops = scored.filter((_, i) => group[i]!.record !== null);
      return {
        condition,
        runIds: [...new Set(group.map((l) => l.runId))].sort(),
        scenarios: group.length,
        s2: {
          precision: sum((m) => m.s2.precision),
          recall: sum((m) => m.s2.recall),
          evidenceValid: sum((m) => m.s2.evidenceValid),
          invented: count((m) => m.s2.invented),
        },
        s3: {
          reveal: sum((m) => m.s3.reveal),
          relevance: sum((m) => m.s3.relevance),
          lintPass: sum((m) => m.s3.lintPass),
        },
        s4: {
          precision: sum((m) => m.s4.precision),
          recall: sum((m) => m.s4.recall),
          falseSplits: count((m) => m.s4.falseSplits),
          controls: scored.filter((m) => m.control).length,
        },
        s5: {
          confirmedOnlyWithAll: sum((m) => m.s5.confirmedOnlyWithAll),
          modelActions: count((m) => m.s5.modelActions),
        },
        s6: {
          catch: sum((m) => m.s6.catch),
          pass: sum((m) => m.s6.pass),
          novel: sum((m) => m.s6.novel),
        },
        s7: {
          traceable: sum((m) => m.s7.traceable),
          unresolvedVisible: sum((m) => m.s7.unresolvedVisible),
          inferredText: count((m) => m.s7.inferredText),
          validRecords: ratio(loops.filter((m) => m.s7.valid).length, loops.length),
        },
        cost: {
          stages: stageCosts(calls),
          totalUsd,
          usdPerMeeting: group.length ? totalUsd / group.length : 0,
          callsPerMeeting: group.length ? calls.length / group.length : 0,
          failedCalls: ratio(calls.filter((c) => !c.ok).length, calls.length),
        },
      };
    });
}

export interface RunLogMeta {
  runId: string;
  run: number;
  provider: RunLog["provider"];
}

/** The log of a full loop: detection, scripted resolutions, rechecks and the record. */
export function runLogFromLoop(meta: RunLogMeta, result: LoopResult): RunLog {
  const { trace } = result;
  return {
    ...meta,
    scenario: trace.scenario,
    source: trace.source,
    resolution: trace.resolution,
    depth: "loop",
    segments: result.segments.map(({ id, text }) => ({ id, text })),
    decisions: result.decisions,
    candidates: trace.candidates.map(({ id, dimension, mismatch, probeId }) => ({
      id,
      dimension,
      mismatch,
      probeId,
    })),
    rounds: trace.rounds,
    splits: trace.splits,
    record: result.record,
    validation: trace.validation,
    stages: trace.stages.map(({ stage, calls }) => ({ stage, calls })),
  };
}

/** The log of the detection half only (S2–S4), as the provider comparison runs it. */
export function runLogFromRounds(
  meta: RunLogMeta,
  scenario: string,
  source: RunLog["source"],
  r: Pick<ProbeRounds, "input" | "decisions" | "candidates" | "rounds" | "stages">,
): RunLog {
  return {
    ...meta,
    scenario,
    source,
    resolution: "precise",
    depth: "detect",
    segments: r.input.segments.map(({ id, text }) => ({ id, text })),
    decisions: r.decisions,
    candidates: r.candidates.map(({ id, dimension, mismatch, probeId }) => ({
      id,
      dimension,
      mismatch,
      probeId,
    })),
    rounds: r.rounds,
    splits: [],
    record: null,
    validation: null,
    stages: r.stages.map(({ stage, calls }) => ({ stage, calls })),
  };
}
