import type { ModelPort, ModelRequest, ModelResponse } from "@forkcheck/ai";

/** Stands in for the meeting's random ID in every model request. */
export const SCOPED_MEETING_ID = "meeting-0";

/**
 * Swaps the meeting ID for a fixed one in requests and back in outputs. Every ID the stages
 * send is prefixed with the meeting ID, so without this no two meetings share a fixture.
 */
export class MeetingScopedProvider implements ModelPort {
  readonly #inner: ModelPort;
  readonly #meetingId: string;

  constructor(inner: ModelPort, meetingId: string) {
    this.#inner = inner;
    this.#meetingId = meetingId;
  }

  async call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    const response = await this.#inner.call({
      ...request,
      messages: request.messages.map((m) => ({
        ...m,
        content: m.content.replaceAll(this.#meetingId, SCOPED_MEETING_ID),
      })),
    });
    // Only ID prefixes map back, so prose that happens to contain the stand-in stays as written.
    const output = JSON.parse(
      JSON.stringify(response.output).replaceAll(`${SCOPED_MEETING_ID}:`, `${this.#meetingId}:`),
    ) as T;
    return { ...response, output };
  }
}
