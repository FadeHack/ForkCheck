import { randomUUID } from "node:crypto";
import { WAV_LIMITS } from "@forkcheck/asr";
import type { Meeting, MeetingStatus } from "@forkcheck/core";
import type { UploadAudioResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { audioKey, TooLargeError } from "./storage";

/** The original file may be MP3 or M4A, but the transcription limit is the useful ceiling for it too. */
export const MAX_UPLOAD_BYTES = WAV_LIMITS.maxBytes;

export type UploadOutcome =
  | { ok: true; response: UploadAudioResponse }
  | { ok: false; status: 400 | 409 | 413; code: string; message: string };

const tooLarge: UploadOutcome = {
  ok: false,
  status: 413,
  code: "too_large",
  message:
    "This file is over the 32 MB limit. Trim it, or convert it to 24 kHz mono 16-bit WAV, and upload again.",
};

const empty: UploadOutcome = {
  ok: false,
  status: 400,
  code: "empty_body",
  message: "The upload was empty. Choose the recording and upload it again.",
};

/** Before transcription starts, or after it failed, a recording can be uploaded or replaced. */
const UPLOADABLE: ReadonlySet<MeetingStatus> = new Set(["draft", "failed"]);

/** Streams the request body into storage; a declared oversize body is refused before any of it is read. */
export async function uploadAudio(
  deps: Deps,
  meeting: Meeting,
  req: Request,
): Promise<UploadOutcome> {
  if (meeting.source !== "audio") {
    return {
      ok: false,
      status: 409,
      code: "not_audio",
      message: "This meeting was started from a pasted transcript, so it takes no recording.",
    };
  }
  if (!UPLOADABLE.has(meeting.status)) {
    return {
      ok: false,
      status: 409,
      code: "wrong_status",
      message: "The recording can only be replaced before transcription starts.",
    };
  }
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (declared > MAX_UPLOAD_BYTES) return tooLarge;
  if (req.body === null || declared === 0) return empty;

  const fileId = randomUUID();
  const storageKey = audioKey(meeting.id, fileId);
  let bytes: number;
  try {
    ({ bytes } = await deps.storage.put(storageKey, req.body, { maxBytes: MAX_UPLOAD_BYTES }));
  } catch (error) {
    // A chunked upload has no Content-Length, so its size is only known while it streams.
    if (error instanceof TooLargeError) return tooLarge;
    throw error;
  }
  if (bytes === 0) {
    await deps.storage.delete(storageKey);
    return empty;
  }
  await deps.meetings.addAudio({ id: fileId, meetingId: meeting.id, storageKey });
  return { ok: true, response: { storageKey, bytes } };
}
