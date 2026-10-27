import { z } from "zod";

export const TRANSCRIBE_URL = "https://api.meta.ai/v1/asr/transcribe";
export const TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";

/** USD per hour of audio, billed in whole seconds. */
export const TRANSCRIBE_PRICE_PER_HOUR = 0.18;

export const transcribeRequest = z.strictObject({
  model: z.literal(TRANSCRIBE_MODEL),
  audioEncoding: z.literal("WAV"),
  mode: z.enum(["PUSH_TO_TALK", "ENDPOINTING", "DIARIZATION"]),
  keywords: z.array(z.string()).optional(),
  languageBias: z.array(z.string()).optional(),
});
export type TranscribeRequest = z.infer<typeof transcribeRequest>;

// Loose objects: unknown extra keys are tolerated so they can be reported, not rejected.
export const transcribeTurn = z.looseObject({
  turnId: z.union([z.string(), z.number()]),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  transcript: z.string(),
  speaker: z.string().optional(),
});

export const transcribeResponse = z.looseObject({
  sessionId: z.string().min(1),
  transcript: z.string(),
  audioDurationMs: z.number().nonnegative(),
  turns: z.array(transcribeTurn),
});
export type TranscribeResponse = z.infer<typeof transcribeResponse>;

export function transcribeCostUsd(audioDurationMs: number): number {
  return (Math.floor(audioDurationMs / 1000) * TRANSCRIBE_PRICE_PER_HOUR) / 3600;
}
