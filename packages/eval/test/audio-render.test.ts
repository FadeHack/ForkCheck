import { inspectWav } from "@forkcheck/asr";
import { describe, expect, it } from "vitest";
import {
  assignVoices,
  audioTruth,
  BACKCHANNEL_TEXT,
  encodeWav,
  mixPcm,
  planTimeline,
  RENDER_SAMPLE_RATE,
  type ClipTurn,
  type RenderVariant,
} from "../src/index";

const participants = ["Rosa", "Kwame", "Lena"];
const turns: ClipTurn[] = [
  { speaker: "Rosa", text: "One.", durationMs: 3000 },
  { speaker: "Kwame", text: "Two.", durationMs: 2000 },
  { speaker: "Lena", text: "Three.", durationMs: 4000 },
  { speaker: "Kwame", text: "Four.", durationMs: 1000 },
  { speaker: "Rosa", text: "Five.", durationMs: 2500 },
  { speaker: "Rosa", text: "Six.", durationMs: 3000 },
];
const backchannelMs = { Rosa: 500, Kwame: 600, Lena: 550 };
const plan = (variant: RenderVariant) =>
  planTimeline({ scenarioId: "dev-x", variant, participants, turns, backchannelMs });

const tone = (ms: number, value = 1000) =>
  new Int16Array(Math.round((ms * RENDER_SAMPLE_RATE) / 1000)).fill(value);

/** Mixes the plan the way the render script does, with constant-valued clips. */
function render(variant: RenderVariant) {
  const truth = plan(variant);
  const wav = encodeWav(
    mixPcm(
      truth.turns.map((t) => ({ startMs: t.startMs, samples: tone(t.endMs - t.startMs) })),
      truth.durationMs,
    ),
  );
  return { truth, wav };
}

describe("planTimeline", () => {
  it("places clean turns in order with lead, gaps and tail", () => {
    const truth = plan("clean");
    expect(audioTruth.parse(truth)).toEqual(truth);
    expect(truth.voices).toEqual({ Rosa: "Samantha", Kwame: "Daniel", Lena: "Karen" });
    expect(truth.turns.map((t) => [t.startMs, t.endMs])).toEqual([
      [300, 3300],
      [3700, 5700],
      [6100, 10100],
      [10500, 11500],
      [11900, 14400],
      [14800, 17800],
    ]);
    expect(truth.turns.every((t) => t.kind === "turn")).toBe(true);
    expect(truth.durationMs).toBe(18100);
  });

  it("starts every fourth turn before the previous one ends, capped at 40%", () => {
    const truth = plan("overlap");
    const fourth = truth.turns[3]!;
    // Previous turn ran 6100–10100; overlap is min(700, 40% of 4000).
    expect(fourth.startMs).toBe(9400);
    expect(fourth.startMs).toBeLessThan(truth.turns[2]!.endMs);
    expect(truth.turns.filter((t, i) => i > 0 && t.startMs < truth.turns[i - 1]!.endMs)).toEqual([
      fourth,
    ]);
    expect(truth.durationMs).toBeLessThan(plan("clean").durationMs);
  });

  it("inserts an mm-hm by the previous speaker inside every third long-enough turn", () => {
    const truth = plan("backchannel");
    const inserted = truth.turns.filter((t) => t.kind === "backchannel");
    // Turn 3 (Lena, 4000 ms) gets one; turn 6 (Rosa after Rosa) goes to the first other person.
    expect(inserted).toEqual([
      expect.objectContaining({
        speaker: "Kwame",
        voice: "Daniel",
        text: BACKCHANNEL_TEXT,
        startMs: 6100 + 1600,
        endMs: 6100 + 1600 + 600,
        scriptIdx: null,
      }),
      expect.objectContaining({ speaker: "Kwame", startMs: 14800 + 1200 }),
    ]);
    expect(truth.turns.map((t) => t.idx)).toEqual(truth.turns.map((_, i) => i));
    expect(truth.turns.filter((t) => t.kind === "turn").map((t) => t.scriptIdx)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it("keeps lines sorted by start time", () => {
    for (const variant of ["clean", "overlap", "backchannel"] as const) {
      const starts = plan(variant).turns.map((t) => t.startMs);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    }
  });

  it("refuses more participants than voices", () => {
    expect(() => assignVoices(["A", "B", "C", "D", "E"])).toThrow("at most 4");
  });
});

describe("rendered audio", () => {
  it.each(["clean", "overlap", "backchannel"] as const)(
    "%s: truth timing totals match the WAV duration within 50 ms",
    (variant) => {
      const { truth, wav } = render(variant);
      const report = inspectWav(wav);
      expect(report.ok).toBe(true);
      expect(Math.abs(report.info!.durationMs - truth.durationMs)).toBeLessThanOrEqual(50);
      const lastEnd = Math.max(...truth.turns.map((t) => t.endMs));
      expect(Math.abs(report.info!.durationMs - lastEnd - 300)).toBeLessThanOrEqual(50);
    },
  );
});

describe("mixPcm", () => {
  it("sums overlapping clips and clips instead of wrapping", () => {
    const mixed = mixPcm(
      [
        { startMs: 0, samples: Int16Array.from([20_000, 20_000, 100]) },
        { startMs: 0, samples: Int16Array.from([20_000, -30_000]) },
      ],
      1,
      3000,
    );
    expect([...mixed]).toEqual([32767, -10_000, 100]);
  });

  it("drops samples past the end", () => {
    expect(mixPcm([{ startMs: 0, samples: tone(10) }], 5).length).toBe(120);
  });
});
