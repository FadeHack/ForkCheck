import type { ModelPort, ModelRequest, ModelResponse } from "@forkcheck/ai";
import { mapStrings, pseudonyms, type Pseudonyms } from "@forkcheck/core";

/**
 * For a meeting with `pseudonymizeNames` on: participant names leave as placeholders in every
 * request, and the reply's placeholders are mapped back before any stage reads it, so quotes are
 * still checked against the original transcript. `names` is null when the setting is off.
 */
export class PseudonymizingProvider implements ModelPort {
  readonly #inner: ModelPort;
  readonly #names: () => Promise<string[] | null>;
  #map: Promise<Pseudonyms | null> | undefined;

  constructor(inner: ModelPort, names: () => Promise<string[] | null>) {
    this.#inner = inner;
    this.#names = names;
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    this.#map ??= this.#names().then((names) => (names === null ? null : pseudonyms(names)));
    const map = await this.#map;
    if (map === null) return this.#inner.call(request);
    const response = await this.#inner.call({
      ...request,
      messages: request.messages.map((m) => ({ ...m, content: map.hide(m.content) })),
    });
    return { ...response, output: mapStrings(response.output, map.reveal) };
  }
}
