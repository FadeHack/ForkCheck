import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FakeProvider } from "@forkcheck/ai";
import {
  aggregate,
  parseScenario,
  percentile,
  rate,
  runLog,
  runLogFromLoop,
  runLoop,
  scoreRun,
  stageCosts,
  type ModelCallEntry,
  type RunLog,
} from "../src/index";

const load = (path: string) =>
  parseScenario(readFileSync(new URL(`../../../scenarios/${path}`, import.meta.url), "utf8"));
const friday = load("dev/deadline-next-friday.json");
const control = load("dev/aligned-key-rotation.json");

const call = (over: Partial<ModelCallEntry> = {}): ModelCallEntry => ({
  stage: "extract",
  provider: "meta",
  model: "m",
  promptVersion: "extract.v1",
  cacheHit: false,
  latencyMs: 1000,
  inputTokens: 100,
  outputTokens: 10,
  reasoningTokens: null,
  costUsd: 0.01,
  ok: true,
  error: null,
  ...over,
});

const decision = (id: string, idx: number, statement: string) => ({
  id,
  meetingId: friday.id,
  idx,
  kind: "commitment" as const,
  statement,
  ownerText: null,
  deadlineText: null,
  ownerInferred: false,
  deadlineInferred: false,
  status: "ambiguous" as const,
});
const quote = (id: string, decisionId: string, segmentId: string, text: string) => ({
  id,
  decisionId,
  resolutionId: null,
  segmentId,
  quote: text,
});
const participants = friday.participants.map((id) => ({ id, status: "active" }));

/**
 * One hand-built run with known answers: 2 decisions (1 expected), 2 quotes (1 valid),
 * 3 candidates (2 published), 2 split rounds (1 on the planted mismatch), one split
 * confirmed by all then reopened by its recheck, one left open and shown as unresolved.
 */
function fridayLog(over: Partial<RunLog> = {}): RunLog {
  return {
    runId: "t-1",
    run: 0,
    scenario: friday.id,
    provider: "meta",
    source: "paste",
    resolution: "vague",
    depth: "loop",
    segments: [
      { id: "s1", text: "Next Friday is fine. I can block out time for it." },
      { id: "s2", text: "I'll pass them to Kwame to merge in." },
    ],
    decisions: [
      {
        decision: decision("d1", 0, "Questionnaire back next Friday"),
        evidence: [quote("e1", "d1", "s1", "Next Friday is fine.")],
      },
      {
        decision: decision("d2", 1, "Lena's handover"),
        evidence: [quote("e2", "d2", "s2", "I will pass them along")],
      },
    ],
    candidates: [
      { id: "c1", dimension: "deadline", mismatch: "which-friday", probeId: "p1" },
      { id: "c2", dimension: "owner", mismatch: null, probeId: "p2" },
      { id: "c3", dimension: "scope", mismatch: null, probeId: null },
    ],
    rounds: [
      {
        probeId: "p1",
        stem: "Which Friday is the questionnaire due?",
        divergence: { outcome: "split" },
      },
      { probeId: "p2", stem: "Who merges the sections?", divergence: { outcome: "split" } },
    ],
    splits: [
      {
        splitId: "p1:split",
        probeId: "p1",
        mismatch: "which-friday",
        events: [
          { type: "propose", actor: { kind: "participant" } },
          ...participants.map(() => ({ type: "confirm", actor: { kind: "participant" as const } })),
          { type: "recheck" },
        ],
        recheck: {
          probe: { stem: "If procurement emails on the 31st, is the questionnaire late?" },
          round: {
            probeId: "r1",
            stem: "If procurement emails on the 31st, is the questionnaire late?",
            divergence: { outcome: "split" },
          },
        },
        state: {
          status: "reopened",
          participants,
          resolutions: [{ id: "res0", status: "confirmed" }],
          confirmations: participants.map((p) => ({ resolutionId: "res0", participantId: p.id })),
        },
      },
      {
        splitId: "p2:split",
        probeId: "p2",
        mismatch: null,
        events: [],
        recheck: null,
        state: { status: "open", participants, resolutions: [], confirmations: [] },
      },
    ],
    record: {
      meetingId: friday.id,
      title: friday.title,
      heldAt: friday.heldAt,
      generatedAt: friday.heldAt,
      participants: [],
      items: [
        {
          id: "i1",
          meetingId: friday.id,
          category: "stated",
          text: "Next Friday is fine.",
          sourceRefs: [
            { kind: "segment", segmentId: "s1", quote: "Next Friday is fine.", origin: "paste" },
          ],
          confirmedBy: [],
          absent: [],
          recheck: "not_run",
          splitId: null,
          deadline: null,
        },
        {
          id: "i2",
          meetingId: friday.id,
          category: "unresolved",
          text: "Who merges the sections",
          sourceRefs: [],
          confirmedBy: [],
          absent: [],
          recheck: "not_run",
          splitId: "p2:split",
          deadline: null,
        },
      ],
      proseDraft: null,
    },
    validation: {
      ok: false,
      findings: [{ rule: "source_required", itemId: "i2", detail: "no quote or confirmation" }],
    },
    stages: [
      { stage: "extract", calls: [call({ latencyMs: 2000, costUsd: 0.02 })] },
      {
        stage: "simulate",
        calls: [
          call({ stage: "simulate", latencyMs: 100 }),
          call({ stage: "simulate", latencyMs: 300 }),
          call({ stage: "simulate", latencyMs: 200, cacheHit: true }),
        ],
      },
    ],
    ...over,
  };
}

describe("scoreRun on a hand-built trace", () => {
  const m = scoreRun(friday, runLog.parse(fridayLog()));

  it("S2: precision and recall by quote match, evidence validity by substring", () => {
    expect(m.s2.precision).toEqual({ n: 1, of: 2 });
    expect(m.s2.recall).toEqual({ n: 1, of: friday.expectedDecisions.length });
    expect(m.s2.evidenceValid).toEqual({ n: 1, of: 2 });
    expect(m.s2.invented).toBe(0);
  });

  it("S3: reveal, relevance of asked probes, and lint pass", () => {
    expect(m.s3.reveal).toEqual({ n: 1, of: 1 });
    expect(m.s3.relevance).toEqual({ n: 1, of: 2 });
    expect(m.s3.lintPass).toEqual({ n: 2, of: 3 });
  });

  it("S4: one of two splits lands on the plant; nothing missed", () => {
    expect(m.s4.precision).toEqual({ n: 1, of: 2 });
    expect(m.s4.recall).toEqual({ n: 1, of: 1 });
    expect(m.s4.missed).toEqual([]);
    expect(m.s4.falseSplits).toBe(0);
  });

  it("S5: confirmation needs every active participant; models never act", () => {
    expect(m.s5).toEqual({ confirmedOnlyWithAll: { n: 2, of: 2 }, modelActions: 0 });
    const short = fridayLog();
    short.splits[0]!.state.status = "confirmed";
    short.splits[0]!.state.confirmations.pop();
    short.splits[1]!.events.push({ type: "propose", actor: { kind: "model" } });
    expect(scoreRun(friday, short).s5).toEqual({
      confirmedOnlyWithAll: { n: 1, of: 2 },
      modelActions: 1,
    });
  });

  it("S6: a vague resolution that splits on recheck is caught; novelty by stem overlap", () => {
    expect(m.s6.catch).toEqual({ n: 1, of: 1 });
    expect(m.s6.pass).toEqual({ n: 0, of: 0 });
    expect(m.s6.novel).toEqual({ n: 1, of: 1 });
    const precise = scoreRun(friday, fridayLog({ resolution: "precise" }));
    expect(precise.s6.pass).toEqual({ n: 0, of: 1 });
    expect(precise.s6.catch).toEqual({ n: 0, of: 0 });
  });

  it("S7: traceability, open splits shown as unresolved, inferred text", () => {
    // The split reopened by its failed recheck is open too, and the record leaves it out.
    expect(m.s7).toEqual({
      traceable: { n: 1, of: 2 },
      unresolvedVisible: { n: 1, of: 2 },
      inferredText: 0,
      valid: false,
    });
    const inferred = fridayLog({
      validation: {
        ok: false,
        findings: [{ rule: "stated_quote_verified", itemId: "i1", detail: "" }],
      },
    });
    expect(scoreRun(friday, inferred).s7.inferredText).toBe(1);
  });

  it("counts splits in a control scenario as false splits", () => {
    const log = fridayLog({ scenario: control.id, candidates: [], splits: [] });
    const c = scoreRun(control, log);
    expect(c.control).toBe(true);
    expect(c.s4.falseSplits).toBe(2);
    expect(c.s3.relevance).toEqual({ n: 0, of: 0 });
  });
});

describe("latency and cost", () => {
  it("nearest-rank percentiles return measured values", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([7], 95)).toBe(7);
  });

  it("per stage, leaving cache hits out of latency", () => {
    const [extract, simulate] = stageCosts(fridayLog().stages.flatMap((s) => s.calls));
    expect(extract).toMatchObject({ stage: "extract", calls: 1, p50Ms: 2000, costUsd: 0.02 });
    expect(simulate).toMatchObject({ stage: "simulate", calls: 3, p50Ms: 100, p95Ms: 300 });
    expect(simulate!.costUsd).toBeCloseTo(0.03);
  });

  it("reports first-try JSON validity only for providers that log it", () => {
    const [s] = stageCosts([call({ validFirstTry: true }), call({ validFirstTry: false }), call()]);
    expect(s!.validFirstTry).toEqual({ n: 1, of: 2 });
  });
});

describe("aggregate", () => {
  it("sums runs per condition and keeps their run IDs", () => {
    const logs = [
      fridayLog(),
      fridayLog({ runId: "t-2", run: 1 }),
      fridayLog({ resolution: "precise" }),
    ];
    const scenarios = new Map([[friday.id, friday]]);
    const [precise, vague] = aggregate(scenarios, logs);
    expect(precise!.condition).toBe("meta/paste/precise");
    expect(vague!.condition).toBe("meta/paste/vague");
    expect(vague!.runIds).toEqual(["t-1", "t-2"]);
    expect(vague!.s3.reveal).toEqual({ n: 2, of: 2 });
    expect(vague!.s6.catch).toEqual({ n: 2, of: 2 });
    expect(vague!.s7.validRecords).toEqual({ n: 0, of: 2 });
    expect(vague!.cost.totalUsd).toBeCloseTo(0.1);
    expect(vague!.cost.usdPerMeeting).toBeCloseTo(0.05);
    expect(vague!.cost.callsPerMeeting).toBe(4);
    expect(rate(vague!.s2.evidenceValid)).toBe(0.5);
  });

  it("rejects a log for a scenario it does not know", () => {
    expect(() => aggregate(new Map(), [fridayLog()])).toThrow(/unknown scenario/);
  });
});

describe("run logs from the replayed demo loop", () => {
  it("parse back from JSON and score the known demo outcome", async () => {
    const demo = load("demo/sso-pilot.json");
    const result = await runLoop(demo, new FakeProvider(), { resolution: "precise" });
    const log = runLog.parse(
      JSON.parse(
        JSON.stringify(runLogFromLoop({ runId: "demo", run: 0, provider: "fake" }, result)),
      ),
    );
    const m = scoreRun(demo, log);
    expect(m.s3.reveal).toEqual({ n: 2, of: 2 });
    expect(m.s5).toEqual({ confirmedOnlyWithAll: { n: 2, of: 2 }, modelActions: 0 });
    expect(m.s6.pass).toEqual({ n: 1, of: 1 });
    expect(m.s7).toMatchObject({
      unresolvedVisible: { n: 1, of: 1 },
      inferredText: 0,
      valid: true,
    });
    expect(m.s7.traceable.n).toBe(m.s7.traceable.of);
  });
});
