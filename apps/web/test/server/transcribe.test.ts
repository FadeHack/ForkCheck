import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TranscribeClient } from "@forkcheck/asr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import { GET as getRoute } from "../../src/app/api/meetings/[id]/route";
import { POST as audioRoute } from "../../src/app/api/meetings/[id]/audio/route";
import { POST as uploadRoute } from "../../src/app/api/meetings/[id]/audio/upload/route";
import { GET as progressRoute } from "../../src/app/api/meetings/[id]/progress/route";
import type {
  CreateMeetingResponse,
  MeetingProgressResponse,
  OrganizerMeetingState,
  UploadAudioResponse,
} from "../../src/contracts/api";
import type { Deps } from "../../src/server/deps";
import { LocalDiskStorage } from "../../src/server/storage";
import { call, seedMeeting, useTestDeps } from "./harness";

/** One second of silent 16 kHz mono 16-bit WAV; ffmpeg resamples it to 24 kHz. */
function silentWav(): Uint8Array {
  const dataBytes = 16_000 * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

const success = {
  sessionId: "voyager/transcribe/OK",
  transcript: "We ship Friday. I'll own it.",
  audioDurationMs: 1000,
  turns: [
    { turnId: 1, startMs: 600, endMs: 900, transcript: " I'll own it. ", speaker: "B" },
    { turnId: 0, startMs: 0, endMs: 500, transcript: "We ship Friday.", speaker: "A" },
    { turnId: 2, startMs: 950, endMs: 990, transcript: "  ", speaker: "A" },
  ],
};

const reply = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Voice Transcribe over a scripted HTTP mock; `sent` collects each request's JSON part. */
function mockAsr(script: (() => Response)[]) {
  const sent: { keywords?: string[] }[] = [];
  let spent = 0;
  const client = new TranscribeClient({
    apiKey: "test-key",
    spendCapUsd: 1,
    ledger: { totalUsd: async () => spent, add: async (_p, usd) => void (spent += usd) },
    sleep: async () => {},
    fetch: async (_url, init) => {
      const form = init?.body as FormData;
      sent.push(JSON.parse(await (form.get("request") as Blob).text()) as { keywords?: string[] });
      const next = script.shift();
      if (next === undefined) throw new Error("unexpected ASR call");
      return next();
    },
  });
  return { client, sent };
}

let deps: Deps;
let root: string;
let asr: TranscribeClient;
const pending: Promise<void>[] = [];
const settle = async () => {
  await Promise.all(pending.splice(0));
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forkcheck-transcribe-test-"));
  deps = await useTestDeps({
    storage: new LocalDiskStorage(root),
    transcriber: () => asr,
    background: (task) => void pending.push(task()),
  });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function uploaded(file: Uint8Array = silentWav()) {
  const created = await call(
    createRoute,
    "/api/meetings",
    {},
    {
      method: "POST",
      body: {
        title: "Recorded sync",
        heldAt: "2026-10-26T15:00:00-04:00",
        timezone: "America/New_York",
        participants: ["Priya", "Marco"],
      },
    },
  );
  const m = created.body as CreateMeetingResponse;
  const req = new Request(`http://localhost/api/meetings/${m.meetingId}/audio/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${m.organizerToken}` },
    body: new Blob([new Uint8Array(file)]),
  });
  const res = await uploadRoute(req, { params: Promise.resolve({ id: m.meetingId }) });
  expect(res.status).toBe(201);
  const { storageKey } = (await res.json()) as UploadAudioResponse;
  return { ...m, storageKey };
}

const start = (m: { meetingId: string; organizerToken: string }, body: unknown) =>
  call(
    audioRoute,
    `/api/meetings/${m.meetingId}/audio`,
    { id: m.meetingId },
    { method: "POST", token: m.organizerToken, body },
  );

const progress = async (m: { meetingId: string; organizerToken: string }) =>
  (
    await call(
      progressRoute,
      `/api/meetings/${m.meetingId}/progress`,
      { id: m.meetingId },
      { token: m.organizerToken },
    )
  ).body as MeetingProgressResponse;

const state = async (m: { meetingId: string; organizerToken: string }) =>
  (
    await call(
      getRoute,
      `/api/meetings/${m.meetingId}`,
      { id: m.meetingId },
      { token: m.organizerToken },
    )
  ).body as OrganizerMeetingState;

describe("POST /api/meetings/:id/audio", () => {
  it("answers 202, then converts, transcribes and saves segments for review", async () => {
    const mock = mockAsr([reply(200, success)]);
    asr = mock.client;
    const m = await uploaded();

    const res = await start(m, { storageKey: m.storageKey, keywords: ["SSO", "Priya"] });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "transcribing" });
    expect(await progress(m)).toEqual({
      status: "transcribing",
      step: "transcribe",
      stalled: false,
      error: null,
    });

    await settle();
    expect(await progress(m)).toMatchObject({ status: "review", step: null, error: null });
    expect(mock.sent[0]?.keywords?.toSorted()).toEqual(["Marco", "Priya", "SSO"]);
    const s = await state(m);
    expect(s.meeting.transcriptVersion).toBe(1);
    expect(s.segments.map((x) => [x.idx, x.speakerLabel, x.startMs, x.text, x.origin])).toEqual([
      [0, "A", 0, "We ship Friday.", "asr"],
      [1, "B", 600, "I'll own it.", "asr"],
    ]);
    expect(s.segments.every((x) => x.participantId === null && !x.edited)).toBe(true);
  });

  it("fails with the service's reason on a 400, and a retry resumes", async () => {
    const mock = mockAsr([
      reply(400, { error: { message: "Audio duration exceeds limit." } }),
      reply(200, success),
    ]);
    asr = mock.client;
    const m = await uploaded();

    expect((await start(m, { storageKey: m.storageKey })).status).toBe(202);
    await settle();
    const failed = await progress(m);
    expect(failed).toMatchObject({ status: "failed", step: "transcribe" });
    expect(failed.error).toBe(
      "The transcription service rejected this recording: Audio duration exceeds limit. Check that it is under 10 minutes and upload it again.",
    );

    expect((await start(m, { storageKey: m.storageKey })).status).toBe(202);
    await settle();
    expect(await progress(m)).toMatchObject({ status: "review", error: null });
    expect((await state(m)).segments).toHaveLength(2);
  });

  it("waits out a 429 and then succeeds", async () => {
    const mock = mockAsr([reply(429, { message: "Too many requests" }), reply(200, success)]);
    asr = mock.client;
    const m = await uploaded();

    expect((await start(m, { storageKey: m.storageKey })).status).toBe(202);
    await settle();
    expect(mock.sent).toHaveLength(2);
    expect(await progress(m)).toMatchObject({ status: "review" });
  });

  it("fails before calling the service when the file isn't audio", async () => {
    const mock = mockAsr([]);
    asr = mock.client;
    const m = await uploaded(new TextEncoder().encode("not audio at all"));

    expect((await start(m, { storageKey: m.storageKey })).status).toBe(202);
    await settle();
    const p = await progress(m);
    expect(p).toMatchObject({ status: "failed", step: "transcribe" });
    expect(p.error).not.toBeNull();
    expect(mock.sent).toHaveLength(0);
  });

  it("refuses a second start while one is running", async () => {
    asr = mockAsr([reply(200, success)]).client;
    const m = await uploaded();
    expect((await start(m, { storageKey: m.storageKey })).status).toBe(202);
    const again = await start(m, { storageKey: m.storageKey });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: "transcription_running" } });
    await settle();
  });

  it("refuses a finished transcription, a key from another meeting and a paste meeting", async () => {
    asr = mockAsr([reply(200, success)]).client;
    const m = await uploaded();
    await start(m, { storageKey: m.storageKey });
    await settle();
    expect((await start(m, { storageKey: m.storageKey })).body).toMatchObject({
      error: { code: "already_transcribed" },
    });

    const other = await uploaded();
    const foreign = await start(other, { storageKey: m.storageKey });
    expect(foreign.status).toBe(404);

    const pasted = await seedMeeting(deps, "pasted-2");
    const res = await start(
      { meetingId: "pasted-2", organizerToken: pasted.organizerToken },
      { storageKey: m.storageKey },
    );
    expect(res.body).toMatchObject({ error: { code: "not_audio" } });
  });
});
