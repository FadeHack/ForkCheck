import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { META_TRANSCRIBE_MODEL } from "@forkcheck/ai";
import { convertToWav, toSegments, TranscribeError } from "@forkcheck/asr";
import type { Meeting, MeetingStatus, Segment } from "@forkcheck/core";
import { DbCallLog, TRANSCRIBE_STAGE } from "@forkcheck/db";
import type { StartTranscriptionRequest, StartTranscriptionResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { logError } from "./log";
import { stepClaim, StepTakenOver } from "./steps";

export type StartTranscriptionOutcome =
  | { ok: true; response: StartTranscriptionResponse }
  | { ok: false; status: 404 | 409; code: string; message: string };

/** A failed transcription restarts from `failed`; a stalled one is taken over by the claim itself. */
const STARTABLE: readonly MeetingStatus[] = ["draft", "failed"];

const FAILED =
  "Transcription failed on the server. Start it again; if it keeps failing, upload the recording again.";

/**
 * Claims the meeting for transcription and answers 202 at once. Conversion, checks and the
 * Voice Transcribe call run in the background; the organizer polls `/progress`.
 */
export async function startTranscription(
  deps: Deps,
  meeting: Meeting,
  body: StartTranscriptionRequest,
): Promise<StartTranscriptionOutcome> {
  if (meeting.source !== "audio") {
    return {
      ok: false,
      status: 409,
      code: "not_audio",
      message:
        "This meeting was started from a pasted transcript, so there is nothing to transcribe.",
    };
  }
  if (meeting.transcriptVersion > 0) {
    return {
      ok: false,
      status: 409,
      code: "already_transcribed",
      message: "This recording is already transcribed. Review the transcript instead.",
    };
  }
  if (!(await deps.meetings.hasAudio(meeting.id, body.storageKey))) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: "That recording was not found in this meeting. Upload it again.",
    };
  }
  const runId = randomUUID();
  if (!(await deps.meetings.startTranscription(meeting.id, STARTABLE, stepClaim(deps, runId)))) {
    return {
      ok: false,
      status: 409,
      code: "transcription_running",
      message:
        "Transcription is already running for this meeting. Wait for it to finish, or retry if it stops showing progress.",
    };
  }
  const participants = await deps.meetings.participants(meeting.id);
  // Names are where recognition errors hurt most (R§4.1), so they always go in as keywords.
  const keywords = [
    ...new Set([...participants.map((p) => p.displayName), ...(body.keywords ?? [])]),
  ];
  deps.background(() => runTranscription(deps, meeting.id, runId, body.storageKey, keywords));
  return { ok: true, response: { status: "transcribing" } };
}

class TranscriptionProblem extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "TranscriptionProblem";
  }
}

async function runTranscription(
  deps: Deps,
  meetingId: string,
  runId: string,
  storageKey: string,
  keywords: string[],
): Promise<void> {
  const beat = async () => {
    if (!(await deps.meetings.heartbeat(meetingId, runId, deps.now()))) {
      throw new StepTakenOver(meetingId);
    }
  };
  try {
    const converted = await convertStored(deps, storageKey);
    if (!converted.ok) throw new TranscriptionProblem(converted.message);
    await beat();
    const result = await deps.transcriber(meetingId).transcribe(converted.wav, { keywords });
    const { response } = result;
    // Logged with the model calls, so the trace lists it and screens can label a replay.
    await new DbCallLog(deps.db, { meetingId }).write({
      at: deps.now().toISOString(),
      stage: TRANSCRIBE_STAGE,
      provider: result.replayed ? "fake" : "meta",
      model: META_TRANSCRIBE_MODEL,
      promptVersion: "none",
      cacheHit: false,
      latencyMs: result.latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: null,
      costUsd: result.costUsd,
      ok: true,
      error: null,
    });
    await beat();
    let idx = 0;
    const segments: Segment[] = toSegments(response, {
      meetingId,
      newId: () => `${meetingId}:seg:${idx++}`,
    })
      // Turns with no words carry nothing to review or quote.
      .segments.filter((s) => s.text !== "")
      .map((s, i) => ({ ...s, idx: i }));
    const saved = await deps.meetings.saveTranscript(meetingId, runId, {
      segments,
      storageKey,
      durationMs: response.audioDurationMs,
    });
    if (!saved) throw new StepTakenOver(meetingId);
  } catch (error) {
    if (error instanceof StepTakenOver) return;
    const message =
      error instanceof TranscribeError || error instanceof TranscriptionProblem
        ? error.userMessage
        : FAILED;
    if (!(error instanceof TranscriptionProblem)) logError(`transcribe ${meetingId}`, error);
    await deps.meetings.failTranscription(meetingId, runId, message);
  }
}

/** ffmpeg reads from a path, so the stored file is copied to a temp directory first. */
async function convertStored(
  deps: Deps,
  storageKey: string,
): Promise<{ ok: true; wav: Uint8Array } | { ok: false; message: string }> {
  const stream = await deps.storage.get(storageKey);
  if (stream === null) {
    return { ok: false, message: "The uploaded recording is no longer stored. Upload it again." };
  }
  const work = await mkdtemp(join(tmpdir(), "forkcheck-upload-"));
  try {
    const source = join(work, "upload");
    await pipeline(
      Readable.fromWeb(stream as NodeReadableStream<Uint8Array>),
      createWriteStream(source),
    );
    const result = await convertToWav(source, { ffmpegPath: deps.ffmpegPath });
    if (result.ok) return { ok: true, wav: result.wav };
    return { ok: false, message: result.problems.map((p) => p.message).join(" ") };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
