import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FakeProvider } from "@forkcheck/ai";
import { transcribeResponse } from "@forkcheck/asr";
import { segment, validateRecord } from "@forkcheck/core";
import { audioSegments, audioTruth, parseScenario, runLoop } from "../src/index";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const demo = parseScenario(read("../../../scenarios/demo/sso-pilot.json"));
// The demo audio's live transcription (M2.7) and its render truth, committed as fixtures.
const response = transcribeResponse.parse(
  JSON.parse(read("../fixtures/asr/demo-sso-pilot.clean.json")),
);
const truth = audioTruth.parse(JSON.parse(read("../fixtures/asr/demo-sso-pilot.clean.truth.json")));

describe("audioSegments", () => {
  const { segments, mapping } = audioSegments(demo, truth, response);

  it("maps each speaker label to a participant", () => {
    expect(mapping).toMatchObject({ A: "Marco", B: "Priya", C: "Dana" });
    for (const seg of segments) {
      expect(seg.participantId).toBe(mapping[seg.speakerLabel ?? "?"] ?? null);
    }
  });

  it("produces valid asr segments with stable ids, dropping empty turns", () => {
    const nonEmpty = response.turns.filter((t) => t.transcript.trim() !== "");
    expect(segments).toHaveLength(nonEmpty.length);
    segments.forEach((seg, idx) => {
      expect(segment.parse(seg)).toEqual(seg);
      expect(seg).toMatchObject({ idx, id: `${demo.id}:seg:${idx}`, origin: "asr" });
      expect(seg.text).not.toBe("");
    });
  });

  it("keeps the commitment the demo hinges on", () => {
    expect(segments.map((s) => s.text).join(" ")).toMatch(/ready by Friday/);
  });
});

// Replays the recorded live run: `LIVE=1 pnpm loop --audio
// var/audio/synthetic/demo-sso-pilot.clean.wav --provider meta --record-fixtures`.
describe("headless loop on the demo audio (fixtures)", () => {
  it("runs on transcription segments and passes the validator", async () => {
    const { segments } = audioSegments(demo, truth, response);
    const run = await runLoop(demo, new FakeProvider(), { resolution: "precise", segments });

    expect(run.trace.source).toBe("audio");
    expect(run.segments.every((s) => s.origin === "asr")).toBe(true);
    expect(run.trace.validation).toEqual({ ok: true, findings: [] });
    expect(validateRecord(run.record, run.recordInput).ok).toBe(true);
    expect(run.trace.splits.map((s) => s.mismatch)).toContain("friday-meaning");
    expect(run.trace.costUsd).toBe(0);
  });

  it("the paste run is tagged as paste", async () => {
    const run = await runLoop(demo, new FakeProvider(), { resolution: "precise" });
    expect(run.trace.source).toBe("paste");
  });
});
