import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MemorySpendLedger } from "@forkcheck/ai";
import { convertToWav, replayPath } from "@forkcheck/asr";
import { meetingModelCalls } from "@forkcheck/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import { GET as getRoute } from "../../src/app/api/meetings/[id]/route";
import { POST as audioRoute } from "../../src/app/api/meetings/[id]/audio/route";
import { POST as uploadRoute } from "../../src/app/api/meetings/[id]/audio/upload/route";
import { GET as organizerRecord } from "../../src/app/api/meetings/[id]/record/route";
import { GET as participantRoute } from "../../src/app/api/p/[token]/route";
import type {
  CreateMeetingResponse,
  OrganizerMeetingState,
  ParticipantState,
  RecordResponse,
  UploadAudioResponse,
} from "../../src/contracts/api";
import { analyzeMeeting } from "../../src/server/analyze";
import { modelFactory, transcriberFactory, type Deps } from "../../src/server/deps";
import { LocalDiskStorage } from "../../src/server/storage";
import { call, useTestDeps } from "./harness";

/**
 * M8.2: the server runs live (LIVE=1) but every request fails as if the network were down.
 * Results come from the recordings, and every payload says they were replayed.
 */
let attempts = 0;
const blocked: typeof fetch = async () => {
  attempts++;
  throw new TypeError("fetch failed");
};

const demo = JSON.parse(
  readFileSync(new URL("../../../../scenarios/demo/atlas-launch.json", import.meta.url), "utf8"),
) as { title: string; participants: string[]; transcript: string };

/** One second of silent 16 kHz mono 16-bit WAV. */
function silentWav(): Uint8Array {
  const bytes = new Uint8Array(44 + 32_000);
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
  view.setUint32(40, 32_000, true);
  return bytes;
}

let deps: Deps;
let root: string;
const pending: Promise<void>[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forkcheck-replay-test-"));
  deps = await useTestDeps({
    storage: new LocalDiskStorage(join(root, "audio")),
    background: (task) => void pending.push(task()),
  });
  const live = {
    env: { LIVE: true, RECORD_FIXTURES: false, MODEL_API_KEY: "test-key", SPEND_CAP_USD: 1 },
    db: deps.db,
    ledger: new MemorySpendLedger(),
    fetch: blocked,
    sleep: async () => {},
    replayDir: join(root, "asr"),
  };
  deps.model = modelFactory(live);
  deps.transcriber = transcriberFactory(live);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function create(body: Record<string, unknown>) {
  const res = await call(createRoute, "/api/meetings", {}, { method: "POST", body });
  return res.body as CreateMeetingResponse;
}

const organizerState = async (m: CreateMeetingResponse) =>
  (
    await call(
      getRoute,
      `/api/meetings/${m.meetingId}`,
      { id: m.meetingId },
      { token: m.organizerToken },
    )
  ).body as OrganizerMeetingState;

describe("with the network down", () => {
  it("drafts the demo meeting's questions from recorded replies and labels them replayed", async () => {
    attempts = 0;
    const m = await create({
      title: demo.title,
      heldAt: "2026-11-03T10:00:00-05:00",
      timezone: "America/New_York",
      participants: demo.participants,
      transcript: demo.transcript,
    });
    const meeting = (await deps.meetings.get(m.meetingId))!;
    const outcome = await analyzeMeeting(deps, meeting);
    expect(outcome.ok).toBe(true);
    expect(attempts).toBeGreaterThan(0);

    const state = await organizerState(m);
    expect(state.probes.length).toBeGreaterThan(0);
    expect(state.replayed).toEqual({ model: true, transcription: false });

    // The trace shows each live attempt failing and the replay that answered instead.
    const calls = await meetingModelCalls(deps.db, m.meetingId);
    expect(calls.some((c) => c.provider === "meta" && !c.ok && /network/.test(c.error ?? ""))).toBe(
      true,
    );
    expect(calls.filter((c) => c.ok).every((c) => c.provider === "fake")).toBe(true);

    const token = m.participantLinks[0]!.token;
    const participant = await call(participantRoute, `/api/p/${token}`, { token });
    expect((participant.body as ParticipantState).replayed.model).toBe(true);
    const record = await call(
      organizerRecord,
      `/api/meetings/${m.meetingId}/record`,
      { id: m.meetingId },
      { token: m.organizerToken },
    );
    expect((record.body as RecordResponse).replayed.model).toBe(true);
  });

  it("transcribes a recording from its recorded response and labels it replayed", async () => {
    attempts = 0;
    const wav = silentWav();
    const converted = await convertToWav(wav, { ffmpegPath: deps.ffmpegPath });
    if (!converted.ok) throw new Error("ffmpeg could not convert the test WAV");
    const recorded = replayPath(join(root, "asr"), converted.wav);
    await mkdir(dirname(recorded), { recursive: true });
    await writeFile(
      recorded,
      JSON.stringify({
        sessionId: "voyager/transcribe/REC",
        transcript: "We ship Friday.",
        audioDurationMs: 1000,
        turns: [{ turnId: 0, startMs: 0, endMs: 900, transcript: "We ship Friday.", speaker: "A" }],
      }),
    );

    const m = await create({
      title: "Recorded sync",
      heldAt: "2026-10-26T15:00:00-04:00",
      timezone: "America/New_York",
      participants: ["Priya", "Marco"],
    });
    const upload = await uploadRoute(
      new Request(`http://localhost/api/meetings/${m.meetingId}/audio/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${m.organizerToken}` },
        body: new Blob([new Uint8Array(wav)]),
      }),
      { params: Promise.resolve({ id: m.meetingId }) },
    );
    const { storageKey } = (await upload.json()) as UploadAudioResponse;
    const started = await call(
      audioRoute,
      `/api/meetings/${m.meetingId}/audio`,
      { id: m.meetingId },
      { method: "POST", token: m.organizerToken, body: { storageKey } },
    );
    expect(started.status).toBe(202);
    await Promise.all(pending);

    const state = await organizerState(m);
    expect(attempts).toBeGreaterThan(0);
    expect(state.meeting.status).toBe("review");
    expect(state.segments.map((s) => s.text)).toEqual(["We ship Friday."]);
    expect(state.replayed).toEqual({ model: false, transcription: true });
  });
});
