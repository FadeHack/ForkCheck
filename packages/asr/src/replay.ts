import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TranscribeError, type TranscribeOptions, type TranscribeResult } from "./client";
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
    return { response, costUsd: 0, latencyMs: 0, attempts: 0 };
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
