import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inspectWav, type WavInfo, type WavProblem } from "./wav";

const run = promisify(execFile);

export const TARGET_SAMPLE_RATE = 24_000;

/** R§4.1 conversion: first audio stream only, mono, 24 kHz, 16-bit PCM, no metadata. */
export const CONVERT_ARGS = [
  "-map",
  "0:a:0",
  "-ac",
  "1",
  "-ar",
  String(TARGET_SAMPLE_RATE),
  "-c:a",
  "pcm_s16le",
  "-map_metadata",
  "-1",
  // Without bitexact, ffmpeg still writes its own name into a LIST/INFO chunk.
  "-fflags",
  "+bitexact",
  "-f",
  "wav",
] as const;

export interface ConvertProblem {
  code: WavProblem["code"] | "unreadable";
  message: string;
  /** ffmpeg's last stderr lines, for logs only. */
  detail?: string;
}

export type ConvertResult =
  | { ok: true; wav: Uint8Array; info: WavInfo }
  | { ok: false; info?: WavInfo; problems: ConvertProblem[] };

export interface ConvertOptions {
  ffmpegPath?: string;
  /** Parent of the per-call temp directory; defaults to the OS temp dir. */
  tmpRoot?: string;
  timeoutMs?: number;
}

/**
 * Converts any audio ffmpeg can read to the WAV Voice Transcribe accepts, then checks the
 * result (duration and size) so a recording that is too long never reaches the API.
 * `input` is the file's bytes or a path to it.
 */
export async function convertToWav(
  input: Uint8Array | string,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const work = await mkdtemp(join(options.tmpRoot ?? tmpdir(), "forkcheck-convert-"));
  try {
    let source = input;
    if (typeof input !== "string") {
      source = join(work, "input");
      await writeFile(source, input);
    }
    const output = join(work, "output.wav");
    try {
      await run(
        options.ffmpegPath ?? "ffmpeg",
        ["-nostdin", "-v", "error", "-y", "-i", source as string, ...CONVERT_ARGS, output],
        { timeout: options.timeoutMs ?? 120_000, maxBuffer: 1024 * 1024 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `ffmpeg not found at "${options.ffmpegPath ?? "ffmpeg"}". Install ffmpeg or set FFMPEG_PATH.`,
          { cause: error },
        );
      }
      const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
      return {
        ok: false,
        problems: [
          {
            code: "unreadable",
            message:
              "ForkCheck couldn't read this file as audio. Upload a WAV, M4A, MP3 or WebM recording.",
            detail: stderr.split("\n").slice(-3).join("\n"),
          },
        ],
      };
    }

    const wav = new Uint8Array(await readFile(output));
    const report = inspectWav(wav);
    if (!report.ok || !report.info) {
      return report.info
        ? { ok: false, info: report.info, problems: report.problems }
        : { ok: false, problems: report.problems };
    }
    return { ok: true, wav, info: report.info };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
