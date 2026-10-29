import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TraceCall, TraceResponse } from "../../src/contracts/api";
import { TraceView } from "../../src/ui/organizer/trace";

const text = (node: React.ReactElement) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

/** A log as the demo run writes it: one live call, one cache hit, one replay, one failure. */
const calls: TraceCall[] = [
  {
    at: "2026-10-29T14:00:01.000Z",
    stage: "extract",
    provider: "meta",
    model: "muse-spark-1.3",
    promptVersion: "extract.v1",
    cacheHit: false,
    latencyMs: 3120,
    inputTokens: 2410,
    outputTokens: 655,
    reasoningTokens: 140,
    costUsd: 0.0042,
    ok: true,
    error: null,
  },
  {
    at: "2026-10-29T14:00:05.000Z",
    stage: "generateProbes",
    provider: "meta",
    model: "muse-spark-1.3",
    promptVersion: "probes.v1",
    cacheHit: true,
    latencyMs: 4,
    inputTokens: 1830,
    outputTokens: 412,
    reasoningTokens: null,
    costUsd: 0,
    ok: true,
    error: null,
  },
  {
    at: "2026-10-29T14:00:06.000Z",
    stage: "critique",
    provider: "fake",
    model: "muse-spark-1.3",
    promptVersion: "critique.v1",
    cacheHit: false,
    latencyMs: 0,
    inputTokens: 900,
    outputTokens: 120,
    reasoningTokens: null,
    costUsd: 0,
    ok: true,
    error: null,
  },
  {
    at: "2026-10-29T14:00:09.000Z",
    stage: "mapWriteIn",
    provider: "meta",
    model: "muse-spark-1.3",
    promptVersion: "mapWriteIn.v1",
    cacheHit: false,
    latencyMs: 30000,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: null,
    costUsd: 0,
    ok: false,
    error: "timeout",
  },
];

describe("TraceView", () => {
  it("shows each call's stage, provider, model, time, tokens, cost and source", () => {
    const out = text(<TraceView data={{ calls, computed: null }} />);
    expect(out).toContain("4 calls, $0.0042 in total, 1 failed.");
    expect(out).toContain(
      "Find decisions extract.v1 meta muse-spark-1.3 Live 3,120 ms 2,410 in, 655 out, 140 reasoning $0.0042",
    );
    expect(out).toContain("Draft questions probes.v1 meta muse-spark-1.3 Cache 4 ms");
    // A replay has no real time or cost, so it says so instead of showing 0 ms.
    expect(out).toContain("Check drafted questions critique.v1 muse-spark-1.3 Replay Not timed");
    expect(out).toContain("Replayed calls reuse a recorded reply");
    expect(out).toContain("Failed: timeout");
  });

  it("says nothing was computed from answers before a reveal", () => {
    const out = text(<TraceView data={{ calls: [], computed: null }} />);
    expect(out).toContain("No model calls are logged for this meeting yet.");
    expect(out).toContain("Computed by code, not the model");
    expect(out).toContain("Nothing yet. Code compares the answers once a round closes.");
  });

  it("lists splits, confirmations and record categories as computed by code", () => {
    const data: TraceResponse = {
      calls,
      computed: {
        questions: { split: 1, consistent: 3, insufficient: 1 },
        confirmations: 2,
        record: { confirmed: 1, unresolved: 0, stated: 2 },
      },
    };
    const out = text(<TraceView data={data} />);
    expect(out).toContain(
      "Which questions got different answers: 1 with different answers, 3 with the same answer, 1 with too few answers.",
    );
    expect(out).toContain("Who confirmed which wording: 2 confirmations.");
    expect(out).toContain(
      "Where each record item goes: 1 confirmed, 0 unresolved, 2 stated in the meeting.",
    );
  });
});
