import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "../../src/app/api/meetings/route";
import { DELETE } from "../../src/app/api/meetings/[id]/route";
import { POST as uploadRoute } from "../../src/app/api/meetings/[id]/audio/upload/route";
import type { CreateMeetingResponse, UploadAudioResponse } from "../../src/contracts/api";
import { MAX_UPLOAD_BYTES } from "../../src/server/audio";
import type { Deps } from "../../src/server/deps";
import { LocalDiskStorage, TooLargeError } from "../../src/server/storage";
import { call, seedMeeting, useTestDeps } from "./harness";

let deps: Deps;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forkcheck-audio-test-"));
  deps = await useTestDeps({ storage: new LocalDiskStorage(root) });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const MB = 1_000_000;

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Produces `total` bytes in 64 KB chunks, only when the reader asks for more. */
function lazyStream(total: number, onPull: (sent: number) => Promise<void> = async () => {}) {
  const chunk = 64 * 1024;
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await onPull(sent);
        if (sent >= total) {
          controller.close();
          return;
        }
        const size = Math.min(chunk, total - sent);
        controller.enqueue(new Uint8Array(size).fill(sent % 251));
        sent += size;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => sent };
}

async function audioMeeting(): Promise<CreateMeetingResponse> {
  const res = await call(
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
  expect(res.status).toBe(201);
  return res.body as CreateMeetingResponse;
}

async function upload(
  meetingId: string,
  token: string | undefined,
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) {
  const h = new Headers({ "content-type": "audio/wav", ...headers });
  if (token !== undefined) h.set("authorization", `Bearer ${token}`);
  const req = new Request(`http://localhost/api/meetings/${meetingId}/audio/upload`, {
    method: "POST",
    headers: h,
    body,
    duplex: "half",
  } as RequestInit);
  const res = await uploadRoute(req, { params: Promise.resolve({ id: meetingId }) });
  return { status: res.status, body: (await res.json()) as unknown };
}

const filesIn = async (dir: string) => readdir(dir).catch(() => [] as string[]);

describe("LocalDiskStorage", () => {
  it("puts, gets and deletes a file", async () => {
    const storage = new LocalDiskStorage(root);
    const bytes = new TextEncoder().encode("RIFF fake");
    expect(await storage.put("m-1/f-1", streamOf(bytes), { maxBytes: 100 })).toEqual({
      bytes: bytes.length,
    });
    const read = await storage.get("m-1/f-1");
    expect(new Uint8Array(await new Response(read).arrayBuffer())).toEqual(bytes);
    await storage.delete("m-1/f-1");
    expect(await storage.get("m-1/f-1")).toBeNull();
    await expect(storage.delete("m-1/f-1")).resolves.toBeUndefined();
  });

  it("stops at maxBytes and leaves nothing behind", async () => {
    const storage = new LocalDiskStorage(root);
    const { stream, pulled } = lazyStream(10 * MB);
    await expect(storage.put("m-2/f-1", stream, { maxBytes: MB })).rejects.toBeInstanceOf(
      TooLargeError,
    );
    expect(pulled()).toBeLessThan(2 * MB);
    expect(await filesIn(join(root, "m-2"))).toEqual([]);
  });

  it("refuses keys that could leave its directory", async () => {
    const storage = new LocalDiskStorage(root);
    for (const key of ["../x/y", "m/../../y", "/etc/passwd", "m/f/g", "m/f.wav"]) {
      await expect(storage.get(key)).rejects.toThrow("Not a valid storage key");
    }
  });
});

describe("POST /api/meetings/:id/audio/upload", () => {
  it("streams a 28 MB file to disk without holding it in memory", async () => {
    const m = await audioMeeting();
    const total = 28 * MB;
    const dir = join(root, m.meetingId);
    let maxAhead = 0;
    const { stream } = lazyStream(total, async (sent) => {
      const [file] = await filesIn(dir);
      const onDisk = file === undefined ? 0 : (await stat(join(dir, file))).size;
      maxAhead = Math.max(maxAhead, sent - onDisk);
    });

    const res = await upload(m.meetingId, m.organizerToken, stream);
    expect(res.status).toBe(201);
    const { storageKey, bytes } = res.body as UploadAudioResponse;
    expect(bytes).toBe(total);
    expect(storageKey).toMatch(new RegExp(`^${m.meetingId}/[\\w-]+$`));
    expect((await stat(join(root, storageKey))).size).toBe(total);
    // Pipe buffers hold a few chunks in flight; a buffered body would run the full 28 MB ahead.
    expect(maxAhead).toBeLessThan(2 * MB);
    expect(await deps.meetings.hasAudio(m.meetingId, storageKey)).toBe(true);
  });

  it("rejects a declared oversize body before reading any of it", async () => {
    const m = await audioMeeting();
    const { stream, pulled } = lazyStream(MAX_UPLOAD_BYTES + 1);
    const res = await upload(m.meetingId, m.organizerToken, stream, {
      "content-length": String(MAX_UPLOAD_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: { code: "too_large" } });
    expect(pulled()).toBe(0);
    expect(await filesIn(join(root, m.meetingId))).toEqual([]);
  });

  it("stops a chunked upload once it passes 32 MB", async () => {
    const m = await audioMeeting();
    const { stream, pulled } = lazyStream(40 * MB);
    const res = await upload(m.meetingId, m.organizerToken, stream);
    expect(res.status).toBe(413);
    expect(pulled()).toBeLessThan(MAX_UPLOAD_BYTES + 2 * MB);
    expect(await filesIn(join(root, m.meetingId))).toEqual([]);
    expect(await deps.meetings.audioKeys(m.meetingId)).toEqual([]);
  });

  it("rejects an empty upload", async () => {
    const m = await audioMeeting();
    const res = await upload(m.meetingId, m.organizerToken, streamOf(new Uint8Array(0)));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "empty_body" } });
    expect(await deps.meetings.audioKeys(m.meetingId)).toEqual([]);
  });

  it("needs the organizer token", async () => {
    const m = await audioMeeting();
    const { stream, pulled } = lazyStream(MB);
    expect((await upload(m.meetingId, undefined, stream)).status).toBe(401);
    expect(pulled()).toBe(0);
  });

  it("refuses a pasted-transcript meeting", async () => {
    const m = await seedMeeting(deps, "pasted-1");
    const res = await upload("pasted-1", m.organizerToken, streamOf(new Uint8Array(10)));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "not_audio" } });
  });

  it("refuses a meeting past transcription", async () => {
    const m = await audioMeeting();
    await deps.meetings.setStatus(m.meetingId, "review");
    const res = await upload(m.meetingId, m.organizerToken, streamOf(new Uint8Array(10)));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "wrong_status" } });
  });

  it("removes the stored file when the meeting is deleted", async () => {
    const m = await audioMeeting();
    const res = await upload(m.meetingId, m.organizerToken, streamOf(new Uint8Array(1000)));
    const { storageKey } = res.body as UploadAudioResponse;
    expect(await readFile(join(root, storageKey))).toHaveLength(1000);

    const del = await call(
      DELETE,
      `/api/meetings/${m.meetingId}`,
      { id: m.meetingId },
      { method: "DELETE", token: m.organizerToken },
    );
    expect(del.status).toBe(204);
    expect(await deps.storage.get(storageKey)).toBeNull();
  });
});
