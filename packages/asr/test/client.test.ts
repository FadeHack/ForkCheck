import { describe, expect, it } from "vitest";
import {
  TRANSCRIBE_MODEL,
  TranscribeClient,
  TranscribeError,
  type TranscribeCallEntry,
  type TranscribeClientOptions,
} from "../src/index";

/** Silent 24 kHz mono 16-bit WAV of the given length. */
function silentWav(ms: number, channels = 1): Uint8Array {
  const dataBytes = Math.round((24_000 * ms) / 1000) * 2 * channels;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000 * channels, true);
  view.setUint16(32, 2 * channels, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

const success = {
  sessionId: "voyager/transcribe/ABC",
  transcript: "Morning Marco. Sure.",
  audioDurationMs: 3_600_000,
  turns: [
    { turnId: 0, startMs: 0, endMs: 1200, transcript: "Morning Marco.", speaker: "A" },
    { turnId: 1, startMs: 1400, endMs: 2000, transcript: "Sure.", speaker: "B" },
  ],
};

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

interface Sent {
  url: URL;
  auth: string | null;
  request: Record<string, unknown>;
  audio: File;
}

function setup(
  script: (() => Response | Promise<Response>)[],
  extra: Partial<TranscribeClientOptions> = {},
) {
  const sent: Sent[] = [];
  const delays: number[] = [];
  const entries: TranscribeCallEntry[] = [];
  const ledger = {
    usd: 0,
    async totalUsd() {
      return this.usd;
    },
    async add(_: "meta", usd: number) {
      this.usd += usd;
    },
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    sent.push({
      url: new URL(String(input)),
      auth: new Headers(init?.headers).get("authorization"),
      request: JSON.parse(await (form.get("request") as Blob).text()),
      audio: form.get("audio") as File,
    });
    const next = script[sent.length - 1];
    if (!next) throw new Error("unexpected extra request");
    return next();
  }) as typeof globalThis.fetch;
  const client = new TranscribeClient({
    apiKey: "test-key",
    spendCapUsd: 1,
    ledger,
    fetch,
    log: { write: (e) => void entries.push(e) },
    sleep: async (ms) => void delays.push(ms),
    random: () => 0.5,
    newSessionId: () => "local-session",
    now: () => new Date("2026-10-28T10:00:00Z"),
    ...extra,
  });
  return { client, sent, delays, entries, ledger };
}

async function failure(promise: Promise<unknown>): Promise<TranscribeError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TranscribeError) return error;
    throw error;
  }
  throw new Error("expected a TranscribeError");
}

describe("TranscribeClient", () => {
  it("sends a multipart DIARIZATION request and bills the audio duration", async () => {
    const { client, sent, entries, ledger } = setup([json(200, success)]);
    const wav = silentWav(500);

    const result = await client.transcribe(wav, { keywords: ["Priya", "Marco"] });

    expect(result.response.turns).toHaveLength(2);
    expect(result.costUsd).toBeCloseTo(0.18);
    expect(result.attempts).toBe(1);
    expect(ledger.usd).toBeCloseTo(0.18);

    expect(sent).toHaveLength(1);
    const [req] = sent;
    expect(req?.url.origin + req!.url.pathname).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(req?.url.searchParams.get("sessionId")).toBe("local-session");
    expect(req?.auth).toBe("Bearer test-key");
    expect(req?.request).toEqual({
      model: TRANSCRIBE_MODEL,
      audioEncoding: "WAV",
      mode: "DIARIZATION",
      keywords: ["Priya", "Marco"],
      languageBias: ["English"],
    });
    expect(req?.audio.type).toBe("audio/wav");
    expect(new Uint8Array(await req!.audio.arrayBuffer())).toEqual(wav);

    expect(entries).toEqual([
      expect.objectContaining({
        at: "2026-10-28T10:00:00.000Z",
        model: TRANSCRIBE_MODEL,
        mode: "DIARIZATION",
        sessionId: "voyager/transcribe/ABC",
        audioDurationMs: 3_600_000,
        attempts: 1,
        turns: 2,
        ok: true,
        error: null,
      }),
    ]);
    expect(entries[0]?.costUsd).toBeCloseTo(0.18);
  });

  it("omits empty keywords and honours a language bias", async () => {
    const { client, sent } = setup([json(200, success)]);
    await client.transcribe(silentWav(100), { keywords: [], languageBias: ["Spanish"] });
    expect(sent[0]?.request).not.toHaveProperty("keywords");
    expect(sent[0]?.request.languageBias).toEqual(["Spanish"]);
  });

  it("refuses audio the API would reject, without a request", async () => {
    const { client, sent, entries } = setup([]);
    const error = await failure(client.transcribe(silentWav(100, 2)));
    expect(error.kind).toBe("invalid_audio");
    expect(error.userMessage).toContain("The recording is stereo");
    expect(sent).toHaveLength(0);
    expect(entries[0]).toMatchObject({ ok: false, error: "invalid_audio: not_mono" });
  });

  it("stops at the spend cap before sending", async () => {
    const { client, sent, ledger } = setup([]);
    ledger.usd = 1;
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.kind).toBe("spend_cap");
    expect(error.message).toContain("ask the project owner");
    expect(sent).toHaveLength(0);
  });

  it("maps 400 to a user-readable reason", async () => {
    const { client, ledger } = setup([
      json(400, { error: { message: "Audio duration exceeds 10 minutes." } }),
    ]);
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.kind).toBe("bad_request");
    expect(error.status).toBe(400);
    expect(error.userMessage).toBe(
      "The transcription service rejected this recording: Audio duration exceeds 10 minutes. Check that it is under 10 minutes and upload it again.",
    );
    expect(ledger.usd).toBe(0);
  });

  it("maps 413 to the size limit", async () => {
    const { client, sent } = setup([json(413, { error: { message: "too large" } })]);
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.kind).toBe("too_large");
    expect(error.userMessage).toContain("32 MB");
    expect(sent).toHaveLength(1);
  });

  it("maps 401 without leaking the key", async () => {
    const { client } = setup([json(401, { error: { message: "invalid key" } })]);
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.kind).toBe("auth");
    expect(error.message).not.toContain("test-key");
  });

  it("keeps the API key out of messages when the service echoes it", async () => {
    const { client } = setup([json(400, { error: { message: "Bad audio for key test-key" } })]);
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.userMessage).not.toContain("test-key");
    expect(error.message).not.toContain("test-key");
  });

  it("backs off on 429, honouring Retry-After, then succeeds", async () => {
    const { client, delays, sent } = setup([
      json(429, { error: { message: "slow down" } }),
      json(429, { error: { message: "slow down" } }, { "retry-after": "3" }),
      json(200, success),
    ]);
    const result = await client.transcribe(silentWav(100));
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([1000, 3000]);
    expect(sent.map((s) => s.url.searchParams.get("sessionId"))).toEqual([
      "local-session",
      "local-session",
      "local-session",
    ]);
  });

  it("gives up after repeated 429s", async () => {
    const limited = json(429, { error: { message: "slow down" } });
    const { client, delays } = setup([limited, limited], { maxRateLimitAttempts: 2 });
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.kind).toBe("rate_limited");
    expect(error.attempts).toBe(2);
    expect(delays).toEqual([1000]);
    expect(error.userMessage).toContain("Wait a minute");
  });

  it("retries a 500 once and then succeeds", async () => {
    const { client } = setup([json(500, { error: { message: "boom" } }), json(200, success)]);
    const result = await client.transcribe(silentWav(100));
    expect(result.attempts).toBe(2);
  });

  it("fails after a second 500, carrying the session ID", async () => {
    const { client, sent, entries } = setup([
      json(500, { error: { message: "boom" } }),
      json(500, { error: { message: "boom again" }, sessionId: "voyager/transcribe/XYZ" }),
    ]);
    const error = await failure(client.transcribe(silentWav(100)));
    expect(sent).toHaveLength(2);
    expect(error.kind).toBe("server");
    expect(error.sessionId).toBe("voyager/transcribe/XYZ");
    expect(error.message).toContain("voyager/transcribe/XYZ");
    expect(error.userMessage).toContain("report session voyager/transcribe/XYZ");
    expect(entries[0]).toMatchObject({
      ok: false,
      attempts: 2,
      sessionId: "voyager/transcribe/XYZ",
      error: "server: HTTP 500: boom again",
    });
  });

  it("falls back to its own session ID when the error body has none", async () => {
    const boom = () => new Response("Internal Server Error", { status: 502 });
    const { client } = setup([boom, boom]);
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.sessionId).toBe("local-session");
    expect(error.message).toContain("HTTP 502: Internal Server Error");
  });

  it("reports a response that doesn't match the schema", async () => {
    const { client, ledger } = setup([json(200, { transcript: "hi" })]);
    const error = await failure(client.transcribe(silentWav(100)));
    expect(error.kind).toBe("invalid_response");
    expect(ledger.usd).toBe(0);
  });

  it("reports network failures and timeouts", async () => {
    const network = setup([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    expect((await failure(network.client.transcribe(silentWav(100)))).kind).toBe("network");

    const timeout = setup([
      () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    ]);
    expect((await failure(timeout.client.transcribe(silentWav(100)))).kind).toBe("timeout");
  });

  it("never logs transcript text or keywords", async () => {
    const { client, entries } = setup([json(200, success)]);
    await client.transcribe(silentWav(100), { keywords: ["Priya"] });
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain("Morning");
    expect(logged).not.toContain("Priya");
  });
});
