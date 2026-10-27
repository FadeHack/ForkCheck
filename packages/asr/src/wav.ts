/** Voice Transcribe accepts mono 16-bit PCM WAV at 16 or 24 kHz, up to 10 minutes and 32 MB. */
export const WAV_LIMITS = {
  channels: 1,
  bitsPerSample: 16,
  sampleRates: [16_000, 24_000] as readonly number[],
  maxDurationMs: 10 * 60 * 1000,
  // Decimal megabytes, the stricter reading of the documented "32 MB".
  maxBytes: 32_000_000,
} as const;

const PCM = 1;
const EXTENSIBLE = 0xfffe;

export interface WavInfo {
  /** `pcm`, `float`, or the raw format tag for anything else. */
  format: string;
  channels: number;
  bitsPerSample: number;
  sampleRate: number;
  durationMs: number;
  byteSize: number;
}

export type WavProblemCode =
  | "not_wav"
  | "truncated"
  | "not_pcm"
  | "not_mono"
  | "bit_depth"
  | "sample_rate"
  | "too_long"
  | "too_large";

export interface WavProblem {
  code: WavProblemCode;
  message: string;
}

export interface WavReport {
  ok: boolean;
  /** Absent when the header could not be read at all. */
  info?: WavInfo;
  problems: WavProblem[];
}

const ascii = (view: DataView, offset: number) =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );

function formatName(tag: number): string {
  if (tag === PCM) return "pcm";
  if (tag === 3) return "float";
  return `0x${tag.toString(16).padStart(4, "0")}`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min === 0) return `${sec} s`;
  return sec === 0 ? `${min} min` : `${min} min ${sec} s`;
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const fail = (code: WavProblemCode, message: string): WavReport => ({
  ok: false,
  problems: [{ code, message }],
});

/** Reads the RIFF header and checks it against what Voice Transcribe accepts. */
export function inspectWav(bytes: Uint8Array): WavReport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || ascii(view, 0) !== "RIFF" || ascii(view, 8) !== "WAVE") {
    return fail("not_wav", "This file isn't a WAV recording. Convert it to WAV and try again.");
  }

  let fmt: { tag: number; channels: number; sampleRate: number; bits: number } | undefined;
  let dataSize: number | undefined;
  let dataAvailable = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > bytes.byteLength) break;
      let tag = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in the first two bytes of the sub-format GUID.
      if (tag === EXTENSIBLE && size >= 40 && body + 26 <= bytes.byteLength) {
        tag = view.getUint16(body + 24, true);
      }
      fmt = {
        tag,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataSize = size;
      dataAvailable = Math.min(size, bytes.byteLength - body);
      break;
    }
    // Chunks are word-aligned: an odd-sized chunk is followed by one pad byte.
    offset = body + size + (size % 2);
  }

  if (!fmt || dataSize === undefined) {
    return fail(
      "truncated",
      "The WAV header is incomplete, so the file may be cut off. Export the recording again.",
    );
  }

  const bytesPerSecond = (fmt.sampleRate * fmt.channels * fmt.bits) / 8;
  const info: WavInfo = {
    format: formatName(fmt.tag),
    channels: fmt.channels,
    bitsPerSample: fmt.bits,
    sampleRate: fmt.sampleRate,
    durationMs: bytesPerSecond > 0 ? Math.round((dataSize / bytesPerSecond) * 1000) : 0,
    byteSize: bytes.byteLength,
  };

  const problems: WavProblem[] = [];
  const convert = "Convert it to 24 kHz mono 16-bit WAV.";
  if (dataAvailable < dataSize) {
    problems.push({
      code: "truncated",
      message: "The recording ends earlier than its header says. Export the recording again.",
    });
  }
  if (fmt.tag !== PCM) {
    problems.push({
      code: "not_pcm",
      message: `The audio is stored as ${info.format === "float" ? "floating-point samples" : `format ${info.format}`}, not plain PCM. ${convert}`,
    });
  }
  if (fmt.channels !== WAV_LIMITS.channels) {
    const layout = fmt.channels === 2 ? "stereo" : `${fmt.channels} channels`;
    problems.push({
      code: "not_mono",
      message: `The recording is ${layout}; it must be mono. ${convert}`,
    });
  }
  if (fmt.bits !== WAV_LIMITS.bitsPerSample) {
    problems.push({
      code: "bit_depth",
      message: `The recording is ${fmt.bits}-bit; it must be 16-bit. ${convert}`,
    });
  }
  if (!WAV_LIMITS.sampleRates.includes(fmt.sampleRate)) {
    problems.push({
      code: "sample_rate",
      message: `The sample rate is ${fmt.sampleRate / 1000} kHz; it must be 16 or 24 kHz. ${convert}`,
    });
  }
  if (info.durationMs > WAV_LIMITS.maxDurationMs) {
    problems.push({
      code: "too_long",
      message: `This recording is ${formatDuration(info.durationMs)}. ForkCheck can take up to 10 minutes per recording. Trim it and upload again.`,
    });
  }
  if (info.byteSize > WAV_LIMITS.maxBytes) {
    problems.push({
      code: "too_large",
      message: `This file is ${megabytes(info.byteSize)}; the limit is 32 MB. Trim it or convert it to 24 kHz mono 16-bit WAV.`,
    });
  }

  return { ok: problems.length === 0, info, problems };
}
