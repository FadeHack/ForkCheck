import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as analyzeRoute } from "../../src/app/api/meetings/[id]/analyze/route";
import { GET as audioRoute } from "../../src/app/api/meetings/[id]/audio/route";
import { GET as getRoute } from "../../src/app/api/meetings/[id]/route";
import { PUT as speakersRoute } from "../../src/app/api/meetings/[id]/speakers/route";
import type { MapSpeakersResponse, OrganizerMeetingState } from "../../src/contracts/api";
import type { Deps } from "../../src/server/deps";
import { LocalDiskStorage } from "../../src/server/storage";
import { call, seedMeeting, seedTranscribed, useTestDeps, type SeedTurn } from "./harness";

let deps: Deps;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forkcheck-speakers-test-"));
  deps = await useTestDeps({ storage: new LocalDiskStorage(root) });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const turns: SeedTurn[] = [
  ["A", 0, 4000, "We ship SSO on Friday."],
  ["B", 4200, 6000, "I'll own the rollout."],
  ["C", 6100, 9000, "It needs the staging tenant first."],
  ["A", 9100, 9800, "Agreed."],
];

type M = { meeting: { id: string }; organizerToken: string };

const put = (m: M, mapping: Record<string, string | null>) =>
  call(
    speakersRoute,
    `/api/meetings/${m.meeting.id}/speakers`,
    { id: m.meeting.id },
    { method: "PUT", token: m.organizerToken, body: { mapping } },
  );

const state = async (m: M) =>
  (
    await call(
      getRoute,
      `/api/meetings/${m.meeting.id}`,
      { id: m.meeting.id },
      { token: m.organizerToken },
    )
  ).body as OrganizerMeetingState;

const analyze = (m: M) =>
  call(
    analyzeRoute,
    `/api/meetings/${m.meeting.id}/analyze`,
    { id: m.meeting.id },
    { method: "POST", token: m.organizerToken },
  );

describe("PUT /api/meetings/:id/speakers", () => {
  it("blocks analysis until every voice is named or marked unknown", async () => {
    const m = await seedTranscribed(deps, "sp-1", turns);
    expect((await state(m)).speakers).toEqual([]);

    const partial = await put(m, { A: "sp-1:p:0" });
    expect(partial.status).toBe(400);
    expect(partial.body).toMatchObject({
      error: {
        code: "incomplete_mapping",
        message:
          "Map every speaker or mark them Unknown to continue. Still open: Speaker B, Speaker C.",
      },
    });

    const blocked = await analyze(m);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: { code: "speakers_unmapped" } });
    expect((await state(m)).meeting.status).toBe("review");
  });

  it("maps two voices to one person and keeps an unknown one", async () => {
    const m = await seedTranscribed(deps, "sp-2", turns);
    const res = await put(m, { A: "sp-2:p:0", B: "sp-2:p:0", C: null });
    expect(res.status).toBe(200);
    expect(
      (res.body as MapSpeakersResponse).segments.map((s) => [s.speakerLabel, s.participantId]),
    ).toEqual([
      ["A", "sp-2:p:0"],
      ["B", "sp-2:p:0"],
      ["C", null],
      ["A", "sp-2:p:0"],
    ]);
    expect((await state(m)).speakers).toEqual([
      { label: "A", participantId: "sp-2:p:0" },
      { label: "B", participantId: "sp-2:p:0" },
      { label: "C", participantId: null },
    ]);

    // A second save replaces the first.
    await put(m, { A: "sp-2:p:1", B: "sp-2:p:0", C: null });
    expect((await state(m)).segments.map((s) => s.participantId)).toEqual([
      "sp-2:p:1",
      "sp-2:p:0",
      null,
      "sp-2:p:1",
    ]);

    const started = await analyze(m);
    expect(started.body).not.toMatchObject({ error: { code: "speakers_unmapped" } });
  });

  it("refuses labels the transcript lacks and people from another meeting", async () => {
    const m = await seedTranscribed(deps, "sp-3", turns);
    const extra = await put(m, { A: null, B: null, C: null, D: null });
    expect(extra.body).toMatchObject({ error: { code: "unknown_label" } });
    const foreign = await put(m, { A: "sp-2:p:0", B: null, C: null });
    expect(foreign.body).toMatchObject({ error: { code: "unknown_participant" } });
    expect((await state(m)).speakers).toEqual([]);
  });

  it("refuses a pasted meeting and one past review", async () => {
    const pasted = await seedMeeting(deps, "sp-4");
    expect((await put(pasted, {})).body).toMatchObject({ error: { code: "not_audio" } });

    const m = await seedTranscribed(deps, "sp-5", turns);
    await deps.meetings.setStatus("sp-5", "probing");
    const late = await put(m, { A: null, B: null, C: null });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ error: { code: "wrong_status" } });
  });
});

describe("GET /api/meetings/:id/audio", () => {
  const get = (m: M, token: string | null = m.organizerToken) =>
    audioRoute(
      new Request(`http://localhost/api/meetings/${m.meeting.id}/audio`, {
        headers: token === null ? {} : { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: m.meeting.id }) },
    );

  it("serves the stored recording to the organizer until it is deleted", async () => {
    const m = await seedTranscribed(deps, "sp-6", turns);
    const bytes = new TextEncoder().encode("RIFF recording");
    await deps.storage.put(
      m.storageKey,
      new ReadableStream({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
      { maxBytes: 100 },
    );

    expect((await get(m, null)).status).toBe(401);
    const res = await get(m);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    await deps.storage.delete(m.storageKey);
    await deps.meetings.markAudioDeleted("sp-6", [m.storageKey], new Date());
    const gone = await get(m);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: "no_audio" } });
  });
});
