import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { FakeProvider } from "@forkcheck/ai";
import {
  aggregate,
  applyAdoptionRule,
  parseScenario,
  renderReport,
  runLog,
  runLogFromLoop,
  runLoop,
  SINGLE_RATER_NOTE,
  type ConditionMetrics,
  type RunLog,
  type Scenario,
} from "../src/index";

const demo = parseScenario(
  readFileSync(new URL("../../../scenarios/demo/sso-pilot.json", import.meta.url), "utf8"),
);
const scenarios = new Map<string, Scenario>([[demo.id, demo]]);

/** Fixed latency and cost, so the snapshot does not depend on the machine. */
const steady = (log: RunLog, latencyMs: number, costUsd: number): RunLog => ({
  ...log,
  stages: log.stages.map((s) => ({
    ...s,
    // Replayed calls are billed to Muse Spark, as the live run would be.
    calls: s.calls.map((c) => ({
      ...c,
      provider: "meta" as const,
      latencyMs,
      costUsd,
      cacheHit: false,
    })),
  })),
});

/**
 * Fixture runs from the replayed demo loop: two Muse Spark paste runs per resolution, one
 * audio run, and two Spark Open detection runs, one of which repaired its extract call
 * and one that stopped on invalid JSON.
 */
async function fixtureRuns(): Promise<RunLog[]> {
  const loop = async (resolution: "precise" | "vague", runId: string, run: number) =>
    steady(
      runLog.parse(
        JSON.parse(
          JSON.stringify(
            runLogFromLoop(
              { runId, run, provider: "meta" },
              await runLoop(demo, new FakeProvider(), { resolution }),
            ),
          ),
        ),
      ),
      1200 + run * 400,
      0.01,
    );
  const precise = [await loop("precise", "m7-final", 0), await loop("precise", "m7-final", 1)];
  const vague = [await loop("vague", "m7-final", 0), await loop("vague", "m7-final", 1)];
  const audio: RunLog = { ...precise[0]!, source: "audio" };
  const detect = (run: number, validFirstTry: boolean): RunLog => {
    const base = steady(precise[0]!, 2000 + run * 500, 0.012);
    const keep = new Set([
      "extract",
      "findCandidates",
      "generateProbes",
      "critique",
      "simulateAnswer",
    ]);
    return {
      ...base,
      runId: "m7-compare",
      run,
      provider: "baseten",
      depth: "detect",
      splits: [],
      record: null,
      validation: null,
      stages: base.stages
        .filter((s) => keep.has(s.stage))
        .map((s) => ({
          ...s,
          calls: s.calls.map((c) =>
            s.stage === "simulateAnswer"
              ? c
              : {
                  ...c,
                  provider: "baseten" as const,
                  validFirstTry: s.stage !== "extract" || validFirstTry,
                },
          ),
        })),
    };
  };
  const failed: RunLog = {
    ...detect(2, false),
    decisions: [],
    candidates: [],
    rounds: [],
    stages: [
      {
        stage: "extract",
        calls: [
          {
            ...precise[0]!.stages[0]!.calls[0]!,
            provider: "baseten",
            ok: false,
            error: "invalid_output: still invalid after one repair: it is not JSON",
            validFirstTry: false,
            latencyMs: 3000,
            costUsd: 0.02,
          },
        ],
      },
    ],
    error: "invalid_output: still invalid after one repair: it is not JSON",
  };
  return [...precise, ...vague, audio, detect(0, true), detect(1, false), failed];
}

describe("renderReport on fixture runs", () => {
  let conditions: ConditionMetrics[];
  let md: string;
  beforeAll(async () => {
    conditions = aggregate(scenarios, await fixtureRuns());
    const spark = conditions.find((c) => c.condition === "meta/paste/precise")!;
    const open = conditions.find((c) => c.condition === "baseten/paste/precise")!;
    md = renderReport({
      date: "2026-11-02",
      conditions,
      adoption: applyAdoptionRule(spark, open),
      human: [
        {
          condition: "baseten/paste/precise",
          questions: 4,
          clarityMean: 2.5,
          answerabilityMean: 2.25,
          evidence: { supported: 3, of: 4 },
          simulator: { plausible: 0, of: 0 },
        },
        {
          condition: "meta/paste/precise",
          questions: 4,
          clarityMean: 2.75,
          answerabilityMean: 2.5,
          evidence: { supported: 4, of: 4 },
          simulator: { plausible: 9, of: 10 },
        },
      ],
    });
  });

  it("matches the snapshot", async () => {
    await expect(md).toMatchFileSnapshot("__snapshots__/report.md");
  });

  it("names the run ID and log folder of every condition", () => {
    for (const c of conditions) {
      expect(md).toContain(`\`${c.condition}\``);
      for (const id of c.runIds) expect(md).toContain(`eval-results/${id}/logs/`);
    }
  });

  it("keeps paste and audio apart and shows the transcription loss", () => {
    expect(md.indexOf("## Pasted transcripts")).toBeLessThan(md.indexOf("## Audio"));
    expect(md).toContain("Audio − paste");
  });

  it("states the limitations and the single-rater note", () => {
    expect(md).toContain(SINGLE_RATER_NOTE);
    expect(md).toMatch(/Participants are simulated/);
    expect(md).toMatch(/meetings are synthetic/);
  });

  it("applies the adoption rule and counts the failed Spark Open run against it", () => {
    expect(md).toMatch(/S2 Extraction:\*\* does not meet the rule/);
    expect(md).toContain("JSON validity after repair");
    const open = conditions.find((c) => c.condition === "baseten/paste/precise")!;
    expect(open.failedRuns).toEqual({ n: 1, of: 3 });
  });
});
