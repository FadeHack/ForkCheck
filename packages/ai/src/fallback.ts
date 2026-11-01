import { MissingFixtureError } from "./fixtures";
import { ModelCallError, type ModelCallErrorKind } from "./meta";
import type { ModelPort, ModelRequest, ModelResponse } from "./port";

/** Failures of the service or the connection to it, not of the request itself. */
const UNREACHABLE: ReadonlySet<ModelCallErrorKind> = new Set([
  "network",
  "timeout",
  "server",
  "rate_limited",
]);

/**
 * Calls the live provider and, when it can't be reached, answers from a recorded reply instead.
 * The replay reports itself as `fake`, so whatever shows its result can label it as replayed.
 * With no recording for the request, the live error is what the caller sees.
 */
export class FallbackProvider implements ModelPort {
  readonly #live: ModelPort;
  readonly #replay: ModelPort;

  constructor(live: ModelPort, replay: ModelPort) {
    this.#live = live;
    this.#replay = replay;
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    try {
      return await this.#live.call(request);
    } catch (error) {
      if (!(error instanceof ModelCallError) || !UNREACHABLE.has(error.kind)) throw error;
      try {
        return await this.#replay.call(request);
      } catch (replayError) {
        if (replayError instanceof MissingFixtureError) throw error;
        throw replayError;
      }
    }
  }
}
