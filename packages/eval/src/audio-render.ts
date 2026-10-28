import { z } from "zod";

/** macOS voices with distinct accents and pitch, one per participant in scenario order. */
export const VOICES = ["Samantha", "Daniel", "Karen", "Rishi"] as const;

export const RENDER_SAMPLE_RATE = 24_000;
export const BACKCHANNEL_TEXT = "Mm-hm.";

export const renderVariant = z.enum(["clean", "overlap", "backchannel"]);
export type RenderVariant = z.infer<typeof renderVariant>;

export interface TimingOptions {
  leadMs: number;
  gapMs: number;
  tailMs: number;
  /** Overlap: every Nth turn starts this long before the previous one ends (capped at 40%). */
  overlapEvery: number;
  overlapMs: number;
  /** Back-channel: every Nth turn of at least `backchannelMinMs` gets an "mm-hm" from a listener. */
  backchannelEvery: number;
  backchannelMinMs: number;
}

export const DEFAULT_TIMING: TimingOptions = {
  leadMs: 300,
  gapMs: 400,
  tailMs: 300,
  overlapEvery: 4,
  overlapMs: 700,
  backchannelEvery: 3,
  backchannelMinMs: 2500,
};

export interface ClipTurn {
  speaker: string;
  text: string;
  durationMs: number;
}

export const truthTurn = z.strictObject({
  idx: z.int().nonnegative(),
  speaker: z.string().min(1),
  voice: z.string().min(1),
  text: z.string(),
  startMs: z.int().nonnegative(),
  endMs: z.int().nonnegative(),
  /** `turn` comes from the script; `backchannel` is an inserted "mm-hm". */
  kind: z.enum(["turn", "backchannel"]),
  /** Index of the script turn this line came from; null for back-channels. */
  scriptIdx: z.int().nonnegative().nullable(),
});
export type TruthTurn = z.infer<typeof truthTurn>;

export const audioTruth = z.strictObject({
  version: z.literal(1),
  scenarioId: z.string().min(1),
  variant: renderVariant,
  sampleRate: z.int().positive(),
  durationMs: z.int().nonnegative(),
  voices: z.record(z.string(), z.string()),
  turns: z.array(truthTurn),
});
export type AudioTruth = z.infer<typeof audioTruth>;

export function assignVoices(participants: readonly string[]): Record<string, string> {
  if (participants.length > VOICES.length) {
    throw new Error(`at most ${VOICES.length} participants can be voiced`);
  }
  return Object.fromEntries(participants.map((p, i) => [p, VOICES[i]!]));
}

/**
 * Places script turns (and, for the back-channel variant, "mm-hm" lines) on one timeline.
 * `backchannelMs` is the rendered length of each speaker's "mm-hm".
 */
export function planTimeline(input: {
  scenarioId: string;
  variant: RenderVariant;
  participants: readonly string[];
  turns: readonly ClipTurn[];
  backchannelMs?: Readonly<Record<string, number>>;
  timing?: TimingOptions;
}): AudioTruth {
  const t = input.timing ?? DEFAULT_TIMING;
  const voices = assignVoices(input.participants);
  const lines: Omit<TruthTurn, "idx">[] = [];

  let cursor = t.leadMs;
  let previous: { startMs: number; durationMs: number } | undefined;
  input.turns.forEach((turn, i) => {
    let startMs = cursor;
    if (input.variant === "overlap" && previous && i % t.overlapEvery === t.overlapEvery - 1) {
      const overlap = Math.min(t.overlapMs, Math.floor(previous.durationMs * 0.4));
      startMs = previous.startMs + previous.durationMs - overlap;
    }
    const endMs = startMs + turn.durationMs;
    lines.push({
      speaker: turn.speaker,
      voice: voices[turn.speaker] ?? "",
      text: turn.text,
      startMs,
      endMs,
      kind: "turn",
      scriptIdx: i,
    });

    if (
      input.variant === "backchannel" &&
      i % t.backchannelEvery === t.backchannelEvery - 1 &&
      turn.durationMs >= t.backchannelMinMs
    ) {
      const prev = input.turns[i - 1]?.speaker;
      const by =
        prev !== undefined && prev !== turn.speaker
          ? prev
          : input.participants.find((p) => p !== turn.speaker);
      const length = by ? input.backchannelMs?.[by] : undefined;
      if (by && length !== undefined) {
        const at = startMs + Math.floor(turn.durationMs * 0.4);
        lines.push({
          speaker: by,
          voice: voices[by] ?? "",
          text: BACKCHANNEL_TEXT,
          startMs: at,
          endMs: at + length,
          kind: "backchannel",
          scriptIdx: null,
        });
      }
    }

    previous = { startMs, durationMs: turn.durationMs };
    cursor = Math.max(cursor, endMs) + t.gapMs;
  });

  const ordered = lines
    .map((line, order) => ({ line, order }))
    .sort((a, b) => a.line.startMs - b.line.startMs || a.order - b.order)
    .map(({ line }, idx) => ({ idx, ...line }));
  const lastEnd = Math.max(0, ...ordered.map((l) => l.endMs));

  return {
    version: 1,
    scenarioId: input.scenarioId,
    variant: input.variant,
    sampleRate: RENDER_SAMPLE_RATE,
    durationMs: lastEnd + t.tailMs,
    voices,
    turns: ordered,
  };
}

const samplesAt = (ms: number, sampleRate: number) => Math.round((ms * sampleRate) / 1000);

/** Sums 16-bit clips at their start times, clipping instead of wrapping on overlap. */
export function mixPcm(
  clips: readonly { startMs: number; samples: Int16Array }[],
  durationMs: number,
  sampleRate = RENDER_SAMPLE_RATE,
): Int16Array {
  const mix = new Int32Array(samplesAt(durationMs, sampleRate));
  for (const clip of clips) {
    const offset = samplesAt(clip.startMs, sampleRate);
    for (let i = 0; i < clip.samples.length && offset + i < mix.length; i++) {
      mix[offset + i]! += clip.samples[i]!;
    }
  }
  return Int16Array.from(mix, (v) => Math.max(-32768, Math.min(32767, v)));
}

/** Canonical 44-byte-header mono 16-bit PCM WAV. */
export function encodeWav(samples: Int16Array, sampleRate = RENDER_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return bytes;
}
