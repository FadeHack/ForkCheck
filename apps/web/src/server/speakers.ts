import { speakerLabels, type Meeting } from "@forkcheck/core";
import type { MapSpeakersRequest, MapSpeakersResponse } from "../contracts/api";
import type { Deps } from "./deps";

export type MapSpeakersOutcome =
  | { ok: true; response: MapSpeakersResponse }
  | { ok: false; status: 400 | 409; code: string; message: string };

const list = (labels: string[]) => labels.map((l) => `Speaker ${l}`).join(", ");

export async function mapSpeakers(
  deps: Deps,
  meeting: Meeting,
  body: MapSpeakersRequest,
): Promise<MapSpeakersOutcome> {
  if (meeting.source !== "audio") {
    return {
      ok: false,
      status: 409,
      code: "not_audio",
      message: "This meeting was started from a pasted transcript, so it has no voices to map.",
    };
  }
  if (meeting.status !== "review") {
    return {
      ok: false,
      status: 409,
      code: "wrong_status",
      message: "Speakers can be changed after transcription and before questions are drafted.",
    };
  }
  const [segments, participants] = await Promise.all([
    deps.meetings.segments(meeting.id),
    deps.meetings.participants(meeting.id),
  ]);
  const labels = speakerLabels(segments);
  const sent = Object.keys(body.mapping);
  const missing = labels.filter((l) => !(l in body.mapping));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "incomplete_mapping",
      message: `Map every speaker or mark them Unknown to continue. Still open: ${list(missing)}.`,
    };
  }
  const extra = sent.filter((l) => !labels.includes(l));
  if (extra.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "unknown_label",
      message: `This transcript has no ${list(extra)}. Reload the page and map the speakers again.`,
    };
  }
  const ids = new Set(participants.map((p) => p.id));
  if (Object.values(body.mapping).some((id) => id !== null && !ids.has(id))) {
    return {
      ok: false,
      status: 400,
      code: "unknown_participant",
      message:
        "One of the chosen people isn't a participant in this meeting. Reload and try again.",
    };
  }
  const saved = await deps.meetings.saveSpeakerMap(
    meeting.id,
    labels.map((label) => ({ label, participantId: body.mapping[label] ?? null })),
  );
  return { ok: true, response: { segments: saved } };
}
