import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import type { ModelCallLog } from "../call-log";
import { ModelCallError, type ModelCallErrorKind } from "../meta";
import type { ModelCallInfo, ModelMessage, ModelPort, ModelRequest, ModelResponse } from "../port";
import { chatCostUsd, type ChatPrice } from "../pricing";
import { responseFormatName } from "../schemas/stages";
import { toStrictJsonSchema } from "../schemas/strict";
import { SpendCapError, type SpendLedger } from "../spend";
import { stageConfig as defaultStageConfig, type StageConfig } from "../stage-config";
import { withoutKey } from "../redact";

export const BASETEN_BASE_URL = "https://inference.baseten.co/v1";

/** The exact Baseten model ID. Never substitute a generic slug. */
export const BASETEN_MODEL = "meta-models/muse-spark-open-1026";

/** USD per million tokens, from baseten.co/pricing ("Muse Spark Open"), 2026-10-27. */
export const BASETEN_CHAT_PRICE: ChatPrice = { input: 1.25, cachedInput: 0.15, output: 4.25 };

/** A Baseten call also records whether the first answer parsed, for the JSON-validity metric. */
export type BasetenCallInfo = ModelCallInfo & { validFirstTry: boolean };

export interface BasetenProviderOptions {
  apiKey: string;
  spendCapUsd: number;
  ledger: SpendLedger;
  log?: ModelCallLog;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  stageConfig?: Record<ModelRequest<unknown>["stage"], StageConfig>;
}

const RETRYABLE: ReadonlySet<ModelCallErrorKind> = new Set([
  "rate_limited",
  "server",
  "timeout",
  "network",
]);

function classify(error: unknown): { kind: ModelCallErrorKind; status: number | null } {
  if (error instanceof APIConnectionTimeoutError) return { kind: "timeout", status: null };
  if (error instanceof APIConnectionError) return { kind: "network", status: null };
  if (error instanceof APIError) {
    const status = error.status ?? null;
    // 529 means no capacity right now, even within the account's limits: back off like a 429.
    if (status === 429 || status === 529) return { kind: "rate_limited", status };
    if (status !== null && status >= 500) return { kind: "server", status };
    return { kind: "request", status };
  }
  throw error;
}

export const schemaInstruction = (schema: object) =>
  "Reply with one JSON object and nothing else: no prose, no code fence. " +
  `It must match this JSON Schema exactly:\n${JSON.stringify(schema)}`;

export const repairInstruction = (problem: string) =>
  `That reply was not valid: ${problem}. Reply again with only the corrected JSON object.`;

/**
 * Muse Spark Open on Baseten, for the eval comparison only. Baseten accepts `json_schema`
 * but does not enforce it, so the schema also goes in the prompt, and the answer is parsed
 * and validated here, with one repair turn before `invalid_output`.
 */
export class BasetenProvider implements ModelPort {
  readonly #client: OpenAI;
  readonly #o: BasetenProviderOptions;
  readonly #stages: Record<ModelRequest<unknown>["stage"], StageConfig>;

  constructor(options: BasetenProviderOptions) {
    this.#o = options;
    this.#stages = options.stageConfig ?? defaultStageConfig;
    this.#client = new OpenAI({
      baseURL: BASETEN_BASE_URL,
      apiKey: options.apiKey,
      maxRetries: 0,
      timeout: options.timeoutMs ?? 180_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    const started = performance.now();
    const base = {
      stage: request.stage,
      provider: "baseten" as const,
      model: BASETEN_MODEL,
      promptVersion: request.promptVersion,
      cacheHit: false,
    };
    const totals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
    let validFirstTry = false;
    const finish = async (ok: boolean, error: string | null): Promise<BasetenCallInfo> => {
      const call: BasetenCallInfo = {
        ...base,
        ...totals,
        ok,
        error,
        validFirstTry,
        latencyMs: Math.round(performance.now() - started),
      };
      await this.#o.log?.write({ ...call, at: (this.#o.now?.() ?? new Date()).toISOString() });
      return call;
    };
    const fail: Fail = async (kind, message, attempts, status = null) => {
      await finish(false, `${kind}: ${message}`);
      return new ModelCallError(kind, message, attempts, status);
    };

    const name = responseFormatName(request.stage);
    const schema = toStrictJsonSchema(name, request.schema);
    const messages: ModelMessage[] = [
      ...request.messages,
      { role: "developer", content: schemaInstruction(schema) },
    ];

    for (let turn = 0; turn < 2; turn++) {
      const spent = await this.#o.ledger.totalUsd("baseten");
      if (spent >= this.#o.spendCapUsd) {
        const error = new SpendCapError("baseten", spent, this.#o.spendCapUsd);
        await finish(false, `spend_cap: ${error.message}`);
        throw error;
      }

      const completion = await this.#complete(request, messages, schema, name, fail);
      const usage = completion.usage;
      const tokens = {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      };
      const costUsd = chatCostUsd(tokens, BASETEN_CHAT_PRICE);
      await this.#o.ledger.add("baseten", costUsd);
      totals.inputTokens += tokens.promptTokens;
      totals.outputTokens += tokens.completionTokens;
      totals.reasoningTokens += usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      totals.costUsd += costUsd;

      const choice = completion.choices[0];
      if (choice?.finish_reason === "length") {
        throw await fail("truncated", `output hit max_completion_tokens for ${request.stage}`, 1);
      }
      const content = choice?.message.content ?? "";
      const problem = check(content, request.schema);
      if (problem.ok) {
        validFirstTry = turn === 0;
        return { output: problem.data, call: await finish(true, null) };
      }
      if (turn === 1) {
        throw await fail("invalid_output", `still invalid after one repair: ${problem.message}`, 2);
      }
      messages.push(
        { role: "assistant", content },
        { role: "user", content: repairInstruction(problem.message) },
      );
    }
    throw new Error("unreachable");
  }

  async #complete<T>(
    request: ModelRequest<T>,
    messages: ModelMessage[],
    schema: object,
    name: string,
    fail: Fail,
  ): Promise<OpenAI.ChatCompletion> {
    const params = {
      model: BASETEN_MODEL,
      messages: messages.map(({ role, content }) => ({ role, content })),
      // Reasoning is always on and defaults to xhigh, so the effort is always sent.
      reasoning_effort: request.reasoningEffort,
      max_completion_tokens: this.#stages[request.stage].maxCompletionTokens,
      response_format: {
        type: "json_schema" as const,
        json_schema: { name, schema: schema as Record<string, unknown>, strict: true },
      },
    };
    const maxAttempts = this.#o.maxAttempts ?? 4;
    const sleep = this.#o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const random = this.#o.random ?? Math.random;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#client.chat.completions.create(params);
      } catch (error) {
        const { kind, status } = classify(error);
        const message = withoutKey(
          error instanceof Error ? error.message : String(error),
          this.#o.apiKey,
        );
        if (!RETRYABLE.has(kind) || attempt >= maxAttempts) {
          throw await fail(kind, message, attempt, status);
        }
        await sleep(random() * (this.#o.baseDelayMs ?? 1000) * 2 ** (attempt - 1));
      }
    }
  }
}

type Fail = (
  kind: ModelCallErrorKind,
  message: string,
  attempts: number,
  status?: number | null,
) => Promise<ModelCallError>;

type Checked<T> = { ok: true; data: T } | { ok: false; message: string };

function check<T>(content: string, schema: ModelRequest<T>["schema"]): Checked<T> {
  let json: unknown;
  try {
    json = JSON.parse(stripFence(content));
  } catch {
    return { ok: false, message: "it is not JSON" };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, message: `it does not match the schema (${issues.join("; ")})` };
}

/** Tolerates one Markdown code fence around the object; anything else must parse as is. */
function stripFence(content: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(content);
  return m ? m[1]! : content.trim();
}
