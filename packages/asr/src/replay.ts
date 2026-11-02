import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TranscribeError,
  type TranscribeErrorKind,
  type TranscribeOptions,
  type TranscribeResult,
} from "./client";
import { transcribeResponse } from "./transcribe";

/** What the app needs from Voice Transcribe; `TranscribeClient` is the live implementation. */
export interface Transcriber {
  transcribe(wav: Uint8Array, options?: TranscribeOptions): Promise<TranscribeResult>;
}

/** Keyed by the converted WAV alone: keywords only bias recognition, so a replay ignores them. */
export function replayPath(dir: string, wav: Uint8Array): string {
  return join(dir, `${createHash("sha256").update(wav).digest("hex")}.json`);
}

/** Serves recorded responses, so the app runs without a key and without spending. */
export class ReplayTranscriber implements Transcriber {
  constructor(private readonly dir: string) {}

  async transcribe(wav: Uint8Array): Promise<TranscribeResult> {
    const path = replayPath(this.dir, wav);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      throw new TranscribeError(
        "no_fixture",
        "No recorded transcription matches this recording. Start the server with LIVE=1 to transcribe it.",
        `missing ${path}`,
        "replay",
        0,
      );
    }
    const response = transcribeResponse.parse(JSON.parse(text));
    return { response, costUsd: 0, latencyMs: 0, attempts: 0, replayed: true };
  }
}

/** Passes calls through and saves each response where `ReplayTranscriber` will look for it. */
export class RecordingTranscriber implements Transcriber {
  constructor(
    private readonly inner: Transcriber,
    private readonly dir: string,
  ) {}

  async transcribe(wav: Uint8Array, options?: TranscribeOptions): Promise<TranscribeResult> {
    const result = await this.inner.transcribe(wav, options);
    await mkdir(this.dir, { recursive: true });
    await writeFile(replayPath(this.dir, wav), `${JSON.stringify(result.response, null, 2)}\n`);
    return result;
  }
}

/** Failures of the service or the connection to it, not of the recording. */
const UNREACHABLE: ReadonlySet<TranscribeErrorKind> = new Set([
  "network",
  "timeout",
  "server",
  "rate_limited",
]);

/**
 * Transcribes live and, when the service can't be reached, serves the recorded response for
 * the same audio instead. With no recording, the live error is what the caller sees.
 */
export class FallbackTranscriber implements Transcriber {
  constructor(
    private readonly live: Transcriber,
    private readonly replay: Transcriber,
  ) {}

  async transcribe(wav: Uint8Array, options?: TranscribeOptions): Promise<TranscribeResult> {
    try {
      return await this.live.transcribe(wav, options);
    } catch (error) {
      if (!(error instanceof TranscribeError) || !UNREACHABLE.has(error.kind)) throw error;
      try {
        return await this.replay.transcribe(wav, options);
      } catch (replayError) {
        if (replayError instanceof TranscribeError && replayError.kind === "no_fixture")
          throw error;
        throw replayError;
      }
    }
  }
}
