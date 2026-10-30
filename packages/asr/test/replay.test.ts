import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RecordingTranscriber,
  ReplayTranscriber,
  TranscribeError,
  type Transcriber,
  type TranscribeResponse,
} from "../src/index";

const response: TranscribeResponse = {
  sessionId: "voyager/transcribe/REC",
  transcript: "Hello.",
  audioDurationMs: 1000,
  turns: [{ turnId: 0, startMs: 0, endMs: 900, transcript: "Hello.", speaker: "A" }],
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "forkcheck-replay-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ReplayTranscriber", () => {
  it("names the missing recording and how to make it", async () => {
    const error = await new ReplayTranscriber(dir)
      .transcribe(new Uint8Array([1, 2, 3]))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscribeError);
    expect(error).toMatchObject({ kind: "no_fixture" });
    expect((error as TranscribeError).userMessage).toContain("LIVE=1");
  });

  it("replays what RecordingTranscriber saved for the same WAV", async () => {
    const live: Transcriber = {
      transcribe: async () => ({ response, costUsd: 0.01, latencyMs: 5, attempts: 1 }),
    };
    const wav = new Uint8Array([4, 5, 6]);
    await new RecordingTranscriber(live, dir).transcribe(wav, { keywords: ["Ana"] });
    const replayed = await new ReplayTranscriber(dir).transcribe(wav);
    expect(replayed).toEqual({ response, costUsd: 0, latencyMs: 0, attempts: 0 });
    await expect(new ReplayTranscriber(dir).transcribe(new Uint8Array([7]))).rejects.toThrow(
      "no_fixture",
    );
  });
});
