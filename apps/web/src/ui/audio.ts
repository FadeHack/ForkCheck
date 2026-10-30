import type { StartTranscriptionResponse, UploadAudioResponse } from "../contracts/api";
import { callApi } from "./api";

// The server's limits, restated: the asr package also holds ffmpeg code, which can't reach a browser bundle.
export const MAX_RECORDING_BYTES = 32_000_000;
export const MAX_RECORDING_MS = 10 * 60_000;

export const RECORDING_ACCEPT =
  ".wav,.m4a,.mp3,.webm,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/mpeg,audio/webm";

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min === 0) return `${sec} s`;
  return sec === 0 ? `${min} min` : `${min} min ${sec} s`;
}

export interface RecordingInfo {
  size: number;
  /** Null when the browser can't read the length; the server checks it after conversion. */
  durationMs: number | null;
}

/** What is wrong with the chosen file, in words the organizer can act on; null when it can go. */
export function recordingProblem(recording: RecordingInfo | null): string | null {
  if (recording === null) return "Choose the recording to upload.";
  if (recording.size === 0) return "This file is empty. Choose the recording again.";
  if (recording.size > MAX_RECORDING_BYTES) {
    const mb = (recording.size / 1_000_000).toFixed(1);
    return `This file is ${mb} MB. ForkCheck can take files up to 32 MB. Trim it, or export it as mono WAV, and upload again.`;
  }
  if (recording.durationMs !== null && recording.durationMs > MAX_RECORDING_MS) {
    return `This recording is ${formatDuration(recording.durationMs)}. ForkCheck can take up to 10 minutes per recording. Trim it and upload again.`;
  }
  return null;
}

/** The recording's length from its metadata, or null if this browser can't tell. */
export function readDurationMs(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const done = (ms: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    // Recordings from MediaRecorder report an infinite length until played through.
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    audio.preload = "metadata";
    audio.src = url;
  });
}

export function termList(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

type Outcome = { ok: true } | { ok: false; message: string };

export async function startTranscription(
  meetingId: string,
  token: string,
  storageKey: string,
  keywords: string[] = [],
): Promise<Outcome> {
  const res = await callApi<StartTranscriptionResponse>(
    `/api/meetings/${encodeURIComponent(meetingId)}/audio`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ storageKey, ...(keywords.length > 0 ? { keywords } : {}) }),
    },
  );
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}

/** Sends the file as the raw request body, then starts transcription of it. */
export async function uploadAndTranscribe(
  meetingId: string,
  token: string,
  file: File,
  keywords: string[] = [],
): Promise<Outcome> {
  const upload = await callApi<UploadAudioResponse>(
    `/api/meetings/${encodeURIComponent(meetingId)}/audio/upload`,
    {
      method: "POST",
      token,
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    },
  );
  if (!upload.ok) return { ok: false, message: upload.message };
  return startTranscription(meetingId, token, upload.data.storageKey, keywords);
}
