import { randomUUID } from "node:crypto";
import {
  TRANSCRIBE_MODEL,
  TRANSCRIBE_URL,
  transcribeCostUsd,
  transcribeResponse,
  type TranscribeRequest,
  type TranscribeResponse,
} from "./transcribe";
import { inspectWav } from "./wav";

export type TranscribeErrorKind =
  | "invalid_audio"
  | "bad_request"
  | "too_large"
  | "auth"
  | "rate_limited"
  | "server"
  | "timeout"
  | "network"
  | "invalid_response"
  | "spend_cap"
  | "no_fixture";

export class TranscribeError extends Error {
  constructor(
    readonly kind: TranscribeErrorKind,
    /** Safe to show to the organizer: names the cause and the next step. */
    readonly userMessage: string,
    /** Technical detail for logs; never shown to users. */
    detail: string,
    readonly sessionId: string,
    readonly attempts: number,
    readonly status: number | null = null,
  ) {
    super(`${kind}: ${detail} (session ${sessionId})`);
    this.name = "TranscribeError";
  }
}

/** Structurally the same as the model spend ledger, so both bill against one Meta cap. */
export interface TranscribeSpendLedger {
  totalUsd(provider: "meta"): Promise<number>;
  add(provider: "meta", usd: number): Promise<void>;
}

/** A logged transcription. Never carries audio, transcript text, keywords or keys. */
export interface TranscribeCallEntry {
  at: string;
  model: string;
  mode: TranscribeRequest["mode"];
  sessionId: string;
  audioDurationMs: number;
  costUsd: number;
  latencyMs: number;
  attempts: number;
  turns: number;
  ok: boolean;
  error: string | null;
}

export interface TranscribeLog {
  write(entry: TranscribeCallEntry): Promise<void> | void;
}

export interface TranscribeClientOptions {
  apiKey: string;
  spendCapUsd: number;
  ledger: TranscribeSpendLedger;
  log?: TranscribeLog;
  fetch?: typeof fetch;
  url?: string;
  timeoutMs?: number;
  /** Attempts while rate limited (429); a 500 is always retried exactly once. */
  maxRateLimitAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  newSessionId?: () => string;
}

export interface TranscribeOptions {
  mode?: TranscribeRequest["mode"];
  /** Participant names and project terms; biases recognition, no spelling guarantee. */
  keywords?: readonly string[];
  languageBias?: readonly string[];
}

export interface TranscribeResult {
  response: TranscribeResponse;
  costUsd: number;
  latencyMs: number;
  attempts: number;
  /** Set when the response is a recording, so whatever shows it can label it as replayed. */
  replayed?: true;
}

const RETRY_LATER =
  "The transcription service is busy. Wait a minute and start the transcription again.";

interface ErrorBody {
  message: string;
  sessionId: string | null;
}

function parseError(body: string): ErrorBody {
  try {
    const json = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
      sessionId?: unknown;
    };
    const message = json.error?.message ?? json.message;
    return {
      message: typeof message === "string" ? message : body.slice(0, 300),
      sessionId: typeof json.sessionId === "string" ? json.sessionId : null,
    };
  } catch {
    return { message: body.slice(0, 300), sessionId: null };
  }
}

function retryAfterMs(res: Response): number | null {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** Muse Voice Transcribe, file endpoint (R§4.1). */
export class TranscribeClient {
  readonly #o: TranscribeClientOptions;

  constructor(options: TranscribeClientOptions) {
    this.#o = options;
  }

  async transcribe(wav: Uint8Array, options: TranscribeOptions = {}): Promise<TranscribeResult> {
    const o = this.#o;
    const started = performance.now();
    const mode = options.mode ?? "DIARIZATION";
    // Our own session ID goes in the query string, so a failure can still be traced.
    let sessionId = o.newSessionId?.() ?? randomUUID();
    let attempts = 0;

    const log = async (fields: Partial<TranscribeCallEntry>) => {
      await o.log?.write({
        at: (o.now?.() ?? new Date()).toISOString(),
        model: TRANSCRIBE_MODEL,
        mode,
        sessionId,
        audioDurationMs: 0,
        costUsd: 0,
        latencyMs: Math.round(performance.now() - started),
        attempts,
        turns: 0,
        ok: false,
        error: null,
        ...fields,
      });
    };
    const fail = async (
      kind: TranscribeErrorKind,
      userMessage: string,
      detail: string,
      status: number | null = null,
    ): Promise<never> => {
      await log({ error: `${kind}: ${detail}` });
      throw new TranscribeError(kind, userMessage, detail, sessionId, attempts, status);
    };

    const audio = inspectWav(wav);
    if (!audio.ok) {
      const reasons = audio.problems.map((p) => p.message);
      return fail("invalid_audio", reasons.join(" "), audio.problems.map((p) => p.code).join(", "));
    }

    const spent = await o.ledger.totalUsd("meta");
    if (spent >= o.spendCapUsd) {
      return fail(
        "spend_cap",
        "Transcription is paused because this workspace reached its spending limit.",
        `meta spend $${spent.toFixed(4)} has reached the $${o.spendCapUsd} cap; ask the project owner before raising it.`,
      );
    }

    const request: TranscribeRequest = {
      model: TRANSCRIBE_MODEL,
      audioEncoding: "WAV",
      mode,
      ...(options.keywords?.length ? { keywords: [...options.keywords] } : {}),
      languageBias: [...(options.languageBias ?? ["English"])],
    };
    const url = new URL(o.url ?? TRANSCRIBE_URL);
    url.searchParams.set("sessionId", sessionId);

    const doFetch = o.fetch ?? fetch;
    const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const random = o.random ?? Math.random;
    const maxRateLimited = o.maxRateLimitAttempts ?? 4;
    let rateLimited = 0;
    let serverErrors = 0;

    for (;;) {
      attempts++;
      const form = new FormData();
      form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
      form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");

      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${o.apiKey}`, Accept: "application/json" },
          body: form,
          signal: AbortSignal.timeout(o.timeoutMs ?? 300_000),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        const detail = error instanceof Error ? error.message : String(error);
        return fail(
          timedOut ? "timeout" : "network",
          timedOut
            ? "Transcription took too long and was stopped. Try again; if it keeps happening, upload a shorter recording."
            : "ForkCheck couldn't reach the transcription service. Check the connection and try again.",
          detail,
        );
      }

      const body = await res.text();
      if (res.ok) {
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return fail("invalid_response", RETRY_LATER, "response is not JSON", res.status);
        }
        const parsed = transcribeResponse.safeParse(json);
        if (!parsed.success) {
          return fail(
            "invalid_response",
            RETRY_LATER,
            `response does not match the schema: ${parsed.error.issues[0]?.message ?? ""}`,
            res.status,
          );
        }
        const response = parsed.data;
        sessionId = response.sessionId;
        const costUsd = transcribeCostUsd(response.audioDurationMs);
        await o.ledger.add("meta", costUsd);
        const latencyMs = Math.round(performance.now() - started);
        await log({
          ok: true,
          audioDurationMs: response.audioDurationMs,
          costUsd,
          latencyMs,
          turns: response.turns.length,
        });
        return { response, costUsd, latencyMs, attempts };
      }

      const error = parseError(body);
      if (error.sessionId) sessionId = error.sessionId;
      const detail = `HTTP ${res.status}: ${error.message}`;
      if (res.status === 429) {
        rateLimited++;
        if (rateLimited >= maxRateLimited) {
          return fail("rate_limited", RETRY_LATER, detail, res.status);
        }
        // Full jitter unless the server says how long to wait. 429s are not billed.
        const ceiling = (o.baseDelayMs ?? 2000) * 2 ** (rateLimited - 1);
        await sleep(retryAfterMs(res) ?? random() * ceiling);
        continue;
      }
      if (res.status >= 500) {
        serverErrors++;
        if (serverErrors >= 2) {
          return fail(
            "server",
            `The transcription service failed twice on this recording. Try again later; if it keeps failing, report session ${sessionId}.`,
            detail,
            res.status,
          );
        }
        continue;
      }
      if (res.status === 413) {
        return fail(
          "too_large",
          "This recording is over the 32 MB upload limit. Trim it and upload again.",
          detail,
          res.status,
        );
      }
      if (res.status === 401 || res.status === 403) {
        return fail(
          "auth",
          "Transcription isn't available: the server's API key was rejected. Ask the workspace owner to check it.",
          detail,
          res.status,
        );
      }
      return fail(
        "bad_request",
        `The transcription service rejected this recording: ${error.message.replace(/\.$/, "")}. Check that it is under 10 minutes and upload it again.`,
        detail,
        res.status,
      );
    }
  }
}
