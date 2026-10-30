import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedProvider } from "@forkcheck/ai";
import { tables } from "@forkcheck/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as analyzeRoute } from "../../src/app/api/meetings/[id]/analyze/route";
import { GET as audioRoute } from "../../src/app/api/meetings/[id]/audio/route";
import { POST as reviewRoute } from "../../src/app/api/meetings/[id]/review/route";
import { GET as recordRoute } from "../../src/app/api/meetings/[id]/record/route";
import { GET as getRoute } from "../../src/app/api/meetings/[id]/route";
import { GET as participantRecordRoute } from "../../src/app/api/p/[token]/record/route";
import { PUT as speakersRoute } from "../../src/app/api/meetings/[id]/speakers/route";
import { PATCH as segmentRoute } from "../../src/app/api/segments/[id]/route";
import type { OrganizerMeetingState, RecordResponse } from "../../src/contracts/api";
import { createDeps, setDeps, type Deps } from "../../src/server/deps";
import { LocalDiskStorage } from "../../src/server/storage";
import { call, NOW, seedMeeting, seedTranscribed, useTestDeps, type SeedTurn } from "./harness";

let deps: Deps;
let storage: LocalDiskStorage;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forkcheck-review-test-"));
  storage = new LocalDiskStorage(root);
  deps = await useTestDeps({ storage });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const turns: SeedTurn[] = [
  ["A", 0, 4000, "We ship SSO on Friday."],
  ["B", 4200, 6000, "I'll own the roll out."],
  ["A", 6100, 9000, "Staging first."],
];

type M = {
  meeting: { id: string };
  organizerToken: string;
  storageKey: string;
  participants: { token: string }[];
};

/** A transcribed meeting with A mapped to Ana and B to Ben, and its file in storage. */
async function reviewing(id: string): Promise<M> {
  const m = await seedTranscribed(deps, id, turns);
  await storage.put(m.storageKey, new Blob(["RIFF"]).stream(), { maxBytes: 100 });
  await call(
    speakersRoute,
    "/x",
    { id },
    {
      method: "PUT",
      token: m.organizerToken,
      body: { mapping: { A: `${id}:p:0`, B: `${id}:p:1` } },
    },
  );
  return m;
}

const edit = (m: M, idx: number, body: unknown) =>
  call(
    segmentRoute,
    "/x",
    { id: `${m.meeting.id}:seg:${idx}` },
    { method: "PATCH", token: m.organizerToken, body },
  );

const finish = (m: M, keepAudio: boolean) =>
  call(
    reviewRoute,
    "/x",
    { id: m.meeting.id },
    { method: "POST", token: m.organizerToken, body: { keepAudio } },
  );

const state = async (m: M) =>
  (await call(getRoute, "/x", { id: m.meeting.id }, { token: m.organizerToken }))
    .body as OrganizerMeetingState;

const audio = (m: M) => call(audioRoute, "/x", { id: m.meeting.id }, { token: m.organizerToken });

describe("PATCH /api/segments/:id", () => {
  it("logs the before and after of each changed field and bumps the transcript version", async () => {
    const m = await reviewing("rv-1");
    const res = await edit(m, 1, { text: "  I'll own the rollout. ", participantId: "rv-1:p:0" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      text: "I'll own the rollout.",
      participantId: "rv-1:p:0",
      edited: true,
      origin: "asr",
    });

    const s = await state(m);
    expect(s.meeting.transcriptVersion).toBe(2);
    expect(s.edits).toHaveLength(2);
    expect(s.edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segmentId: "rv-1:seg:1",
          field: "text",
          before: "I'll own the roll out.",
          after: "I'll own the rollout.",
          at: NOW.toISOString(),
        }),
        expect.objectContaining({ field: "participantId", before: "rv-1:p:1", after: "rv-1:p:0" }),
      ]),
    );
  });

  it("writes nothing when the words and speaker are unchanged", async () => {
    const m = await reviewing("rv-2");
    expect((await edit(m, 0, { text: "We ship SSO on Friday." })).status).toBe(200);
    const s = await state(m);
    expect(s.meeting.transcriptVersion).toBe(1);
    expect(s.edits).toEqual([]);
    expect(s.segments[0]!.edited).toBe(false);
  });

  it("refuses empty words, a foreign participant and an unknown turn", async () => {
    const m = await reviewing("rv-3");
    expect((await edit(m, 0, { text: "   " })).body).toMatchObject({
      error: { code: "empty_text" },
    });
    expect((await edit(m, 0, { participantId: "other:p:0" })).body).toMatchObject({
      error: { code: "unknown_participant" },
    });
    expect((await edit(m, 9, { text: "x" })).status).toBe(401);
    const other = await reviewing("rv-3b");
    const foreign = await call(
      segmentRoute,
      "/x",
      { id: "rv-3:seg:0" },
      { method: "PATCH", token: other.organizerToken, body: { text: "x" } },
    );
    expect(foreign.status).toBe(401);
  });

  it("marks a turn as unknown and keeps a one-off reassignment when speakers are mapped again", async () => {
    const m = await reviewing("rv-4");
    await edit(m, 0, { participantId: null });
    await edit(m, 2, { participantId: "rv-4:p:1" });
    await call(
      speakersRoute,
      "/x",
      { id: "rv-4" },
      { method: "PUT", token: m.organizerToken, body: { mapping: { A: "rv-4:p:0", B: null } } },
    );
    const s = await state(m);
    expect(s.segments.map((x) => x.participantId)).toEqual([null, null, "rv-4:p:1"]);
  });

  it("is closed for pasted transcripts and once questions are drafted", async () => {
    const paste = await seedMeeting(deps, "rv-5", ["Ana"], { status: "review" });
    await deps.db.insert(tables.segment).values({
      id: "rv-5:seg:0",
      meetingId: "rv-5",
      idx: 0,
      text: "Hello.",
      origin: "paste",
    });
    const pasted = await call(
      segmentRoute,
      "/x",
      { id: "rv-5:seg:0" },
      { method: "PATCH", token: paste.organizerToken, body: { text: "Hi." } },
    );
    expect(pasted.body).toMatchObject({ error: { code: "not_audio" } });

    const m = await reviewing("rv-6");
    await deps.meetings.setStatus("rv-6", "probing");
    expect((await edit(m, 0, { text: "x" })).body).toMatchObject({
      error: { code: "wrong_status" },
    });
  });

  it("makes analysis of the earlier version stale, so finishing review drafts again", async () => {
    const m = await reviewing("rv-7");
    // Mark a finished analysis of version 1, as if questions had been drafted before the edit.
    await deps.db
      .update(tables.meeting)
      .set({ analysisVersion: 1, analysisStep: "probes" })
      .where(eq(tables.meeting.id, "rv-7"));
    const analyze = () =>
      call(analyzeRoute, "/x", { id: "rv-7" }, { method: "POST", token: m.organizerToken });

    const before = new ScriptedProvider({});
    setDeps(createDeps(deps.db, { now: () => NOW, storage, model: () => before }));
    expect((await analyze()).status).toBe(200);
    expect(before.requests).toHaveLength(0);

    await edit(m, 0, { text: "We ship SSO on Monday." });
    const after = new ScriptedProvider({});
    setDeps(createDeps(deps.db, { now: () => NOW, storage, model: () => after }));
    expect((await analyze()).body).toMatchObject({ error: { code: "analysis_failed" } });
    expect(after.requests.map((r) => r.stage)).toEqual(["extract"]);
    expect(JSON.stringify(after.requests[0]!.messages)).toContain("Monday");
  });
});

describe("POST /api/meetings/:id/review", () => {
  it("deletes the recording by default", async () => {
    const m = await reviewing("rv-8");
    const deleted = vi.spyOn(storage, "delete");
    const res = await finish(m, false);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ audio: null });
    expect(deleted).toHaveBeenCalledWith(m.storageKey);
    deleted.mockRestore();
    expect(await storage.get(m.storageKey)).toBeNull();
    expect((await state(m)).audio).toBeNull();
    expect((await audio(m)).status).toBe(404);
    // A retry after a failed analysis call finds nothing left to delete.
    expect((await finish(m, false)).status).toBe(200);
  });

  it("keeps the recording when the organizer chose to", async () => {
    const m = await reviewing("rv-9");
    const res = await finish(m, true);
    expect(res.body).toEqual({
      audio: { storageKey: m.storageKey, durationMs: 9000, retain: true },
    });
    expect(await storage.get(m.storageKey)).not.toBeNull();
  });

  it("refuses before every voice is mapped, and leaves the recording", async () => {
    const m = await seedTranscribed(deps, "rv-10", turns);
    expect((await finish({ ...m }, false)).body).toMatchObject({
      error: { code: "speakers_unmapped" },
    });
    expect((await state(m)).audio).not.toBeNull();
  });

  it("refuses once questions are drafted", async () => {
    const m = await reviewing("rv-11");
    await deps.meetings.setStatus("rv-11", "probing");
    expect((await finish(m, false)).body).toMatchObject({ error: { code: "wrong_status" } });
  });
});

describe("record playback", () => {
  const playback = async (m: M) => {
    const organizer = await call(
      recordRoute,
      "/x",
      { id: m.meeting.id },
      { token: m.organizerToken },
    );
    const token = m.participants[0]!.token;
    const participant = await call(participantRecordRoute, "/x", { token });
    return [
      (organizer.body as RecordResponse).playback,
      (participant.body as RecordResponse).playback,
    ];
  };

  it("lets only the organizer play quotes, and only while the recording is kept", async () => {
    const kept = await reviewing("rv-12");
    expect(await playback(kept)).toEqual([false, false]);
    await finish(kept, true);
    expect(await playback(kept)).toEqual([true, false]);

    const deleted = await reviewing("rv-13");
    await finish(deleted, false);
    expect(await playback(deleted)).toEqual([false, false]);
  });
});
