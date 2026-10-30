import type { TranscribeResponse } from "./transcribe";

/**
 * Structurally a core `Segment` with `origin: "asr"`. The asr package may not import core,
 * so the shape is restated here and checked against the core schema in the eval tests.
 */
export interface AsrSegment {
  id: string;
  meetingId: string;
  idx: number;
  speakerLabel: string | null;
  participantId: null;
  startMs: number;
  endMs: number;
  text: string;
  origin: "asr";
  edited: false;
}

export interface ToSegmentsOptions {
  meetingId: string;
  newId: () => string;
  /** Development only: attach the untouched response for debugging. */
  keepRaw?: boolean;
}

export interface AsrSegments {
  segments: AsrSegment[];
  raw?: TranscribeResponse;
}

/**
 * One segment per turn with words, in time order; the service also returns empty turns for
 * pauses, which have nothing to quote or review. Turn boundaries are "not a precise acoustic
 * boundary" (R§4.1), so times are only normalized: integers, end never before start.
 */
export function toSegments(response: TranscribeResponse, options: ToSegmentsOptions): AsrSegments {
  const ordered = response.turns
    .map((turn, position) => ({ turn, position }))
    .filter(({ turn }) => turn.transcript.trim() !== "")
    .sort((a, b) => a.turn.startMs - b.turn.startMs || a.position - b.position);

  const segments = ordered.map(({ turn }, idx): AsrSegment => {
    const startMs = Math.round(turn.startMs);
    return {
      id: options.newId(),
      meetingId: options.meetingId,
      idx,
      speakerLabel: turn.speaker?.trim() || null,
      participantId: null,
      startMs,
      endMs: Math.max(startMs, Math.round(turn.endMs)),
      text: turn.transcript.trim(),
      origin: "asr",
      edited: false,
    };
  });

  return options.keepRaw ? { segments, raw: response } : { segments };
}
