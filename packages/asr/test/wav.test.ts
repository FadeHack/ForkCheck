import { describe, expect, it } from "vitest";
import { formatDuration, inspectWav, WAV_LIMITS } from "../src/index";

interface WavSpec {
  tag?: number;
  channels?: number;
  sampleRate?: number;
  bits?: number;
  dataBytes?: number;
  /** Overrides the data chunk's declared size without allocating it. */
  declaredDataBytes?: number;
  extensible?: boolean;
  extraChunk?: boolean;
}

function wav(spec: WavSpec = {}): Uint8Array {
  const { tag = 1, channels = 1, sampleRate = 24_000, bits = 16, dataBytes = 4800 } = spec;
  const fmtSize = spec.extensible ? 40 : 16;
  const extra = spec.extraChunk ? 8 + 3 + 1 : 0;
  const bytes = new Uint8Array(12 + 8 + fmtSize + extra + 8 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, spec.extensible ? 0xfffe : tag, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  if (spec.extensible) view.setUint16(20 + 24, tag, true);
  let offset = 20 + fmtSize;
  if (spec.extraChunk) {
    text(offset, "LIST");
    view.setUint32(offset + 4, 3, true);
    offset += 8 + 3 + 1;
  }
  text(offset, "data");
  view.setUint32(offset + 4, spec.declaredDataBytes ?? dataBytes, true);
  return bytes;
}

const codes = (bytes: Uint8Array) => inspectWav(bytes).problems.map((p) => p.code);

describe("inspectWav", () => {
  it("accepts 24 kHz mono 16-bit PCM and reports its properties", () => {
    const report = inspectWav(wav());
    expect(report).toEqual({
      ok: true,
      problems: [],
      info: {
        format: "pcm",
        channels: 1,
        bitsPerSample: 16,
        sampleRate: 24_000,
        durationMs: 100,
        byteSize: 44 + 4800,
      },
    });
  });

  it("accepts 16 kHz", () => {
    expect(inspectWav(wav({ sampleRate: 16_000 })).ok).toBe(true);
  });

  it("skips unknown chunks, including the pad byte after an odd-sized chunk", () => {
    expect(inspectWav(wav({ extraChunk: true })).ok).toBe(true);
  });

  it("reads the real format from WAVE_FORMAT_EXTENSIBLE", () => {
    expect(inspectWav(wav({ extensible: true })).info?.format).toBe("pcm");
    expect(codes(wav({ extensible: true, tag: 3, bits: 32 }))).toContain("not_pcm");
  });

  it("rejects stereo with a reason a person can act on", () => {
    const report = inspectWav(wav({ channels: 2 }));
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      {
        code: "not_mono",
        message: "The recording is stereo; it must be mono. Convert it to 24 kHz mono 16-bit WAV.",
      },
    ]);
  });

  it("rejects 8-bit audio", () => {
    expect(codes(wav({ bits: 8 }))).toEqual(["bit_depth"]);
    expect(inspectWav(wav({ bits: 8 })).problems[0]?.message).toContain("8-bit");
  });

  it("rejects 44.1 kHz", () => {
    const report = inspectWav(wav({ sampleRate: 44_100 }));
    expect(codes(wav({ sampleRate: 44_100 }))).toEqual(["sample_rate"]);
    expect(report.problems[0]?.message).toContain("44.1 kHz");
  });

  it("rejects float samples", () => {
    expect(codes(wav({ tag: 3, bits: 32 }))).toEqual(["not_pcm", "bit_depth"]);
  });

  it("reports every problem at once", () => {
    expect(codes(wav({ channels: 2, bits: 8, sampleRate: 44_100 }))).toEqual([
      "not_mono",
      "bit_depth",
      "sample_rate",
    ]);
  });

  it("rejects a recording longer than 10 minutes, read from the data chunk size", () => {
    const elevenMinutes = 11 * 60 * 48_000;
    const report = inspectWav(wav({ dataBytes: 0, declaredDataBytes: elevenMinutes }));
    expect(report.info?.durationMs).toBe(11 * 60 * 1000);
    expect(report.problems).toContainEqual({
      code: "too_long",
      message:
        "This recording is 11 min. ForkCheck can take up to 10 minutes per recording. Trim it and upload again.",
    });
  });

  it("accepts exactly 10 minutes", () => {
    const report = inspectWav(wav({ dataBytes: 0, declaredDataBytes: 600 * 48_000 }));
    expect(report.problems.map((p) => p.code)).not.toContain("too_long");
  });

  it("flags data shorter than the header declares", () => {
    expect(codes(wav({ dataBytes: 100, declaredDataBytes: 4800 }))).toEqual(["truncated"]);
  });

  it("rejects a file over 32 MB", () => {
    const report = inspectWav(wav({ dataBytes: WAV_LIMITS.maxBytes }));
    expect(report.problems.map((p) => p.code)).toContain("too_large");
    expect(report.problems.find((p) => p.code === "too_large")?.message).toContain("32.0 MB");
  });

  it("rejects a truncated header", () => {
    const full = wav();
    expect(inspectWav(full.subarray(0, 30))).toEqual({
      ok: false,
      problems: [
        {
          code: "truncated",
          message:
            "The WAV header is incomplete, so the file may be cut off. Export the recording again.",
        },
      ],
    });
    expect(codes(full.subarray(0, 40))).toEqual(["truncated"]);
  });

  it("rejects files that aren't WAV", () => {
    expect(codes(new TextEncoder().encode("ID3\u0004 not a wav file"))).toEqual(["not_wav"]);
    expect(codes(new Uint8Array(0))).toEqual(["not_wav"]);
  });

  it("works on a view into a larger buffer", () => {
    const inner = wav();
    const outer = new Uint8Array(inner.length + 10);
    outer.set(inner, 10);
    expect(inspectWav(outer.subarray(10)).ok).toBe(true);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 s"],
    [42_400, "42 s"],
    [600_000, "10 min"],
    [372_000, "6 min 12 s"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
