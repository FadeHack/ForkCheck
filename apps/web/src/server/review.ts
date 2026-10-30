import { speakersMapped, type Meeting } from "@forkcheck/core";
import type {
  EditSegmentRequest,
  EditSegmentResponse,
  FinishReviewRequest,
  FinishReviewResponse,
} from "../contracts/api";
import type { Deps } from "./deps";

type Refusal = { ok: false; status: 400 | 409; code: string; message: string };
export type EditSegmentOutcome = { ok: true; response: EditSegmentResponse } | Refusal;
export type FinishReviewOutcome = { ok: true; response: FinishReviewResponse } | Refusal;

const notAudio: Refusal = {
  ok: false,
  status: 409,
  code: "not_audio",
  message: "This meeting was started from a pasted transcript, so it has no transcript review.",
};

const reviewOver: Refusal = {
  ok: false,
  status: 409,
  code: "wrong_status",
  message: "Transcript review is over for this meeting: questions are already being drafted.",
};

/** Edits are only open between transcription and analysis, and every change is logged. */
export async function editSegment(
  deps: Deps,
  meeting: Meeting,
  segmentId: string,
  body: EditSegmentRequest,
): Promise<EditSegmentOutcome> {
  if (meeting.source !== "audio") return notAudio;
  if (meeting.status !== "review") return reviewOver;
  const text = body.text?.trim();
  if (text === "") {
    return {
      ok: false,
      status: 400,
      code: "empty_text",
      message: "A turn can't be empty. Type what was said, or cancel to keep the old wording.",
    };
  }
  if (body.participantId != null) {
    const participants = await deps.meetings.participants(meeting.id);
    if (!participants.some((p) => p.id === body.participantId)) {
      return {
        ok: false,
        status: 400,
        code: "unknown_participant",
        message: "The chosen person isn't a participant in this meeting. Reload and try again.",
      };
    }
  }
  const saved = await deps.meetings.editSegment(
    segmentId,
    { text, participantId: body.participantId },
    "organizer",
    deps.now(),
  );
  return saved === null ? reviewOver : { ok: true, response: saved };
}

/**
 * Ends review: the recording is deleted unless the organizer keeps it. The meeting stays in
 * `review` until analysis starts, so a retry after a failed analysis call lands here again.
 */
export async function finishReview(
  deps: Deps,
  meeting: Meeting,
  body: FinishReviewRequest,
): Promise<FinishReviewOutcome> {
  if (meeting.source !== "audio") return notAudio;
  if (meeting.status !== "review") return reviewOver;
  const [segments, saved] = await Promise.all([
    deps.meetings.segments(meeting.id),
    deps.meetings.speakerMap(meeting.id),
  ]);
  if (!speakersMapped(segments, saved)) {
    return {
      ok: false,
      status: 409,
      code: "speakers_unmapped",
      message: "Map every speaker or mark them Unknown to continue.",
    };
  }
  if (body.keepAudio) {
    await deps.meetings.retainAudio(meeting.id);
  } else {
    const keys = await deps.meetings.audioKeys(meeting.id);
    for (const key of keys) await deps.storage.delete(key);
    await deps.meetings.markAudioDeleted(meeting.id, keys, deps.now());
  }
  return { ok: true, response: { audio: await deps.meetings.liveAudio(meeting.id) } };
}
