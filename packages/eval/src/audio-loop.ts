import { toSegments, type TranscribeResponse } from "@forkcheck/asr";
import type { Segment } from "@forkcheck/core";
import type { AudioTruth } from "./audio-render";
import { speakerAccuracy } from "./s1";
import type { Scenario } from "./scenario";

export interface AudioSegments {
  segments: Segment[];
  /** ASR label → participant, as the organizer would map them; `?` is the unlabeled turn. */
  mapping: Record<string, string | null>;
}

/**
 * Transcription turns as meeting segments, with speakers mapped from the ground truth the way
 * an organizer would map them by ear. Empty turns are dropped, as transcript review would.
 */
export function audioSegments(
  s: Scenario,
  truth: Pick<AudioTruth, "turns">,
  response: TranscribeResponse,
): AudioSegments {
  const { mapping } = speakerAccuracy(truth, response.turns);
  const { segments } = toSegments(response, { meetingId: s.id, newId: () => "" });
  return {
    mapping,
    segments: segments
      .filter((seg) => seg.text !== "")
      .map((seg, idx) => ({
        ...seg,
        id: `${s.id}:seg:${idx}`,
        idx,
        participantId: mapping[seg.speakerLabel ?? "?"] ?? null,
      })),
  };
}
