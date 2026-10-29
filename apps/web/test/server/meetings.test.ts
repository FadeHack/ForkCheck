import { meeting as meetingSchema, participant, segment } from "@forkcheck/core";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import { DELETE, GET } from "../../src/app/api/meetings/[id]/route";
import { PATCH } from "../../src/app/api/meetings/[id]/participants/[pid]/route";
import type { CreateMeetingResponse, OrganizerMeetingState } from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { tables } from "@forkcheck/db";
import { newToken } from "../../src/server/tokens";
import { call, NOW, seedMeeting, useTestDeps } from "./harness";

const transcript = [
  "[00:05] Priya: We ship SSO on Friday.",
  "Marco: Fine, I'll own the rollout.",
  "It needs the staging tenant first.",
].join("\n");

const body = {
  title: "SSO sync",
  heldAt: "2026-10-26T15:00:00-04:00",
  timezone: "America/New_York",
  participants: ["Priya", "Marco", "Dana"],
  transcript,
};

const create = (b: unknown = body) =>
  call(createRoute, "/api/meetings", {}, { method: "POST", body: b });

let deps: Deps;
beforeAll(async () => {
  deps = await useTestDeps();
});

async function created(): Promise<CreateMeetingResponse> {
  const res = await create();
  expect(res.status).toBe(201);
  return res.body as CreateMeetingResponse;
}

describe("POST /api/meetings", () => {
  it("parses the transcript into segments and returns one link per participant", async () => {
    const res = await created();
    expect(res.organizerToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.participantLinks.map((l) => l.displayName)).toEqual(["Priya", "Marco", "Dana"]);
    for (const link of res.participantLinks) {
      expect(link.url).toBe(`http://localhost/p/${link.token}`);
    }
    expect(new Set(res.participantLinks.map((l) => l.token)).size).toBe(3);

    const state = await call(
      GET,
      `/api/meetings/${res.meetingId}`,
      { id: res.meetingId },
      {
        token: res.organizerToken,
      },
    );
    const s = state.body as OrganizerMeetingState;
    expect(s.meeting).toMatchObject({
      title: "SSO sync",
      source: "paste",
      status: "draft",
      heldAt: "2026-10-26T19:00:00.000Z",
      transcriptVersion: 1,
      createdAt: NOW.toISOString(),
    });
    expect(s.segments.map((x) => [x.text, x.participantId, x.startMs])).toEqual([
      ["We ship SSO on Friday.", `${res.meetingId}:p:0`, 5000],
      [
        "Fine, I'll own the rollout.\nIt needs the staging tenant first.",
        `${res.meetingId}:p:1`,
        null,
      ],
    ]);
  });

  it("creates an audio meeting with no segments when the transcript is omitted", async () => {
    const { transcript: _t, ...audio } = body;
    const res = (await create(audio)).body as CreateMeetingResponse;
    const s = (await call(GET, "/x", { id: res.meetingId }, { token: res.organizerToken }))
      .body as OrganizerMeetingState;
    expect(s.meeting).toMatchObject({ source: "audio", transcriptVersion: 0 });
    expect(s.segments).toEqual([]);
  });

  it("marks simulated participants and keeps their notes out of every response", async () => {
    const notes = "Pilot runs on staging until the 6th.";
    const res = await create({
      ...body,
      participants: ["Priya", { name: "Sim Marco", simulated: true, notes }],
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain(notes);
    const { meetingId, organizerToken } = res.body as CreateMeetingResponse;
    const state = await call(GET, "/x", { id: meetingId }, { token: organizerToken });
    expect(JSON.stringify(state.body)).not.toContain(notes);
    expect(
      (state.body as OrganizerMeetingState).participants.map((p) => [p.displayName, p.isSimulated]),
    ).toEqual([
      ["Priya", false],
      ["Sim Marco", true],
    ]);
    expect(await deps.meetings.simulatorNotes(meetingId)).toEqual(
      new Map([[`${meetingId}:p:1`, notes]]),
    );
  });

  it("stores only token hashes", async () => {
    const res = await created();
    const rows = await deps.db.select().from(tables.participant);
    const meetings = await deps.db.select().from(tables.meeting);
    const stored = JSON.stringify([rows, meetings]);
    expect(stored).not.toContain(res.organizerToken);
    for (const link of res.participantLinks) expect(stored).not.toContain(link.token);
  });

  it.each([
    [{ ...body, title: " " }, ["title"]],
    [{ ...body, participants: ["Solo"] }, ["participants"]],
    [{ ...body, participants: ["Priya", ""] }, ["participants.1"]],
    [{ ...body, participants: ["Priya", { name: "Sim", simulated: true }] }, ["participants.1"]],
    [{ ...body, heldAt: "Friday" }, ["heldAt"]],
    [{ ...body, extra: true }, [""]],
    [{ title: "x" }, ["heldAt", "timezone", "participants"]],
  ])("rejects an invalid body with field errors (%#)", async (bad, fields) => {
    const res = await create(bad);
    expect(res.status).toBe(400);
    const error = (res.body as { error: { code: string; fields: Record<string, string[]> } }).error;
    expect(error.code).toBe("invalid_body");
    expect(Object.keys(error.fields).sort()).toEqual([...fields].sort());
  });

  it("rejects a body that is not JSON", async () => {
    const req = new Request("http://localhost/api/meetings", { method: "POST", body: "{" });
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/meetings/:id", () => {
  it("returns organizer state that matches the domain schemas", async () => {
    const res = await created();
    const s = (await call(GET, "/x", { id: res.meetingId }, { token: res.organizerToken }))
      .body as OrganizerMeetingState;
    expect(meetingSchema.parse(s.meeting)).toEqual(s.meeting);
    for (const p of s.participants) expect(participant.parse(p)).toEqual(p);
    for (const x of s.segments) expect(segment.parse(x)).toEqual(x);
    expect(s).toMatchObject({
      decisions: [],
      candidates: [],
      probes: [],
      rounds: [],
      answerCounts: [],
      revealedAnswers: [],
      splits: [],
      resolutions: [],
      confirmations: [],
    });
  });
});

describe("PATCH /api/meetings/:id/participants/:pid", () => {
  it("marks a participant absent and back", async () => {
    const res = await created();
    const pid = res.participantLinks[2]!.participantId;
    const patch = (status: unknown) =>
      call(
        PATCH,
        "/x",
        { id: res.meetingId, pid },
        {
          method: "PATCH",
          token: res.organizerToken,
          body: { status },
        },
      );
    const absent = await patch("absent");
    expect(absent.status).toBe(200);
    expect(participant.parse(absent.body)).toMatchObject({ id: pid, status: "absent" });
    expect((await patch("active")).body).toMatchObject({ status: "active" });
    expect((await patch("gone")).status).toBe(400);
  });

  it("returns 404 for a participant of another meeting", async () => {
    const a = await created();
    const b = await created();
    const res = await call(
      PATCH,
      "/x",
      { id: a.meetingId, pid: b.participantLinks[0]!.participantId },
      { method: "PATCH", token: a.organizerToken, body: { status: "absent" } },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/meetings/:id", () => {
  it("removes the meeting, its rows and its stored audio", async () => {
    const deleted: string[] = [];
    setDeps(
      createDeps(deps.db, {
        now: () => NOW,
        storage: { delete: async (key) => void deleted.push(key) },
      }),
    );
    const res = await created();
    await deps.db.insert(tables.audioAsset).values([
      { id: `${res.meetingId}:audio:0`, meetingId: res.meetingId, storageKey: "kept.wav" },
      {
        id: `${res.meetingId}:audio:1`,
        meetingId: res.meetingId,
        storageKey: "gone.wav",
        deletedAt: NOW,
      },
    ]);
    const del = await call(
      DELETE,
      "/x",
      { id: res.meetingId },
      {
        method: "DELETE",
        token: res.organizerToken,
      },
    );
    expect(del).toMatchObject({ status: 204, body: null });
    expect(deleted).toEqual(["kept.wav"]);
    expect(await deps.meetings.get(res.meetingId)).toBeNull();
    expect(await deps.meetings.participants(res.meetingId)).toEqual([]);
    expect(await deps.meetings.segments(res.meetingId)).toEqual([]);
    // The token no longer opens anything.
    const after = await call(GET, "/x", { id: res.meetingId }, { token: res.organizerToken });
    expect(after.status).toBe(401);
  });
});

describe("protected meeting routes", () => {
  const routes = [
    ["GET /api/meetings/:id", GET, "GET", undefined],
    ["DELETE /api/meetings/:id", DELETE, "DELETE", undefined],
    ["PATCH /api/meetings/:id/participants/:pid", PATCH, "PATCH", { status: "absent" }],
  ] as const;

  for (const [name, route, method, payload] of routes) {
    it.each([
      ["a missing token", (_m: Awaited<ReturnType<typeof seedMeeting>>) => undefined],
      ["a wrong token", () => newToken()],
      [
        "a participant token",
        (m: Awaited<ReturnType<typeof seedMeeting>>) => m.participants[0]!.token,
      ],
    ])(`${name} rejects %s with 401 and changes nothing`, async (_label, tokenOf) => {
      const m = await seedMeeting(deps, `prot-${Math.random().toString(36).slice(2)}`);
      const token = tokenOf(m);
      const res = await call(
        route as Parameters<typeof call>[0],
        "/x",
        { id: m.meeting.id, pid: m.participants[0]!.participant.id },
        {
          method,
          ...(token === undefined ? {} : { token }),
          ...(payload ? { body: payload } : {}),
        },
      );
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
      expect(await deps.meetings.get(m.meeting.id)).not.toBeNull();
      expect((await deps.meetings.participants(m.meeting.id)).map((p) => p.status)).toEqual([
        "active",
        "active",
      ]);
    });
  }
});
