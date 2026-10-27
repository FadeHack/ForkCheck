import type { ModelPort, ModelRequest, ModelResponse, StageName } from "./port";

type Reply = unknown | ((request: ModelRequest<unknown>) => unknown);

/**
 * Answers from a per-stage queue of hand-written outputs, for unit tests of stage logic.
 * Outputs are parsed with the request's schema, so a malformed script fails loudly.
 */
export class ScriptedProvider implements ModelPort {
  readonly requests: ModelRequest<unknown>[] = [];
  readonly #queues: Partial<Record<StageName, Reply[]>>;

  constructor(script: Partial<Record<StageName, Reply[]>>) {
    this.#queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    this.requests.push(request as ModelRequest<unknown>);
    const next = this.#queues[request.stage]?.shift();
    if (next === undefined) throw new Error(`no scripted output left for ${request.stage}`);
    const raw = typeof next === "function" ? next(request as ModelRequest<unknown>) : next;
    return {
      output: request.schema.parse(raw),
      call: {
        stage: request.stage,
        provider: "fake",
        model: "scripted",
        promptVersion: request.promptVersion,
        cacheHit: false,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: null,
        costUsd: 0,
        ok: true,
        error: null,
      },
    };
  }
}
