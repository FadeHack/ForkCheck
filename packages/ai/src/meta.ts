import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import type { ModelCache } from "./cache";
import type { ModelCallLog } from "./call-log";
import { fixtureKey } from "./fixtures";
import { META_BASE_URL, META_CHAT_MODEL } from "./models";
import type { ModelCallInfo, ModelPort, ModelRequest, ModelResponse } from "./port";
import { chatCostUsd, META_CHAT_PRICE } from "./pricing";
import { responseFormatName } from "./schemas/stages";
import { toStrictJsonSchema } from "./schemas/strict";
import { SpendCapError, type SpendLedger } from "./spend";
import { stageConfig as defaultStageConfig, type StageConfig } from "./stage-config";
import { withoutKey } from "./redact";

export type ModelCallErrorKind =
  | "rate_limited"
  | "server"
  | "timeout"
  | "network"
  | "request"
  | "truncated"
  | "refused"
  | "invalid_output";

const RETRYABLE: ReadonlySet<ModelCallErrorKind> = new Set([
  "rate_limited",
  "server",
  "timeout",
  "network",
]);

export class ModelCallError extends Error {
  constructor(
    readonly kind: ModelCallErrorKind,
    message: string,
    readonly attempts: number,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

export interface MetaProviderOptions {
  apiKey: string;
  spendCapUsd: number;
  ledger: SpendLedger;
  log?: ModelCallLog;
  /** Development only: reuse outputs for identical requests. */
  cache?: ModelCache;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  stageConfig?: Record<ModelRequest<unknown>["stage"], StageConfig>;
}

function classify(error: unknown): { kind: ModelCallErrorKind; status: number | null } {
  if (error instanceof APIConnectionTimeoutError) return { kind: "timeout", status: null };
  if (error instanceof APIConnectionError) return { kind: "network", status: null };
  if (error instanceof APIError) {
    const status = error.status ?? null;
    if (status === 429) return { kind: "rate_limited", status };
    if (status !== null && status >= 500) return { kind: "server", status };
    return { kind: "request", status };
  }
  throw error;
}

/**
 * Muse Spark through Chat Completions only. The Responses API stores data by default
 * (R§4.2), so it is never used here.
 */
export class MetaProvider implements ModelPort {
  readonly #client: OpenAI;
  readonly #o: MetaProviderOptions;
  readonly #stages: Record<ModelRequest<unknown>["stage"], StageConfig>;

  constructor(options: MetaProviderOptions) {
    this.#o = options;
    this.#stages = options.stageConfig ?? defaultStageConfig;
    this.#client = new OpenAI({
      baseURL: META_BASE_URL,
      apiKey: options.apiKey,
      // Retries are ours, so attempts, backoff and logging stay in one place.
      maxRetries: 0,
      timeout: options.timeoutMs ?? 180_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    const started = performance.now();
    const base = {
      stage: request.stage,
      provider: "meta" as const,
      model: META_CHAT_MODEL,
      promptVersion: request.promptVersion,
    };
    const finish = async (info: Omit<ModelCallInfo, keyof typeof base | "latencyMs">) => {
      const call: ModelCallInfo = {
        ...base,
        ...info,
        latencyMs: Math.round(performance.now() - started),
      };
      await this.#o.log?.write({ ...call, at: (this.#o.now?.() ?? new Date()).toISOString() });
      return call;
    };
    const zero = { inputTokens: 0, outputTokens: 0, reasoningTokens: null, costUsd: 0 };

    const key = fixtureKey(request);
    if (this.#o.cache) {
      const hit = request.schema.safeParse(await this.#o.cache.get(key));
      if (hit.success) {
        const call = await finish({ ...zero, cacheHit: true, ok: true, error: null });
        return { output: hit.data, call };
      }
    }

    const spent = await this.#o.ledger.totalUsd("meta");
    if (spent >= this.#o.spendCapUsd) {
      const error = new SpendCapError("meta", spent, this.#o.spendCapUsd);
      await finish({ ...zero, cacheHit: false, ok: false, error: `spend_cap: ${error.message}` });
      throw error;
    }

    const name = responseFormatName(request.stage);
    const params = {
      model: META_CHAT_MODEL,
      messages: request.messages.map(({ role, content }) => ({ role, content })),
      reasoning_effort: request.reasoningEffort,
      max_completion_tokens: this.#stages[request.stage].maxCompletionTokens,
      response_format: {
        type: "json_schema" as const,
        json_schema: { name, schema: toStrictJsonSchema(name, request.schema), strict: true },
      },
    };

    const maxAttempts = this.#o.maxAttempts ?? 3;
    const sleep = this.#o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const random = this.#o.random ?? Math.random;
    let completion: OpenAI.ChatCompletion | undefined;
    let attempt = 0;
    while (completion === undefined) {
      attempt++;
      try {
        completion = await this.#client.chat.completions.create(params);
      } catch (error) {
        const { kind, status } = classify(error);
        const message = withoutKey(
          error instanceof Error ? error.message : String(error),
          this.#o.apiKey,
        );
        if (!RETRYABLE.has(kind) || attempt >= maxAttempts) {
          await finish({ ...zero, cacheHit: false, ok: false, error: `${kind}: ${message}` });
          throw new ModelCallError(kind, message, attempt, status);
        }
        // Full jitter: a random wait up to an exponentially growing ceiling.
        await sleep(random() * (this.#o.baseDelayMs ?? 1000) * 2 ** (attempt - 1));
      }
    }

    const usage = completion.usage;
    const tokens = {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    };
    const costUsd = chatCostUsd(
      {
        promptTokens: tokens.inputTokens,
        completionTokens: tokens.outputTokens,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      META_CHAT_PRICE,
    );
    await this.#o.ledger.add("meta", costUsd);

    const fail = async (kind: ModelCallErrorKind, message: string): Promise<never> => {
      await finish({
        ...tokens,
        costUsd,
        cacheHit: false,
        ok: false,
        error: `${kind}: ${message}`,
      });
      throw new ModelCallError(kind, message, attempt);
    };

    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") {
      return fail("truncated", `output hit max_completion_tokens for ${request.stage}`);
    }
    const content = choice?.message.content;
    if (!content) return fail("refused", choice?.message.refusal ?? "empty response");

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      return fail("invalid_output", "response is not JSON");
    }
    // Strict decoding should guarantee the shape; this parse is the defense if it does not.
    const parsed = request.schema.safeParse(json);
    if (!parsed.success) {
      return fail("invalid_output", `response does not match the ${request.stage} schema`);
    }

    await this.#o.cache?.set(key, parsed.data);
    const call = await finish({ ...tokens, costUsd, cacheHit: false, ok: true, error: null });
    return { output: parsed.data, call };
  }
}
