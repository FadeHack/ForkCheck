import { ScriptedProvider } from "@forkcheck/ai";
import { probe as probeSchema } from "@forkcheck/core";
import { count, eq } from "drizzle-orm";
import { tables } from "@forkcheck/db";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import { GET } from "../../src/app/api/meetings/[id]/route";
import { POST as analyzeRoute } from "../../src/app/api/meetings/[id]/analyze/route";
import type {
  AnalyzeResponse,
  CreateMeetingResponse,
  OrganizerMeetingState,
} from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { call, NOW, useTestDeps } from "./harness";

const transcript = [
  "[00:00] Priya: Where are we on single sign-on for the pilot customer?",
  "[00:06] Marco: Yep, I'll have it ready by Friday.",
  "[00:12] Dana: Then the launch email goes out after that.",
].join("\n");

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

async function newMeeting(): Promise<CreateMeetingResponse> {
  const res = await call(
    createRoute,
    "/api/meetings",
    {},
    {
      method: "POST",
      body: {
        title: "SSO check-in",
        heldAt: "2026-10-26T15:00:00-04:00",
        timezone: "America/New_York",
        participants: ["Priya", "Marco", "Dana"],
        transcript,
      },
    },
  );
  return res.body as CreateMeetingResponse;
}

const impact = { reversibility: "medium", blastRadius: "high", timeToImpact: "high" };

/** A script for one full run; `fail` throws once at that stage before the scripted reply. */
function script(meetingId: string, fail?: "extract" | "findCandidates" | "generateProbes") {
  const seg = (i: number) => `${meetingId}:seg:${i}`;
  const replies = {
    extract: [
      {
        decisions: [
          {
            kind: "commitment",
            statement: "Marco has SSO ready by Friday.",
            ownerText: "Marco",
            deadlineText: "by Friday",
            status: "ambiguous",
            evidence: [{ segmentId: seg(1), quote: "I'll have it ready by Friday." }],
          },
          {
            kind: "decision",
            statement: "The launch email goes out after SSO.",
            ownerText: null,
            deadlineText: null,
            status: "ambiguous",
            evidence: [{ segmentId: seg(2), quote: "the launch email goes out after that" }],
          },
        ],
      },
    ],
    findCandidates: [
      {
        candidates: [
          {
            decisionId: `${meetingId}:dec:1`,
            dimension: "dependency",
            readings: [{ text: "after SSO is live" }, { text: "after SSO is in staging" }],
            impact: { reversibility: "low", blastRadius: "low", timeToImpact: "low" },
          },
          {
            decisionId: `${meetingId}:dec:0`,
            dimension: "outcome",
            readings: [{ text: "admins can log in" }, { text: "every user can log in" }],
            impact,
          },
        ],
      },
    ],
    generateProbes: [
      {
        probes: [
          {
            stem: "What has to be true before the customer email is sent?",
            options: [{ text: "Customers sign in through SSO" }, { text: "SSO works on staging" }],
          },
        ],
      },
      {
        probes: [
          {
            stem: "Who can sign in through SSO once it is called ready?",
            options: [{ text: "Only the customer's admins" }, { text: "Every customer user" }],
          },
        ],
      },
    ],
    critique: [
      { canDiverge: true, leadingOption: null, reason: "Each reading picks its own gate." },
      { canDiverge: true, leadingOption: null, reason: "Each reading names a different group." },
    ],
  };
  if (fail) {
    const queue = replies[fail] as unknown[];
    queue.unshift(() => {
      throw new Error("upstream timeout");
    });
  }
  return new ScriptedProvider(replies);
}

function useModel(model: ScriptedProvider) {
  setDeps(createDeps(deps.db, { now: () => NOW, model: () => model }));
}

const analyze = (m: CreateMeetingResponse) =>
  call(analyzeRoute, "/x", { id: m.meetingId }, { method: "POST", token: m.organizerToken });

async function rows(meetingId: string) {
  const n = async (table: typeof tables.decision | typeof tables.probe) =>
    (await deps.db.select({ n: count() }).from(table).where(eq(table.meetingId, meetingId)))[0]!.n;
  const candidates = await deps.db
    .select({ n: count() })
    .from(tables.candidate)
    .innerJoin(tables.decision, eq(tables.decision.id, tables.candidate.decisionId))
    .where(eq(tables.decision.meetingId, meetingId));
  return {
    decisions: await n(tables.decision),
    candidates: candidates[0]!.n,
    probes: await n(tables.probe),
  };
}

async function meetingOf(m: CreateMeetingResponse) {
  return (
    (await call(GET, "/x", { id: m.meetingId }, { token: m.organizerToken }))
      .body as OrganizerMeetingState
  ).meeting;
}

describe("POST /api/meetings/:id/analyze", () => {
  it("persists decisions, candidates and linted draft probes ranked by impact, then sets probing", async () => {
    const m = await newMeeting();
    const model = script(m.meetingId);
    useModel(model);
    const res = await analyze(m);
    expect(res.status).toBe(200);
    const body = res.body as AnalyzeResponse;
    expect(body.decisions.map((d) => d.decision.statement)).toEqual([
      "Marco has SSO ready by Friday.",
      "The launch email goes out after SSO.",
    ]);
    expect(body.decisions[0]!.evidence[0]).toMatchObject({
      quote: "I'll have it ready by Friday.",
    });
    expect(body.candidates.map((c) => c.dimension)).toEqual(["dependency", "outcome"]);
    // The high-impact outcome probe comes first although it was drafted second.
    expect(body.draftProbes.map((p) => p.stem)).toEqual([
      "Who can sign in through SSO once it is called ready?",
      "What has to be true before the customer email is sent?",
    ]);
    for (const p of body.draftProbes) {
      expect(probeSchema.parse(p)).toEqual(p);
      expect(p).toMatchObject({ status: "draft", lint: [], kind: "diagnostic" });
    }
    expect(await meetingOf(m)).toMatchObject({ status: "probing", error: null });
    expect(await rows(m.meetingId)).toEqual({ decisions: 2, candidates: 2, probes: 2 });
    const state = (await call(GET, "/x", { id: m.meetingId }, { token: m.organizerToken }))
      .body as OrganizerMeetingState;
    expect(state.probes).toEqual(body.draftProbes);
  });

  it("returns the stored analysis on a repeat call without new rows or model calls", async () => {
    const m = await newMeeting();
    const model = script(m.meetingId);
    useModel(model);
    const first = await analyze(m);
    const calls = model.requests.length;
    const again = await analyze(m);
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(model.requests).toHaveLength(calls);
    expect(await rows(m.meetingId)).toEqual({ decisions: 2, candidates: 2, probes: 2 });
  });

  it.each([
    ["extract", "read decisions", { decisions: 0, candidates: 0, probes: 0 }],
    ["findCandidates", "find open details", { decisions: 2, candidates: 0, probes: 0 }],
    ["generateProbes", "draft questions", { decisions: 2, candidates: 2, probes: 0 }],
  ] as const)(
    "a model failure at %s sets failed with that step; a retry resumes and succeeds",
    async (stage, label, kept) => {
      const m = await newMeeting();
      const model = script(m.meetingId, stage);
      useModel(model);
      const failed = await analyze(m);
      expect(failed.status).toBe(502);
      expect(failed.body).toEqual({
        error: {
          code: "analysis_failed",
          message: `Drafting stopped at '${label}'. Retry from that step.`,
        },
      });
      expect(await meetingOf(m)).toMatchObject({ status: "failed" });
      expect(await rows(m.meetingId)).toEqual(kept);

      const extractCalls = () => model.requests.filter((r) => r.stage === "extract").length;
      const before = extractCalls();
      const retry = await analyze(m);
      expect(retry.status).toBe(200);
      expect((retry.body as AnalyzeResponse).draftProbes).toHaveLength(2);
      expect(await meetingOf(m)).toMatchObject({ status: "probing", error: null });
      expect(await rows(m.meetingId)).toEqual({ decisions: 2, candidates: 2, probes: 2 });
      // Finished steps are not run again.
      expect(extractCalls()).toBe(stage === "extract" ? before + 1 : before);
    },
  );

  it("runs once when two calls arrive together", async () => {
    const m = await newMeeting();
    useModel(script(m.meetingId));
    const results = await Promise.all([analyze(m), analyze(m)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.body).toMatchObject({ error: { code: "analysis_running" } });
    expect(await rows(m.meetingId)).toEqual({ decisions: 2, candidates: 2, probes: 2 });
  });

  it("re-analyzes from scratch when the transcript version changed", async () => {
    const m = await newMeeting();
    useModel(script(m.meetingId));
    await analyze(m);
    await deps.db
      .update(tables.meeting)
      .set({ transcriptVersion: 2, status: "draft" })
      .where(eq(tables.meeting.id, m.meetingId));
    const model = script(m.meetingId);
    useModel(model);
    expect((await analyze(m)).status).toBe(200);
    expect(model.requests.filter((r) => r.stage === "extract")).toHaveLength(1);
    expect(await rows(m.meetingId)).toEqual({ decisions: 2, candidates: 2, probes: 2 });
  });

  it("refuses a meeting with no transcript", async () => {
    const res = await call(
      createRoute,
      "/api/meetings",
      {},
      {
        method: "POST",
        body: {
          title: "Audio",
          heldAt: "2026-10-26T15:00:00Z",
          timezone: "UTC",
          participants: ["A", "B"],
        },
      },
    );
    const m = res.body as CreateMeetingResponse;
    expect((await analyze(m)).body).toMatchObject({ error: { code: "no_transcript" } });
  });

  it("refuses to re-analyze once rounds have started", async () => {
    const m = await newMeeting();
    useModel(script(m.meetingId));
    await analyze(m);
    await deps.db
      .update(tables.meeting)
      .set({ transcriptVersion: 2, status: "revealed" })
      .where(eq(tables.meeting.id, m.meetingId));
    const res = await analyze(m);
    expect(res).toMatchObject({ status: 409, body: { error: { code: "analysis_closed" } } });
    expect(await rows(m.meetingId)).toEqual({ decisions: 2, candidates: 2, probes: 2 });
  });

  it("rejects a participant token", async () => {
    const m = await newMeeting();
    const res = await call(
      analyzeRoute,
      "/x",
      { id: m.meetingId },
      {
        method: "POST",
        token: m.participantLinks[0]!.token,
      },
    );
    expect(res.status).toBe(401);
  });
});
