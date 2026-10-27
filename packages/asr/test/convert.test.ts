import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertToWav, inspectWav } from "../src/index";

let samples: string;
let tmpRoot: string;

/** Two seconds of tone, encoded by ffmpeg into the given container. */
function sample(name: string, ...encode: string[]): string {
  const path = join(samples, name);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-metadata",
    "title=Synthetic tone",
    ...encode,
    path,
  ]);
  return path;
}

beforeAll(() => {
  samples = mkdtempSync(join(tmpdir(), "forkcheck-convert-samples-"));
  tmpRoot = mkdtempSync(join(tmpdir(), "forkcheck-convert-tmp-"));
});

afterAll(() => {
  rmSync(samples, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("convertToWav", () => {
  it.each([
    ["m4a", "tone.m4a", ["-c:a", "aac"]],
    ["mp3", "tone.mp3", ["-c:a", "libmp3lame"]],
    ["webm", "tone.webm", ["-c:a", "libopus"]],
    ["stereo 44.1 kHz WAV", "tone.wav", ["-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le"]],
  ])("converts %s to a WAV that passes inspection", async (_, name, encode) => {
    const path = sample(name, ...encode);
    const before = inspectWav(readFileSync(path));
    if (name.endsWith(".wav")) expect(before.ok).toBe(false);

    const result = await convertToWav(path, { tmpRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(inspectWav(result.wav)).toEqual({ ok: true, info: result.info, problems: [] });
    expect(result.info).toMatchObject({ format: "pcm", channels: 1, sampleRate: 24_000 });
    expect(Math.abs(result.info.durationMs - 2000)).toBeLessThan(100);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("accepts bytes as well as a path", async () => {
    const result = await convertToWav(readFileSync(sample("bytes.mp3", "-c:a", "libmp3lame")), {
      tmpRoot,
    });
    expect(result.ok).toBe(true);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("strips metadata", async () => {
    const result = await convertToWav(sample("meta.m4a", "-c:a", "aac"), { tmpRoot });
    if (!result.ok) throw new Error("conversion failed");
    const text = new TextDecoder("latin1").decode(result.wav.subarray(0, 200));
    expect(text).not.toContain("Synthetic tone");
    expect(text).not.toContain("LIST");
    expect(text).not.toContain("Lavf");
  });

  it("reports a file that isn't audio and cleans up", async () => {
    const result = await convertToWav(new TextEncoder().encode("not audio at all"), { tmpRoot });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({
      code: "unreadable",
      message:
        "ForkCheck couldn't read this file as audio. Upload a WAV, M4A, MP3 or WebM recording.",
    });
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("rejects a recording over 10 minutes after converting it", async () => {
    const path = join(samples, "long.mp3");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=8000:cl=mono",
      "-t",
      "601",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "8k",
      path,
    ]);
    const result = await convertToWav(path, { tmpRoot });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toEqual(["too_long"]);
    expect(result.problems[0]?.message).toContain("This recording is 10 min 1 s.");
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("throws a setup error when ffmpeg is missing, and still cleans up", async () => {
    await expect(
      convertToWav(new Uint8Array(4), { tmpRoot, ffmpegPath: "/nonexistent/ffmpeg" }),
    ).rejects.toThrow('ffmpeg not found at "/nonexistent/ffmpeg"');
    expect(readdirSync(tmpRoot)).toEqual([]);
  });
});
