import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toSegments, transcribeResponse } from "../src/index";

const fixture = (name: string) =>
  transcribeResponse.parse(
    JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8")),
  );

const ids = () => {
  let n = 0;
  return () => `seg-${++n}`;
};

describe("toSegments", () => {
  it("maps each diarized turn to an unmapped asr segment", () => {
    const response = fixture("diarization-probe");
    const { segments, raw } = toSegments(response, { meetingId: "m1", newId: ids() });

    expect(raw).toBeUndefined();
    expect(segments).toHaveLength(response.turns.length);
    expect(segments[0]).toEqual({
      id: "seg-1",
      meetingId: "m1",
      idx: 0,
      speakerLabel: "A",
      participantId: null,
      startMs: 60,
      endMs: 3820,
      text: "Morning Marco. Let's lock the plan for the pricing pricing page.",
      origin: "asr",
      edited: false,
    });
    expect(segments.map((s) => s.speakerLabel)).toEqual(["A", "B", "A", "B", "A", "B"]);
  });

  it("orders by start time, normalizes times and drops turns without words", () => {
    const response = fixture("irregular");
    const { segments } = toSegments(response, { meetingId: "m1", newId: ids() });

    // The empty turn would otherwise add a voice "C" with nothing to hear or map.
    expect(segments.map((s) => [s.idx, s.text, s.startMs, s.endMs, s.speakerLabel])).toEqual([
      [0, "Mm-hm.", 500, 900, "A"],
      [1, "We ship Friday.", 4100, 6901, "B"],
      [2, "Okay.", 4100, 4100, null],
    ]);
  });

  it("produces monotonic timestamps", () => {
    for (const name of ["diarization-probe", "irregular"]) {
      const { segments } = toSegments(fixture(name), { meetingId: "m1", newId: ids() });
      segments.forEach((s, i) => {
        expect(Number.isInteger(s.startMs) && Number.isInteger(s.endMs)).toBe(true);
        expect(s.endMs).toBeGreaterThanOrEqual(s.startMs);
        if (i > 0) expect(s.startMs).toBeGreaterThanOrEqual(segments[i - 1]!.startMs);
      });
    }
  });

  it("leaves the speaker label null when the mode has no diarization", () => {
    const response = transcribeResponse.parse({
      sessionId: "s",
      transcript: "Hello.",
      audioDurationMs: 1000,
      turns: [{ turnId: 0, startMs: 0, endMs: 800, transcript: "Hello." }],
    });
    const { segments } = toSegments(response, { meetingId: "m1", newId: ids() });
    expect(segments[0]?.speakerLabel).toBeNull();
  });

  it("attaches the raw response only when asked", () => {
    const response = fixture("irregular");
    expect(toSegments(response, { meetingId: "m1", newId: ids(), keepRaw: true }).raw).toBe(
      response,
    );
  });
});
