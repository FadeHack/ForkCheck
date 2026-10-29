import { DbCallLog } from "@forkcheck/db";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as traceRoute } from "../../src/app/api/meetings/[id]/trace/route";
import type { TraceCall, TraceResponse } from "../../src/contracts/api";
import type { Deps } from "../../src/server/deps";
import { call, seedDrafts, seedRevealed, useTestDeps } from "./harness";

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

const live: Omit<TraceCall, "at"> = {
  stage: "generateProbes",
  provider: "meta",
  model: "muse-spark-1.3",
  promptVersion: "probes.v1",
  cacheHit: false,
  latencyMs: 2140,
  inputTokens: 1830,
  outputTokens: 412,
  reasoningTokens: 96,
  costUsd: 0.00271,
  ok: true,
  error: null,
};

describe("GET /api/meetings/:id/trace", () => {
  it("lists the meeting's logged calls in order and nothing from other meetings", async () => {
    const m = await seedDrafts(deps, "trace-calls");
    const other = await seedDrafts(deps, "trace-other");
    const log = new DbCallLog(deps.db, { meetingId: m.meeting.id });
    await log.write({ ...live, at: "2026-10-27T20:00:02.000Z" });
    await log.write({ ...live, stage: "extract", at: "2026-10-27T20:00:01.000Z" });
    await new DbCallLog(deps.db, { meetingId: other.meeting.id }).write({
      ...live,
      at: "2026-10-27T20:00:03.000Z",
    });

    const res = await call(traceRoute, "/x", { id: m.meeting.id }, { token: m.organizerToken });
    expect(res.status).toBe(200);
    const body = res.body as TraceResponse;
    expect(body.calls).toEqual([
      { ...live, stage: "extract", at: "2026-10-27T20:00:01.000Z" },
      { ...live, at: "2026-10-27T20:00:02.000Z" },
    ]);
    // Before any round closes there is nothing computed from answers to show.
    expect(body.computed).toBeNull();
  });

  it("counts what code computed once a round is revealed", async () => {
    const m = await seedRevealed(deps, "trace-revealed");
    const body = (await call(traceRoute, "/x", { id: m.meeting.id }, { token: m.organizerToken }))
      .body as TraceResponse;
    expect(body.computed).toEqual({
      questions: { split: 1, consistent: 0, insufficient: 0 },
      confirmations: 0,
      record: expect.objectContaining({ confirmed: 0, unresolved: 1 }),
    });
  });

  it("answers 401 to a participant's token", async () => {
    const m = await seedRevealed(deps, "trace-auth");
    const res = await call(
      traceRoute,
      "/x",
      { id: m.meeting.id },
      { token: m.participants[0]!.token },
    );
    expect(res.status).toBe(401);
  });
});
